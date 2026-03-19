'use strict';

const crypto = require('crypto');
const axios = require('axios');
const WebSocket = require('ws');
const { config, saveConfig, applyConfigPatch } = require('../config');
const { emitAlert } = require('../alerts');
const { listenerStatus, listenerHealth, setListenerStatus, recordListenerError, bumpListenerEvent } = require('../health');

let livePixPollTimer = null;
const livePixSeenIds = new Set();
let livePixWidgetSocket = null;
let livePixWidgetReconnectTimer = null;
let livePixWidgetTokenRefreshTimer = null;
let livePixWidgetHeartbeatTimer = null;
let livePixWidgetReconnectDelay = 3000;
let livePixWidgetModeEnabled = false;
let livePixWidgetCurrentId = '';
let livePixWidgetTopics = [];
const LIVEPIX_WIDGET_RECONNECT_MAX_MS = 60000;
const LIVEPIX_WIDGET_TOKEN_REFRESH_MS = 20 * 60 * 1000;
const LIVEPIX_WEBSERVICE_BASE = 'https://webservice.livepix.gg';
const LIVEPIX_PUBSUB_WS = 'wss://pubsub.livepix.gg/ws';
const LIVEPIX_POLL_MS = 20000;

function stableSerialize(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(String(value));
}

function buildSyntheticLivePixId(kind, payload) {
    const fingerprint = stableSerialize(payload);
    const digest = crypto
        .createHash('sha256')
        .update(`${String(kind || 'payment')}|${fingerprint}`)
        .digest('hex')
        .slice(0, 24);
    return `synthetic:${digest}`;
}

function formatMoneyFromCents(amount, currency = 'BRL') {
    const n = Number(amount);
    if (!Number.isFinite(n)) return `${amount || ''}`.trim();
    if (currency === 'BRL') {
        return `R$ ${(n / 100).toFixed(2).replace('.', ',')}`;
    }
    return `${(n / 100).toFixed(2)} ${currency}`;
}

function parseAmountCents(raw) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
    const txt = String(raw || '').trim();
    if (!txt) return 0;
    if (/^-?\d+$/.test(txt)) return Math.round(Number(txt));
    return 0;
}

function normalizeLivePixAmountValue(rawAmount, currency = 'BRL') {
    if (rawAmount === null || rawAmount === undefined) return '';
    if (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) {
        return formatMoneyFromCents(rawAmount, currency);
    }
    if (typeof rawAmount === 'string') {
        const txt = rawAmount.trim();
        if (!txt) return '';
        if (/^\d+$/.test(txt)) return formatMoneyFromCents(Number(txt), currency);
        return txt;
    }
    if (typeof rawAmount === 'object') {
        const fromText = [
            rawAmount.formatted,
            rawAmount.display,
            rawAmount.text,
            rawAmount.amountFormatted,
            rawAmount.valueFormatted
        ].find((v) => typeof v === 'string' && v.trim());
        if (fromText) return fromText.trim();

        const nestedCurrency = String(rawAmount.currency || rawAmount.currencyCode || currency || 'BRL').trim() || 'BRL';
        const nestedNumeric =
            rawAmount.amount ??
            rawAmount.value ??
            rawAmount.total ??
            rawAmount.cents ??
            rawAmount.integer;
        if (nestedNumeric !== null && nestedNumeric !== undefined && Number.isFinite(Number(nestedNumeric))) {
            return formatMoneyFromCents(Number(nestedNumeric), nestedCurrency);
        }
    }
    return '';
}

