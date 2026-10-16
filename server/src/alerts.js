'use strict';

const fs = require('fs');
const ctx = require('./ctx');
const { config, ALERT_HISTORY_PATH, MAX_HISTORY, MAX_QUEUE_ITEMS, DEFAULT_CONFIG, saveConfig } = require('./config');
const sessionMetrics = require('./sessionMetrics');

let alertHistory = [];
let chatService = null;
const REPLAY_HISTORY_MAX_AGE_MS = 2 * 60 * 1000;

function parseTimestampMs(value) {
    if (!value) return 0;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
}

function normalizePlatform(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'yt') return 'youtube';
    if (raw === 'tw') return 'twitch';
    if (raw === 'lp' || raw === 'live_pix') return 'livepix';
    if (raw === 'youtube' || raw === 'twitch' || raw === 'livepix' || raw === 'manual' || raw === 'replay') return raw;
    return '';
}

function isReplayHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.replay === true) return true;
    const source = String(entry.source || '').trim().toLowerCase();
    if (source === 'replay') return true;
    const explicit = normalizePlatform(entry.platform || entry?.event?.platform || entry?.event?.source || '');
    if (explicit === 'replay') return true;
    const listener = String(entry.listener || '').trim().toLowerCase();
    return listener.startsWith('replay');
}

function inferLegacyPlatform(entry) {
    const explicit = normalizePlatform(entry?.platform || entry?.event?.platform || entry?.event?.source || '');
    if (explicit) return explicit;

    const listener = String(entry?.listener || '').toLowerCase();
    if (listener.startsWith('youtube')) return 'youtube';
    if (listener.startsWith('twitch')) return 'twitch';
    if (listener.startsWith('livepix')) return 'livepix';

    // Historical fallback: tip events without platform were primarily ingested from LivePix.
    if (listener === 'tip-latest' || String(entry?.type || '').toLowerCase() === 'tip') {
        return 'livepix';
    }

    return '';
}

function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const next = { ...entry };
    const eventObj = next.event && typeof next.event === 'object' ? { ...next.event } : next.event;
    const inferredPlatform = inferLegacyPlatform(next);
    const replay = isReplayHistoryEntry(next);

    if (replay) {
        next.replay = true;
        next.source = 'replay';
        next.platform = 'replay';
        if (eventObj && typeof eventObj === 'object') {
            eventObj.replay = true;
            if (!eventObj.originalPlatform) {
                const original = normalizePlatform(eventObj.platform || eventObj.source || inferredPlatform);
                if (original && original !== 'replay') eventObj.originalPlatform = original;
            }
            eventObj.platform = 'replay';
            eventObj.source = 'replay';
        }
    } else if (inferredPlatform) {
        next.platform = inferredPlatform;
        if (eventObj && typeof eventObj === 'object') {
            if (!eventObj.platform) eventObj.platform = inferredPlatform;
        }
    }

    if (eventObj && typeof eventObj === 'object') {
        next.event = eventObj;
    }
    return next;
}

function rewriteAlertHistoryFile() {
    try {
        const content = alertHistory.length
            ? `${alertHistory.slice().reverse().map((entry) => JSON.stringify(entry)).join('\n')}\n`
            : '';
        fs.writeFileSync(ALERT_HISTORY_PATH, content);
    } catch (e) {
        console.error('Failed to rewrite alert history:', e.message);
    }
}

function pruneExpiredReplayHistory({ persist = true, nowMs = Date.now() } = {}) {
    if (!alertHistory.length) return 0;
    const replayCutoff = nowMs - REPLAY_HISTORY_MAX_AGE_MS;
    let removed = 0;
    for (let i = alertHistory.length - 1; i >= 0; i -= 1) {
        const entry = alertHistory[i];
        if (!isReplayHistoryEntry(entry)) continue;
        const ts = parseTimestampMs(entry?.timestamp);
        if (!ts || ts < replayCutoff) {
            alertHistory.splice(i, 1);
            removed += 1;
        }
    }
    if (removed > 0 && persist) {
        rewriteAlertHistoryFile();
    }
    return removed;
}

function ensureAlertVisualPriority(target) {
    if (target !== 'production') return;
    try {
        if (!chatService) chatService = require('./services/chat');
        if (!chatService || typeof chatService.clearFeaturedChatMessage !== 'function') return;
        chatService.clearFeaturedChatMessage();
    } catch (err) {
        console.error('[ALERT] Failed to auto-hide featured chat before alert:', err?.message || String(err));
    }
}