function extractLivePixWidgetId(notificationUrl) {
    if (!notificationUrl) return '';
    try {
        const parsed = new URL(notificationUrl);
        const match = parsed.pathname.match(/\/embed\/([0-9a-fA-F-]{8,})/);
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

function livePixMessageTime() {
    return Math.round(Date.now() / 1000);
}

function decodeLivePixWsData(data) {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    if (Array.isArray(data)) return Buffer.concat(data.map((item) => Buffer.isBuffer(item) ? item : Buffer.from(item))).toString('utf8');
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    return '';
}

function parseLivePixPubSubPacket(data) {
    const raw = decodeLivePixWsData(data);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function normalizeLivePixPubSubMessage(packet) {
    if (!packet || typeof packet !== 'object') return null;
    const message = packet.message && typeof packet.message === 'object' ? packet.message : packet;
    if (!message || typeof message !== 'object') return null;
    return {
        type: Number(message.type ?? packet.type ?? 0),
        event: String(message.event || packet.event || ''),
        payload: message.payload ?? packet.payload,
        time: message.time ?? packet.time ?? livePixMessageTime()
    };
}

function sendLivePixProtocolMessage(ws, event, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const packet = {
        message: {
            type: 1,
            event,
            payload,
            time: livePixMessageTime()
        }
    };
    try {
        ws.send(Buffer.from(JSON.stringify(packet), 'utf8'));
    } catch (err) {
        console.error('[LivePix] Failed to send protocol message:', err?.message || String(err));
    }
}

function buildLivePixPubSubTopics(widgetId, widgetData = {}) {
    const topics = new Set();
    if (widgetId) topics.add(`widget:${widgetId}`);
    const userId = widgetData?.userId ? String(widgetData.userId) : '';
    const widgetType = widgetData?.type ? String(widgetData.type) : '';
    if (userId && widgetType) topics.add(`user:widgets:${widgetType}:${userId}`);
    if (userId) topics.add(`user:widgets:notification:${userId}`);
    return [...topics];
}

async function fetchLivePixWidgetData(widgetId) {
    const res = await axios.get(`${LIVEPIX_WEBSERVICE_BASE}/widgets/${widgetId}`, {
        timeout: 10000
    });
    return res.data || {};
}

async function fetchLivePixWidgetToken(widgetId) {
    const res = await axios.get(`${LIVEPIX_WEBSERVICE_BASE}/pubsub/widget/${widgetId}`, {
        timeout: 10000
    });
    const token = res.data?.token;
    if (!token) throw new Error('LivePix widget token not found');
    return String(token);
}

function clearLivePixWidgetTimers() {
    if (livePixWidgetReconnectTimer) {
        clearTimeout(livePixWidgetReconnectTimer);
        livePixWidgetReconnectTimer = null;
    }
    if (livePixWidgetTokenRefreshTimer) {
        clearTimeout(livePixWidgetTokenRefreshTimer);
        livePixWidgetTokenRefreshTimer = null;
    }
    if (livePixWidgetHeartbeatTimer) {
        clearTimeout(livePixWidgetHeartbeatTimer);
        livePixWidgetHeartbeatTimer = null;
    }
}

function stopLivePixWidgetSocket(options = {}) {
    const disableMode = options.disableMode === true;
    if (disableMode) livePixWidgetModeEnabled = false;
    const ws = livePixWidgetSocket;
    livePixWidgetSocket = null;
    if (!ws) return;
    try {
        ws.__manualClose = true;
        ws.removeAllListeners();
    } catch { }
    try {
        ws.close();
    } catch { }
}

function shouldTreatAsLivePixNotificationEvent(eventName = '') {
    const evt = String(eventName || '').trim().toLowerCase();
    if (!evt) return false;
    if (evt === 'notification:show') return true;
    return /(^|[:_])notification([:_])show$/.test(evt);
}

function readDeepKey(input, keys, maxDepth = 5) {
    const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
    const queue = [{ value: input, depth: 0 }];
    const visited = new Set();
    while (queue.length) {
        const node = queue.shift();
        const value = node.value;
        const depth = node.depth;
        if (!value || typeof value !== 'object') continue;
        if (visited.has(value) || depth > maxDepth) continue;
        visited.add(value);

        for (const [key, val] of Object.entries(value)) {
            if (keySet.has(String(key).toLowerCase())) return val;
            queue.push({ value: val, depth: depth + 1 });
        }
    }
    return undefined;
}

function normalizeLivePixWidgetAmount(rawAmount, currency = 'BRL') {
    const normalized = normalizeLivePixAmountValue(rawAmount, currency);
    return normalized || 'LivePix';
}

function normalizeLivePixPayment(payment, kind = 'payment') {
    if (!payment || typeof payment !== 'object') return null;
    const currency = String(payment.currency || 'BRL').trim().toUpperCase() || 'BRL';
    const donor =
        payment.tipper ||
        payment.username ||
        payment.name ||
        payment.displayName ||
        payment.sender?.name ||
        payment.supporterName ||
        'LivePix Supporter';
    const amountRaw = payment.amount ?? payment.value ?? payment.total;
    const amount = formatMoneyFromCents(amountRaw, currency);
    const amountCents = parseAmountCents(amountRaw);
    const message = payment.message || payment.text || payment.comment || payment.reference || '';
    const rawId = String(
        payment.id
        || payment.reference
        || buildSyntheticLivePixId(kind, {
            donor,
            amountRaw,
            amount,
            amountCents,
            currency,
            message,
            createdAt: payment.createdAt || payment.created_at || ''
        })
    );
    return {
        id: `${kind}:${rawId}`,
        rawId,
        event: {
            name: donor,
            amount,
            message,
            amountCents,
            currency
        },
        createdAt: payment.createdAt || payment.created_at || new Date().toISOString()
    };
}

function normalizeLivePixWebhookPayload(payload) {
    const src = payload?.data || payload?.resource || payload?.payment || payload || {};
    const kind = String(
        src.type ||
        src.resourceType ||
        payload?.type ||
        payload?.resourceType ||
        'payment'
    ).toLowerCase().includes('message') ? 'message' : 'payment';
    const donor =
        src.username ||
        src.name ||
        src.displayName ||
        src.senderName ||
        src.supporterName ||
        src.user?.name ||
        payload?.username ||
        payload?.name ||
        '';

    const rawAmount =
        src.amount ??
        src.value ??
        src.total ??
        payload?.amount ??
        payload?.value;

    const currency = String(src.currency || payload?.currency || 'BRL').trim().toUpperCase() || 'BRL';
    const amount = normalizeLivePixAmountValue(rawAmount, currency);
    const amountCents = parseAmountCents(rawAmount);

    const message =
        src.message ||
        src.text ||
        src.comment ||
        payload?.message ||
        payload?.text ||
        '';

    const id =
        src.id ||
        src.messageId ||
        payload?.id ||
        payload?.messageId ||
        src.paymentId ||
        payload?.paymentId ||
        src.reference ||
        payload?.reference;

    const hasAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '';
    if (!id && !donor && !hasAmount && !message) return null;
    const rawId = String(id || buildSyntheticLivePixId(kind, payload));
    return {
        kind,
        id: `${kind}:${rawId}`,
        rawId,
        event: {
            name: donor || 'LivePix Supporter',
            amount: amount || 'LivePix',
            message,
            amountCents,
            currency
        },
        createdAt: src.createdAt || src.created_at || payload?.createdAt || payload?.created_at || new Date().toISOString()
    };
}

function normalizeLivePixWidgetEvent(payload) {
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            return null;
        }
    }
    const fromWebhookShape = normalizeLivePixWebhookPayload(payload);
    if (fromWebhookShape) return fromWebhookShape;
    if (!payload || typeof payload !== 'object') return null;

    const donorRaw = readDeepKey(payload, ['tipper', 'username', 'name', 'displayName', 'senderName', 'supporterName', 'donor', 'from', 'author']);
    const donorFromObj = donorRaw && typeof donorRaw === 'object'
        ? (donorRaw.name || donorRaw.username || donorRaw.displayName || donorRaw.nickname)
        : donorRaw;
    const donor = String(donorFromObj || '').trim() || 'LivePix Supporter';

    const amountRaw = readDeepKey(payload, ['amount', 'value', 'total', 'grossAmount', 'paymentAmount']);
    const currencyRaw = readDeepKey(payload, ['currency', 'currencyCode']);
    const currency = String(currencyRaw || 'BRL').trim().toUpperCase() || 'BRL';
    const amount = normalizeLivePixWidgetAmount(amountRaw, currency);
    const amountCents = parseAmountCents(amountRaw);

    const messageRaw = readDeepKey(payload, ['message', 'text', 'comment', 'description']);
    const message = String(messageRaw || '').trim();

    const idRaw = readDeepKey(payload, ['id', 'messageId', 'paymentId', 'reference', 'uuid', 'eventId']);
    const typeRaw = String(readDeepKey(payload, ['type', 'event', 'eventType', 'resourceType']) || '').toLowerCase();
    const kind = typeRaw.includes('message') ? 'message' : 'payment';
    const rawId = String(idRaw || buildSyntheticLivePixId(kind, payload));

    const likelyAlertSignal = !!(amountRaw !== undefined || message || /donat|pay|tip|support|pix|super/.test(typeRaw));
    if (!likelyAlertSignal) return null;

    return {
        kind,
        id: `${kind}:${rawId}`,
        rawId,
        event: {
            name: donor,
            amount: amount || 'LivePix',
            message,
            amountCents,
            currency
        },
        createdAt: new Date().toISOString()
    };
}

function markLivePixSeen(eventId) {
    if (!eventId) return false;
    const normalizedId = String(eventId);
    if (livePixSeenIds.has(normalizedId)) return false;
    livePixSeenIds.add(normalizedId);
    if (livePixSeenIds.size > 2000) {
        const first = livePixSeenIds.values().next().value;
        livePixSeenIds.delete(first);
    }
    return true;
}

function ingestLivePixWidgetEvent(payload) {
    const normalized = normalizeLivePixWidgetEvent(payload);
    if (!normalized) return { ok: false, reason: 'invalid-payload' };

    const seenId = normalized.id.startsWith('widget:') ? normalized.id : `widget:${normalized.id}`;
    if (!markLivePixSeen(seenId)) return { ok: true, duplicate: true };

    bumpListenerEvent('livepix');
    config.livePixLastSeenAt = normalized.createdAt || new Date().toISOString();
    saveConfig({ triggerRestart: false });

    emitAlert('tip-latest', {
        ...normalized.event,
        message: normalized.event?.message || ''
    }, { platform: 'livepix' });

    return { ok: true, duplicate: false, id: seenId };
}

function tryIngestLivePixWidgetPayload(rawPayload, eventName = '') {
    const queue = [];
    const visited = new WeakSet();
    const push = (candidate) => {
        if (candidate === null || candidate === undefined) return;
        if (typeof candidate === 'string') {
            const txt = candidate.trim();
            if (!txt || !/^[[{]/.test(txt)) return;
            try {
                candidate = JSON.parse(txt);
            } catch {
                return;
            }
        }
        if (!candidate || typeof candidate !== 'object') return;
        if (visited.has(candidate)) return;
        visited.add(candidate);
        queue.push(candidate);
    };

    push(rawPayload);
    let inspected = 0;
    while (queue.length && inspected < 80) {
        inspected += 1;
        const candidate = queue.shift();
        const result = ingestLivePixWidgetEvent(candidate);
        if (result.ok) return result;

        for (const key of ['data', 'payload', 'notification', 'alert', 'item', 'items', 'event', 'events', 'message', 'messages']) {
            const nested = candidate?.[key];
            if (Array.isArray(nested)) {
                for (const entry of nested) push(entry);
            } else {
                push(nested);
            }
        }
    }
    return { ok: false, reason: 'invalid-payload', event: eventName };
}

function getBaseUrl(req) {
    if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    if (!req) return '';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    return `${proto}://${req.get('host')}`;
}

async function requestLivePixToken() {
    if (!config.livePixClientId || !config.livePixClientSecret) {
        throw new Error('LivePix client credentials missing');
    }
    const livePixScope = process.env.LIVEPIX_OAUTH_SCOPE || 'account:read wallet:read webhooks payments:read messages:read';
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.livePixClientId,
        client_secret: config.livePixClientSecret,
        scope: livePixScope
    }).toString();
    const resp = await axios.post('https://oauth.livepix.gg/oauth2/token', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const token = resp.data?.access_token;
    if (!token) throw new Error('LivePix token response missing access_token');
    const expiresIn = Number(resp.data?.expires_in || 3600);
    const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
    applyConfigPatch({
        livePixAccessToken: token,
        livePixTokenExpiresAt: expiresAt
    }, { triggerRestart: false });
    return token;
}

async function getLivePixAccessToken(forceRefresh = false) {
    if (!forceRefresh && config.livePixAccessToken && config.livePixTokenExpiresAt) {
        const exp = Date.parse(config.livePixTokenExpiresAt);
        if (Number.isFinite(exp) && exp > Date.now() + 30000) {
            return config.livePixAccessToken;
        }
    }
    return requestLivePixToken();
}

function buildLivePixAuthHeader(token, mode = 'bearer') {
    return mode === 'raw' ? token : `Bearer ${token}`;
}

async function livePixApiGet(pathname, params = {}) {
    let token = await getLivePixAccessToken(false);
    const runGet = async (authMode) => {
        return axios.get(`https://api.livepix.gg${pathname}`, {
            headers: { Authorization: buildLivePixAuthHeader(token, authMode) },
            params
        });
    };
    try {
        const res = await runGet('bearer');
        return res.data;
    } catch (err) {
        const msg = String(err?.response?.data?.message || '').toLowerCase();
        if (err.response?.status === 401 || msg.includes('invalid authentication')) {
            try {
                const rawRes = await runGet('raw');
                return rawRes.data;
            } catch (_rawErr) {
                // continue with token refresh below
            }
            token = await getLivePixAccessToken(true);
            try {
                const retryBearer = await axios.get(`https://api.livepix.gg${pathname}`, {
                    headers: { Authorization: buildLivePixAuthHeader(token, 'bearer') },
                    params
                });
                return retryBearer.data;
            } catch (retryErr) {
                const retryMsg = String(retryErr?.response?.data?.message || '').toLowerCase();
                if (retryErr?.response?.status === 401 || retryMsg.includes('invalid authentication')) {
                    const retryRaw = await axios.get(`https://api.livepix.gg${pathname}`, {
                        headers: { Authorization: buildLivePixAuthHeader(token, 'raw') },
                        params
                    });
                    return retryRaw.data;
                }
                throw retryErr;
            }
        }
        throw err;
    }
}

async function processLivePixResourceById(resourceId, kind = 'auto') {
    if (!resourceId) return;
    const kinds = kind === 'auto' ? ['message', 'payment'] : [kind];
    for (const currentKind of kinds) {
        const seenId = `${currentKind}:${resourceId}`;
        if (livePixSeenIds.has(seenId)) return;
        try {
            const endpoint = currentKind === 'message' ? `/v2/messages/${resourceId}` : `/v2/payments/${resourceId}`;
            const data = await livePixApiGet(endpoint);
            const raw = data?.data || data;
            const normalized = normalizeLivePixPayment(raw, currentKind);
            if (!normalized) continue;
            if (!markLivePixSeen(normalized.id)) return;
            bumpListenerEvent('livepix');
            config.livePixLastSeenAt = normalized.createdAt || new Date().toISOString();
            saveConfig({ triggerRestart: false });
            emitAlert('tip-latest', normalized.event, { platform: 'livepix' });
            return;
        } catch (err) {
            if (err?.response?.status === 404) continue;
            throw err;
        }
    }
}

function applyLivePixItems(items, kind = 'payment') {
    const sorted = items
        .map((item) => normalizeLivePixPayment(item, kind))
        .filter(Boolean)
        .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
    let changed = false;
    for (const item of sorted) {
        if (config.livePixLastSeenAt && Date.parse(item.createdAt) <= Date.parse(config.livePixLastSeenAt)) continue;
        if (!markLivePixSeen(item.id)) continue;
        bumpListenerEvent('livepix');
        config.livePixLastSeenAt = item.createdAt || new Date().toISOString();
        emitAlert('tip-latest', item.event, { platform: 'livepix' });
        changed = true;
    }
    return changed;
}

async function pollLivePixEvents() {
    const [messageData, paymentData] = await Promise.all([
        livePixApiGet('/v2/messages', { page: 1, limit: 20 }),
        livePixApiGet('/v2/payments', { page: 1, limit: 20 })
    ]);
    const messageItems = Array.isArray(messageData?.data) ? messageData.data : [];
    const paymentItems = Array.isArray(paymentData?.data) ? paymentData.data : [];
    const changedMessages = applyLivePixItems(messageItems, 'message');
    const changedPayments = applyLivePixItems(paymentItems, 'payment');
    if (changedMessages || changedPayments) saveConfig({ triggerRestart: false });
}

async function pollLivePixPayments() {
    await pollLivePixEvents();
}

async function syncLivePixWebhook(baseUrl) {
    const url = `${baseUrl}/webhooks/livepix`;
    const token = await getLivePixAccessToken(false);
    const fetchWebhooks = async (authMode = 'bearer') => {
        const headers = { Authorization: buildLivePixAuthHeader(token, authMode) };
        const listRes = await axios.get('https://api.livepix.gg/v2/webhooks', { headers });
        return { headers, hooks: Array.isArray(listRes.data?.data) ? listRes.data.data : [] };
    };
    let headers;
    let hooks;
    try {
        const bearerResult = await fetchWebhooks('bearer');
        headers = bearerResult.headers;
        hooks = bearerResult.hooks;
    } catch (err) {
        const msg = String(err?.response?.data?.message || '').toLowerCase();
        if (err?.response?.status === 401 || msg.includes('invalid authentication')) {
            const rawResult = await fetchWebhooks('raw');
            headers = rawResult.headers;
            hooks = rawResult.hooks;
        } else {
            throw err;
        }
    }
    const existing = hooks.find((h) => h.url === url);
    if (existing) {
        applyConfigPatch({
            livePixWebhookId: String(existing.id || ''),
            livePixWebhookUrl: url
        }, { triggerRestart: false });
        return existing;
    }
    const createRes = await axios.post('https://api.livepix.gg/v2/webhooks', { url }, { headers });
    const created = createRes.data?.data || createRes.data || {};
    applyConfigPatch({
        livePixWebhookId: String(created.id || ''),
        livePixWebhookUrl: url
    }, { triggerRestart: false });
    return created;
}

function getLivePixErrorMessage(err) {
    const body = err?.response?.data;
    if (body && typeof body === 'object') {
        const fromBody = body.message || body.error_description || body.error;
        if (fromBody) return String(fromBody);
    }
    if (typeof body === 'string' && body.trim()) return body.trim();
    return String(err?.code || err?.message || err || 'Unknown LivePix error');
}

function isLivePixAuthError(errOrMessage) {
    const status = typeof errOrMessage === 'object' ? errOrMessage?.response?.status : null;
    const msg = String(typeof errOrMessage === 'string' ? errOrMessage : getLivePixErrorMessage(errOrMessage)).toLowerCase();
    return status === 401 || msg.includes('invalid authentication') || msg.includes('invalid token') || msg.includes('unauthorized');
}

function scheduleLivePixWidgetReconnect(reason = '') {
    if (!livePixWidgetModeEnabled || !config.livePixNotificationUrl) return;
    if (livePixWidgetReconnectTimer) return;
    listenerHealth.livepix.reconnectAttempts += 1;
    const delayMs = livePixWidgetReconnectDelay;
    const suffix = reason ? ` (${reason})` : '';
    console.error(`[LivePix] PubSub reconnect in ${Math.round(delayMs / 1000)}s${suffix}`);
    livePixWidgetReconnectTimer = setTimeout(async () => {
        livePixWidgetReconnectTimer = null;
        if (!livePixWidgetModeEnabled || !config.livePixNotificationUrl) return;
        try {
            await startLivePixWidgetSocketConnection({ fromReconnect: true });
        } catch (err) {
            const msg = getLivePixErrorMessage(err);
            setListenerStatus('livepix', 'error', msg);
            scheduleLivePixWidgetReconnect(msg);
        }
    }, delayMs);
    livePixWidgetReconnectDelay = Math.min(delayMs * 2, LIVEPIX_WIDGET_RECONNECT_MAX_MS);
}

function scheduleLivePixWidgetTokenRefresh() {
    if (livePixWidgetTokenRefreshTimer) {
        clearTimeout(livePixWidgetTokenRefreshTimer);
        livePixWidgetTokenRefreshTimer = null;
    }
    livePixWidgetTokenRefreshTimer = setTimeout(async () => {
        livePixWidgetTokenRefreshTimer = null;
        if (!livePixWidgetModeEnabled || !config.livePixNotificationUrl) return;
        try {
            const widgetId = extractLivePixWidgetId(config.livePixNotificationUrl);
            if (!widgetId) throw new Error('LivePix Notification URL must contain /embed/{widgetId}');
            const token = await fetchLivePixWidgetToken(widgetId);
            if (livePixWidgetSocket && livePixWidgetSocket.readyState === WebSocket.OPEN) {
                console.log('[LivePix] Refreshing widget pubsub token');
                sendLivePixProtocolMessage(livePixWidgetSocket, 'auth', token);
                scheduleLivePixWidgetTokenRefresh();
                return;
            }
            await startLivePixWidgetSocketConnection({ fromReconnect: true });
        } catch (err) {
            const msg = getLivePixErrorMessage(err);
            setListenerStatus('livepix', 'error', msg);
            scheduleLivePixWidgetReconnect(msg);
        }
    }, LIVEPIX_WIDGET_TOKEN_REFRESH_MS);
}

async function startLivePixWidgetSocketConnection(options = {}) {
    const fromReconnect = options.fromReconnect === true;
    const widgetId = extractLivePixWidgetId(config.livePixNotificationUrl);
    if (!widgetId) {
        throw new Error('LivePix Notification URL must contain /embed/{widgetId}');
    }

    const [widgetData, token] = await Promise.all([
        fetchLivePixWidgetData(widgetId),
        fetchLivePixWidgetToken(widgetId)
    ]);
    const topics = buildLivePixPubSubTopics(widgetId, widgetData);
    if (!topics.length) topics.push(`widget:${widgetId}`);

    clearLivePixWidgetTimers();
    stopLivePixWidgetSocket();

    await new Promise((resolve, reject) => {
        const ws = new WebSocket(LIVEPIX_PUBSUB_WS, { handshakeTimeout: 10000 });
        ws.binaryType = 'arraybuffer';
        let settled = false;
        const finishResolve = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        const finishReject = (err) => {
            if (settled) return;
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err || 'LivePix socket error')));
        };

        ws.on('open', () => {
            livePixWidgetSocket = ws;
            livePixWidgetCurrentId = widgetId;
            livePixWidgetTopics = topics;
            livePixWidgetReconnectDelay = 3000;

            sendLivePixProtocolMessage(ws, 'auth', token);
            for (const topic of topics) {
                sendLivePixProtocolMessage(ws, 'subscribe', topic);
            }

            setListenerStatus('livepix', 'connected');
            if (livePixWidgetHeartbeatTimer) clearTimeout(livePixWidgetHeartbeatTimer);
            livePixWidgetHeartbeatTimer = setTimeout(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) ws.close();
                } catch { }
            }, 35000);
            scheduleLivePixWidgetTokenRefresh();
            console.log(`[LivePix] PubSub connected (${widgetId})${fromReconnect ? ' [reconnect]' : ''}`);
            finishResolve();
        });

        ws.on('message', (data) => {
            try {
                const packet = parseLivePixPubSubPacket(data);
                if (!packet) return;
                const message = normalizeLivePixPubSubMessage(packet);
                if (!message) return;
                const evt = String(message.event || '').trim().toLowerCase();
                if (livePixWidgetHeartbeatTimer) clearTimeout(livePixWidgetHeartbeatTimer);
                livePixWidgetHeartbeatTimer = setTimeout(() => {
                    try {
                        if (ws.readyState === WebSocket.OPEN) ws.close();
                    } catch { }
                }, 35000);

                if (packet.id && String(packet.id).trim()) {
                    sendLivePixProtocolMessage(ws, 'confirmation', String(packet.id).trim());
                }

                if (message.type === 1) {
                    if (evt === 'ping') {
                        sendLivePixProtocolMessage(ws, 'pong', message.payload);
                    }
                    if (evt === 'confirmation') return;
                    if (/error|unauthor|forbidden/.test(evt)) {
                        const protocolErr = String(readDeepKey(message.payload, ['message', 'error', 'reason']) || 'LivePix protocol error');
                        setListenerStatus('livepix', 'error', protocolErr);
                        try { ws.close(); } catch { }
                    }
                    return;
                }

                if (message.type !== 2) return;
                let result = { ok: false };
                if (shouldTreatAsLivePixNotificationEvent(evt)) {
                    result = tryIngestLivePixWidgetPayload(message.payload, evt);
                } else if (message.payload && typeof message.payload === 'object') {
                    const nestedEvent = String(message.payload.event || '').trim().toLowerCase();
                    if (shouldTreatAsLivePixNotificationEvent(nestedEvent)) {
                        result = tryIngestLivePixWidgetPayload(
                            message.payload.payload ?? message.payload.data ?? message.payload,
                            nestedEvent
                        );
                    }
                }
                if (!result.ok) return;
                if (result.ok && listenerStatus.livepix !== 'connected') {
                    setListenerStatus('livepix', 'connected');
                }
            } catch (err) {
                console.error('[LivePix] PubSub message parse error:', err?.message || String(err));
            }
        });

        ws.on('error', (err) => {
            const msg = err?.message || String(err);
            if (!settled) {
                finishReject(new Error(msg));
                return;
            }
            recordListenerError('livepix', msg);
            console.error('[LivePix] PubSub socket error:', msg);
        });

        ws.on('close', (code, reasonData) => {
            const reason = decodeLivePixWsData(reasonData).trim();
            const msg = `PubSub closed (${code}${reason ? `: ${reason}` : ''})`;
            const manual = ws.__manualClose === true || !livePixWidgetModeEnabled || !config.livePixNotificationUrl;
            if (livePixWidgetSocket === ws) livePixWidgetSocket = null;

            if (!settled) {
                finishReject(new Error(msg));
                return;
            }
            if (manual) return;

            setListenerStatus('livepix', 'error', msg);
            scheduleLivePixWidgetReconnect(msg);
        });
    });
}