function loadAlertHistory() {
    try {
        if (!fs.existsSync(ALERT_HISTORY_PATH)) {
            alertHistory.length = 0;
            return;
        }
        const lines = fs.readFileSync(ALERT_HISTORY_PATH, 'utf8').split('\n').filter(Boolean);
        const loaded = lines
            .map((line) => {
                try {
                    return normalizeHistoryEntry(JSON.parse(line));
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .slice(-MAX_HISTORY)
            .reverse();
        alertHistory.length = 0;
        alertHistory.push(...loaded);
        pruneExpiredReplayHistory({ persist: true });
        if (lines.length !== loaded.length) {
            rewriteAlertHistoryFile();
        }
    } catch (e) {
        console.error('Failed to load alert history:', e.message);
        alertHistory.length = 0;
    }
}

function appendAlertHistory(entry) {
    pruneExpiredReplayHistory({ persist: true });
    const normalizedEntry = normalizeHistoryEntry(entry) || entry;
    try {
        fs.appendFileSync(ALERT_HISTORY_PATH, `${JSON.stringify(normalizedEntry)}\n`);
    } catch (e) {
        console.error('Failed to persist history:', e.message);
    }
    alertHistory.unshift(normalizedEntry);
    if (alertHistory.length > MAX_HISTORY) {
        alertHistory.length = MAX_HISTORY;
        rewriteAlertHistoryFile();
    }
}

function filterHistory(items, query = {}) {
    const type = query.type || '';
    const source = query.source || '';
    const listener = query.listener || '';
    const search = (query.search || '').toLowerCase();
    const from = query.from ? Date.parse(query.from) : null;
    const to = query.to ? Date.parse(query.to) : null;

    return items.filter((entry) => {
        if (type && entry.type !== type) return false;
        if (source && !String(entry.listener || '').startsWith(source)) return false;
        if (listener && entry.listener !== listener) return false;
        const ts = Date.parse(entry.timestamp);
        if (from && ts < from) return false;
        if (to && ts > to) return false;
        if (search) {
            const blob = `${entry.type} ${entry.listener} ${entry.event?.name || ''} ${entry.event?.message || ''}`.toLowerCase();
            if (!blob.includes(search)) return false;
        }
        return true;
    });
}

function historyCsv(items) {
    const head = ['id', 'timestamp', 'listener', 'type', 'name', 'amount', 'message', 'tier'];
    const rows = items.map((e) => [
        e.id,
        e.timestamp,
        e.listener,
        e.type,
        e.event?.name || '',
        e.event?.amount || '',
        (e.event?.message || '').replace(/\r?\n/g, ' '),
        e.event?.tier || ''
    ]);
    const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [head, ...rows].map((line) => line.map(esc).join(',')).join('\n');
}

const outboundQueue = [];
let queueCurrent = null;

function queueStatus() {
    return {
        pending: outboundQueue.length,
        currentlyPlaying: !!queueCurrent,
        current: queueCurrent,
        updatedAt: new Date().toISOString()
    };
}

function enqueueAlertDispatch(item) {
    if (outboundQueue.length >= MAX_QUEUE_ITEMS) {
        outboundQueue.shift();
    }
    outboundQueue.push(item);
    processOutboundQueue();
}

function processOutboundQueue() {
    if (!ctx.io) return;
    if (queueCurrent || outboundQueue.length === 0) return;
    queueCurrent = outboundQueue.shift();

    if (queueCurrent.target === 'sandbox') {
        ctx.io.emit('event:sandbox', queueCurrent.payload);
    } else {
        ctx.io.emit('event', queueCurrent.payload);
    }

    setTimeout(() => {
        queueCurrent = null;
        processOutboundQueue();
    }, 40);
}

const typeMap = {
    'follower-latest': 'follow',
    'subscriber-latest': 'sub',
    'tip-latest': 'tip',
    'cheer-latest': 'cheer',
    'raid-latest': 'raid'
};

function buildEventPayload(listener, eventData, target = 'production') {
    const key = typeMap[listener] || 'unknown';
    const soundCfg = (config.alertSounds && config.alertSounds[key]) || { url: '', volume: 80 };
    const ttsCfg = config.ttsConfig || DEFAULT_CONFIG.ttsConfig;
    const duration = config.alertDuration || 6;
    const alertMessageTextSize = Number(config.alertMessageTextSize || DEFAULT_CONFIG.alertMessageTextSize || 32);
    return {
        listener,
        event: eventData,
        sound: soundCfg,
        tts: ttsCfg,
        alertDuration: duration,
        alertMessageTextSize,
        target
    };
}

function resolveEventPlatform(listener, eventData, opts = {}) {
    const explicit = normalizePlatform(opts.platform || eventData?.platform || eventData?.source || '');
    if (explicit) return explicit;

    const low = String(listener || '').toLowerCase();
    if (low.startsWith('youtube')) return 'youtube';
    if (low.startsWith('twitch')) return 'twitch';
    if (low.startsWith('livepix')) return 'livepix';
    if (low === 'tip-latest') return 'livepix';
    return '';
}

function findLatestAlertEntryByType(type) {
    return alertHistory.find((entry) => {
        if (!entry || entry.type !== type || entry.replay || entry.origin === 'test') return false;
        const name = String(entry?.event?.name || '').trim();
        return !!name;
    }) || null;
}

function buildWidgetMeta(entry, fallbackName = '') {
    if (!entry) {
        return {
            name: String(fallbackName || ''),
            timestamp: '',
            platform: '',
            listener: ''
        };
    }

    const name = String(entry?.event?.name || fallbackName || '');
    return {
        name,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
        platform: normalizePlatform(entry.platform || entry?.event?.platform || entry?.event?.source || ''),
        listener: String(entry.listener || '')
    };
}

function getLatestWidgetData() {
    const latestFollow = findLatestAlertEntryByType('follow');
    const latestSub = findLatestAlertEntryByType('sub');

    const lastFollowerMeta = buildWidgetMeta(latestFollow, config.lastFollower || '');
    const lastSubMeta = buildWidgetMeta(latestSub, config.lastSub || '');

    return {
        lastFollower: lastFollowerMeta.name || String(config.lastFollower || ''),
        lastSub: lastSubMeta.name || String(config.lastSub || ''),
        lastFollowerMeta,
        lastSubMeta
    };
}

function emitAlert(listener, eventData, opts = {}) {
    const target = opts.target || 'production';
    const ignoreToggles = opts.ignoreToggles === true;
    const recordHistory = opts.recordHistory !== false;
    if (!config.alertToggles) config.alertToggles = { ...DEFAULT_CONFIG.alertToggles };
    const key = typeMap[listener];
    const requestedPlatform = normalizePlatform(opts.platform || eventData?.platform || eventData?.source || '');
    const replay = opts.replay === true || requestedPlatform === 'replay';
    const platform = replay ? 'replay' : resolveEventPlatform(listener, eventData, opts);
    const payloadEventData = (eventData && typeof eventData === 'object')
        ? { ...eventData }
        : { name: String(eventData || '') };
    if (replay) {
        const originalPlatform = normalizePlatform(payloadEventData.platform || payloadEventData.source || '');
        if (originalPlatform && originalPlatform !== 'replay' && !payloadEventData.originalPlatform) {
            payloadEventData.originalPlatform = originalPlatform;
        }
        payloadEventData.platform = 'replay';
        payloadEventData.source = 'replay';
        payloadEventData.replay = true;
    } else if (platform && !payloadEventData.platform) {
        payloadEventData.platform = platform;
    }

    const suppressed = !ignoreToggles && target === 'production' && key && config.alertToggles[key] === false;

    if (target === 'production' && recordHistory) {
        let shouldSaveConfig = false;
        if (!replay && opts.origin !== 'test' && key === 'follow' && payloadEventData.name) {
            config.lastFollower = payloadEventData.name;
            shouldSaveConfig = true;
        } else if (!replay && opts.origin !== 'test' && key === 'sub' && payloadEventData.name) {
            config.lastSub = payloadEventData.name;
            shouldSaveConfig = true;
        }

        if (shouldSaveConfig) {
            saveConfig({ triggerRestart: false });
        }

        const historyEntry = {
            id: Date.now() + Math.round(Math.random() * 1000),
            timestamp: new Date().toISOString(),
            listener,
            type: key || 'unknown',
            source: replay
                ? 'replay'
                : (listener.startsWith('follower') || listener.startsWith('subscriber') || listener.startsWith('raid') || listener.startsWith('cheer') || listener.startsWith('tip') ? 'stream' : 'manual'),
            platform: replay ? 'replay' : platform,
            replay,
            origin: opts.origin || (replay ? 'replay' : 'provider'),
            suppressed: !!suppressed,
            event: payloadEventData
        };
        appendAlertHistory(historyEntry);
        ctx.io.of('/admin').emit('alert-history-update', historyEntry);
        try {
            sessionMetrics.recordAlertHistoryEntry(historyEntry, { persist: true, emit: true });
        } catch (metricsErr) {
            console.error('[SessionMetrics] Failed to record alert event:', metricsErr?.message || String(metricsErr));
        }

        if (!replay && (key === 'follow' || key === 'sub')) {
            ctx.io.emit('widget-update', getLatestWidgetData());
        }
        require('./services/overlay').emitState();
    }

    if (suppressed) return;

    // Keep alerts visually unobstructed by featured chat overlays.
    ensureAlertVisualPriority(target);

    enqueueAlertDispatch({
        id: Date.now() + Math.round(Math.random() * 1000),
        createdAt: new Date().toISOString(),
        target,
        payload: buildEventPayload(listener, payloadEventData, target)
    });
}

module.exports = {
    get alertHistory() { return alertHistory; },
    loadAlertHistory, appendAlertHistory, filterHistory, historyCsv,
    pruneExpiredReplayHistory, isReplayHistoryEntry,
    outboundQueue, queueStatus, enqueueAlertDispatch, processOutboundQueue,
    typeMap, buildEventPayload, emitAlert, getLatestWidgetData,
};