async function runLivePixPollCycle({ initial = false } = {}) {
    try {
        await pollLivePixPayments();
        if (listenerStatus.livepix !== 'connected') {
            setListenerStatus('livepix', 'connected');
        }
        return true;
    } catch (err) {
        let nextErr = err;
        if (isLivePixAuthError(err)) {
            try {
                await getLivePixAccessToken(true);
                await pollLivePixPayments();
                if (listenerStatus.livepix !== 'connected') {
                    setListenerStatus('livepix', 'connected');
                }
                return true;
            } catch (retryErr) {
                nextErr = retryErr;
            }
        }

        listenerHealth.livepix.reconnectAttempts += 1;
        const msg = getLivePixErrorMessage(nextErr);
        console.error(initial ? '[LivePix] Initial poll warning:' : '[LivePix] Poll error:', msg);

        if (config.livePixWebhookUrl) {
            if (listenerStatus.livepix !== 'connected') {
                setListenerStatus('livepix', 'connected');
            }
            recordListenerError('livepix', msg);
        } else {
            setListenerStatus('livepix', 'error', msg);
        }
        return false;
    }
}

async function startLivePixListener() {
    if (livePixPollTimer) {
        clearInterval(livePixPollTimer);
        livePixPollTimer = null;
    }

    if (config.livePixNotificationUrl) {
        livePixWidgetModeEnabled = true;
        livePixWidgetReconnectDelay = 3000;
        try {
            await startLivePixWidgetSocketConnection();
            console.log('[LivePix] Listener started (notification URL mode)');
        } catch (err) {
            const msg = getLivePixErrorMessage(err);
            setListenerStatus('livepix', 'error', msg);
            scheduleLivePixWidgetReconnect(msg);
            console.error('[LivePix] URL mode start error:', msg);
        }
        return;
    }

    clearLivePixWidgetTimers();
    stopLivePixWidgetSocket({ disableMode: true });
    livePixWidgetCurrentId = '';
    livePixWidgetTopics = [];

    if (!config.livePixClientId || !config.livePixClientSecret) {
        console.log('[WARN] LivePix credentials missing in config.');
        setListenerStatus('livepix', 'disconnected');
        return;
    }

    await runLivePixPollCycle({ initial: true });
    livePixPollTimer = setInterval(() => {
        runLivePixPollCycle().catch((err) => {
            const msg = getLivePixErrorMessage(err);
            listenerHealth.livepix.reconnectAttempts += 1;
            console.error('[LivePix] Poll loop failure:', msg);
            if (config.livePixWebhookUrl) {
                if (listenerStatus.livepix !== 'connected') {
                    setListenerStatus('livepix', 'connected');
                }
                recordListenerError('livepix', msg);
            } else {
                setListenerStatus('livepix', 'error', msg);
            }
        });
    }, LIVEPIX_POLL_MS);
    console.log('[LivePix] Listener started (polling + webhook enabled)');
}

async function stopLivePixListener() {
    if (livePixPollTimer) {
        clearInterval(livePixPollTimer);
        livePixPollTimer = null;
    }
    clearLivePixWidgetTimers();
    stopLivePixWidgetSocket();
    setListenerStatus('livepix', 'disconnected');
}

async function restartLivePixListener(options = {}) {
    await stopLivePixListener();
    if (options.stopOnly === true) return;
    await startLivePixListener();
}

module.exports = {
    startLivePixListener, stopLivePixListener, restartLivePixListener,
    ingestLivePixWidgetEvent, normalizeLivePixWebhookPayload,
    buildSyntheticLivePixId,
    normalizeLivePixPayment, getLivePixErrorMessage,
    processLivePixResourceById, markLivePixSeen,
    getBaseUrl, syncLivePixWebhook, getLivePixAccessToken,
    get livePixWidgetCurrentId() { return livePixWidgetCurrentId; },
    get livePixWidgetTopics() { return livePixWidgetTopics; },
    get livePixSeenIds() { return livePixSeenIds; },
    extractLivePixWidgetId,
};
