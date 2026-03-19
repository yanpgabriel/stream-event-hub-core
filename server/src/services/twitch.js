'use strict';

const { StaticAuthProvider } = require('@twurple/auth');
const { ApiClient } = require('@twurple/api');
const { EventSubWsListener } = require('@twurple/eventsub-ws');
const tmi = require('tmi.js');
const axios = require('axios');
const { config } = require('../config');
const { emitAlert } = require('../alerts');
const { setListenerStatus, bumpListenerEvent, listenerHealth } = require('../health');
const { emitChatMessage } = require('./chat');

let twitchListener = null;
let twitchChatClient = null;
let twitchApiClient = null;
const twitchBadgeMap = new Map();
let hasLoadedGlobalBadges = false;
const loadedBadgeChannels = new Set();
const recentSubAlertKeys = new Map();
const SUB_ALERT_DEDUPE_MS = 15000;

function normalizeSubTier(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^prime$/i.test(raw)) return 'Prime';
    if (/^(1000|tier ?1)$/i.test(raw)) return '1000';
    if (/^(2000|tier ?2)$/i.test(raw)) return '2000';
    if (/^(3000|tier ?3)$/i.test(raw)) return '3000';
    return raw;
}

function cleanupSubAlertDedupe(now = Date.now()) {
    for (const [key, ts] of recentSubAlertKeys.entries()) {
        if (now - ts > SUB_ALERT_DEDUPE_MS) recentSubAlertKeys.delete(key);
    }
}

function shouldEmitSubAlert({ name, tier, amount, message }) {
    const now = Date.now();
    cleanupSubAlertDedupe(now);

    const key = [
        String(name || '').trim().toLowerCase(),
        normalizeSubTier(tier).toLowerCase(),
        Number.isFinite(Number(amount)) ? Math.max(1, Math.round(Number(amount))) : 1,
        String(message || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
    ].join('|');
    if (!key || key === '||1|') return true;

    const lastTs = recentSubAlertKeys.get(key);
    if (lastTs && (now - lastTs) < SUB_ALERT_DEDUPE_MS) return false;
    recentSubAlertKeys.set(key, now);
    if (recentSubAlertKeys.size > 300) {
        const first = recentSubAlertKeys.keys().next().value;
        recentSubAlertKeys.delete(first);
    }
    return true;
}

function emitTwitchSubscriptionAlert({
    name,
    tier = '',
    amount = 1,
    message = '',
    logLabel = '',
    subscriptionCount = 1,
    isGift = false,
    giftKind = ''
} = {}) {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) return false;

    const normalizedTier = normalizeSubTier(tier);
    const normalizedAmount = Number.isFinite(Number(amount))
        ? Math.max(1, Math.round(Number(amount)))
        : 1;
    const normalizedMessage = String(message || '').replace(/\s+/g, ' ').trim();

    if (!shouldEmitSubAlert({
        name: normalizedName,
        tier: normalizedTier,
        amount: normalizedAmount,
        message: normalizedMessage
    })) {
        return false;
    }

    bumpListenerEvent('twitch');
    if (logLabel) {
        console.log(`[Twitch] ${logLabel}: ${normalizedName} (Tier: ${normalizedTier || 'unknown'}, Amount: ${normalizedAmount})`);
    }
    emitAlert('subscriber-latest', {
        name: normalizedName,
        amount: normalizedAmount,
        tier: normalizedTier,
        subscriptionCount: Number.isFinite(Number(subscriptionCount))
            ? Math.max(1, Math.round(Number(subscriptionCount)))
            : 1,
        isGift: isGift === true,
        ...(giftKind ? { giftKind: String(giftKind) } : {}),
        ...(normalizedMessage ? { message: normalizedMessage } : {})
    }, { platform: 'twitch' });
    return true;
}

async function safeRegisterEventSub(label, registerFn) {
    try {
        await registerFn();
        console.log(`[Twitch] EventSub subscribed: ${label}`);
        return true;
    } catch (err) {
        console.error(`[Twitch] EventSub subscription failed (${label}):`, err?.message || String(err));
        return false;
    }
}

function setTwitchBadge(setId, version, url) {
    const normalizedSetId = String(setId || '').trim().toLowerCase();
    const normalizedVersion = String(version || '').trim();
    const normalizedUrl = String(url || '').trim();
    if (!normalizedSetId || !normalizedVersion || !normalizedUrl) return;
    twitchBadgeMap.set(`${normalizedSetId}/${normalizedVersion}`, normalizedUrl);
}

function indexBadgePayload(payload) {
    const sets = payload?.badge_sets;
    if (!sets || typeof sets !== 'object') return;
    for (const [setId, badgeSet] of Object.entries(sets)) {
        const versions = badgeSet?.versions;
        if (!versions || typeof versions !== 'object') continue;
        for (const [version, item] of Object.entries(versions)) {
            const url = item?.image_url_4x || item?.image_url_2x || item?.image_url_1x || '';
            setTwitchBadge(setId, version, url);
        }
    }
}

function indexHelixBadgeSets(badgeSets = []) {
    if (!Array.isArray(badgeSets)) return;
    for (const badgeSet of badgeSets) {
        const setId = String(badgeSet?.id || '').trim().toLowerCase();
        if (!setId) continue;
        const versions = Array.isArray(badgeSet?.versions) ? badgeSet.versions : [];
        for (const badgeVersion of versions) {
            const versionId = String(badgeVersion?.id || '').trim();
            if (!versionId) continue;
            const url = (() => {
                try {
                    return badgeVersion?.getImageUrl?.(4)
                        || badgeVersion?.getImageUrl?.(2)
                        || badgeVersion?.getImageUrl?.(1)
                        || '';
                } catch {
                    return '';
                }
            })();
            if (!url) {
                const fallbackUrl = badgeVersion?.image_url_4x
                    || badgeVersion?.image_url_2x
                    || badgeVersion?.image_url_1x
                    || '';
                setTwitchBadge(setId, versionId, fallbackUrl);
                continue;
            }
            setTwitchBadge(setId, versionId, url);
        }
    }
}

async function loadTwitchBadgeCatalog(channelId = '', apiClient = twitchApiClient) {
    twitchBadgeMap.clear();
    hasLoadedGlobalBadges = false;
    loadedBadgeChannels.clear();

    await loadGlobalBadgeCatalog(apiClient);
    await loadChannelBadgeCatalog(channelId, apiClient);
}

async function loadGlobalBadgeCatalog(apiClient = twitchApiClient) {
    if (hasLoadedGlobalBadges) return;
    twitchBadgeMap.clear();

    if (apiClient?.chat?.getGlobalBadges) {
        try {
            const badgeSets = await apiClient.chat.getGlobalBadges();
            indexHelixBadgeSets(badgeSets);
            hasLoadedGlobalBadges = true;
            return;
        } catch (err) {
            console.error('[Twitch] Could not load global badge catalog via Helix:', err?.message || String(err));
        }
    }

    const req = { timeout: 12000, validateStatus: () => true };

    try {
        const globalRes = await axios.get('https://badges.twitch.tv/v1/badges/global/display', req);
        if (globalRes.status >= 200 && globalRes.status < 300) {
            indexBadgePayload(globalRes.data);
            hasLoadedGlobalBadges = true;
        }
    } catch (err) {
        console.error('[Twitch] Could not load global badge catalog:', err?.message || String(err));
    }
}

async function loadChannelBadgeCatalog(channelId = '', apiClient = twitchApiClient) {
    const normalizedChannelId = String(channelId || '').trim();
    if (!normalizedChannelId || loadedBadgeChannels.has(normalizedChannelId)) return;

    if (apiClient?.chat?.getChannelBadges) {
        try {
            const badgeSets = await apiClient.chat.getChannelBadges(normalizedChannelId);
            indexHelixBadgeSets(badgeSets);
            loadedBadgeChannels.add(normalizedChannelId);
            return;
        } catch (err) {
            console.error('[Twitch] Could not load channel badge catalog via Helix:', err?.message || String(err));
        }
    }

    const req = { timeout: 12000, validateStatus: () => true };

    try {
        const channelRes = await axios.get(`https://badges.twitch.tv/v1/badges/channels/${encodeURIComponent(normalizedChannelId)}/display`, req);
        if (channelRes.status >= 200 && channelRes.status < 300) {
            indexBadgePayload(channelRes.data);
            loadedBadgeChannels.add(normalizedChannelId);
        }
    } catch (err) {
        console.error('[Twitch] Could not load channel badge catalog:', err?.message || String(err));
    }
}

function buildTwitchChatBadges(tags) {
    const rawBadges = tags?.badges;
    if (!rawBadges) return [];
    const badgeEntries = [];
    if (typeof rawBadges === 'string') {
        const parts = rawBadges.split(',').map((part) => part.trim()).filter(Boolean);
        for (const part of parts) {
            const [setId, version] = part.split('/');
            badgeEntries.push([setId, version]);
        }
    } else if (typeof rawBadges === 'object') {
        badgeEntries.push(...Object.entries(rawBadges));
    } else {
        return [];
    }
    const out = [];

    for (const [setId, version] of badgeEntries) {
        if (out.length >= 4) break;
        const normalizedSetId = String(setId || '').trim().toLowerCase();
        const normalizedVersion = String(version || '').trim();
        if (!normalizedSetId || !normalizedVersion) continue;
        const url = twitchBadgeMap.get(`${normalizedSetId}/${normalizedVersion}`);
        if (url) {
            out.push({ type: 'img', src: url, setId: normalizedSetId, version: normalizedVersion });
            continue;
        }
        const label = twitchBadgeFallbackLabel(setId, version);
        if (label) out.push({ type: 'text', text: label, setId: normalizedSetId, version: normalizedVersion });
    }

    return out;
}

function twitchBadgeFallbackLabel(setId, version) {
    const key = String(setId || '').trim().toLowerCase();
    if (!key) return '';

    if (key === 'subscriber') {
        const v = String(version || '').trim();
        if (/^\d+$/.test(v) && Number(v) > 0) return `SUB ${Number(v)}`;
        return 'SUB';
    }
    if (key === 'founder') return 'FDR';
    if (key === 'moderator') return 'MOD';
    if (key === 'vip') return 'VIP';
    if (key === 'broadcaster') return 'HOST';
    if (key === 'partner') return 'PART';
    if (key === 'premium') return 'PRIME';
    if (key === 'staff') return 'STAFF';
    if (key === 'bits' && version) return 'BITS';
    return '';
}

function normalizeTwitchChannelName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^#/, '');
}

function buildTwitchAvatarUrl(tags) {
    const username = String(tags?.username || tags?.['display-name'] || '')
        .trim()
        .toLowerCase();
    if (!username) return '';
    return `https://unavatar.io/twitch/${encodeURIComponent(username)}`;
}

async function stopTwitchChatClient() {
    if (!twitchChatClient) return;
    try {
        await twitchChatClient.disconnect();
        console.log('[Twitch] Chat listener stopped');
    } catch (err) {
        console.error('[Twitch] Chat stop error:', err?.message || String(err));
    } finally {
        twitchChatClient = null;
    }
}

async function startTwitchChatClient({ username, channelName, accessToken }) {
    if (!channelName) return;
    await stopTwitchChatClient();

    const connectClient = async (mode) => {
        const authenticated = mode === 'authenticated';
        const identity = (() => {
            if (!authenticated) return null;
            if (!username || !accessToken) return null;
            const password = String(accessToken).startsWith('oauth:')
                ? String(accessToken)
                : `oauth:${accessToken}`;
            return { username, password };
        })();

        const client = new tmi.Client({
            options: { debug: false },
            connection: { secure: true, reconnect: true },
            ...(identity ? { identity } : {}),
            channels: [channelName]
        });

        client.on('message', async (_channel, tags, message, self) => {
            if (self) return;
            const roomId = String(tags?.['room-id'] || '').trim();
            if (roomId && !loadedBadgeChannels.has(roomId)) {
                await loadChannelBadgeCatalog(roomId).catch((err) => {
                    console.error('[Twitch] Could not load room badge catalog:', err?.message || String(err));
                });
            }

            const bits = Number(tags?.bits || 0);
            const donation = Number.isFinite(bits) && bits > 0 ? `${bits} bits` : '';
            const normalized = emitChatMessage({
                id: tags?.id || '',
                source: 'twitch',
                userId: tags?.['user-id'] || '',
                chatname: tags?.['display-name'] || tags?.username || 'Unknown',
                chatmessage: String(message || ''),
                donation,
                hasDonation: donation,
                chatbadges: buildTwitchChatBadges(tags),
                chatimg: buildTwitchAvatarUrl(tags)
            }, { source: 'twitch' });
            if (normalized) bumpListenerEvent('twitch');
        });

        const tierFromTagsAndMethod = (tags = {}, methods = {}) => {
            const planFromTags = String(tags?.['msg-param-sub-plan'] || '').trim();
            const planFromMethod = String(methods?.plan || methods?.tier || methods?.planName || '').trim();
            return normalizeSubTier(planFromTags || planFromMethod);
        };

        client.on('subscription', (_channel, username, methods, message, userstate) => {
            emitTwitchSubscriptionAlert({
                name: username,
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: 1,
                subscriptionCount: 1,
                message: message || userstate?.['system-msg'] || '',
                logLabel: 'Chat New Sub'
            });
        });

        client.on('resub', (_channel, username, months, message, userstate, methods) => {
            emitTwitchSubscriptionAlert({
                name: username,
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: Number(months) || 1,
                subscriptionCount: 1,
                message: message || userstate?.['system-msg'] || '',
                logLabel: 'Chat Resub'
            });
        });

        client.on('subgift', (_channel, username, _streakMonths, recipient, methods, userstate) => {
            const recipientName = String(recipient || userstate?.['msg-param-recipient-display-name'] || '').trim();
            emitTwitchSubscriptionAlert({
                name: recipientName,
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: 1,
                subscriptionCount: 1,
                isGift: true,
                giftKind: 'single',
                message: username ? `Gifted by ${username}` : '',
                logLabel: 'Chat Gift Sub'
            });
        });

        client.on('anonsubgift', (_channel, _streakMonths, recipient, methods, userstate) => {
            const recipientName = String(recipient || userstate?.['msg-param-recipient-display-name'] || '').trim();
            emitTwitchSubscriptionAlert({
                name: recipientName,
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: 1,
                subscriptionCount: 1,
                isGift: true,
                giftKind: 'anonymous-single',
                message: 'Gifted anonymously',
                logLabel: 'Chat Anonymous Gift Sub'
            });
        });

        client.on('submysterygift', (_channel, username, numOfSubs, methods, userstate) => {
            const giftedCount = Number(numOfSubs) || 1;
            emitTwitchSubscriptionAlert({
                name: username || 'Anonymous',
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: giftedCount,
                subscriptionCount: giftedCount,
                isGift: true,
                giftKind: 'bomb',
                message: '',
                logLabel: 'Chat Gift Bomb'
            });
        });

        client.on('anonsubmysterygift', (_channel, numOfSubs, methods, userstate) => {
            const giftedCount = Number(numOfSubs) || 1;
            emitTwitchSubscriptionAlert({
                name: 'Anonymous',
                tier: tierFromTagsAndMethod(userstate, methods),
                amount: giftedCount,
                subscriptionCount: giftedCount,
                isGift: true,
                giftKind: 'anonymous-bomb',
                message: '',
                logLabel: 'Chat Anonymous Gift Bomb'
            });
        });

        client.on('connected', () => {
            console.log(`[Twitch] Chat connected to #${channelName} (${authenticated ? 'auth' : 'anonymous'})`);
        });

        client.on('disconnected', (reason) => {
            console.log(`[Twitch] Chat disconnected: ${reason || 'unknown reason'}`);
        });

        await client.connect();
        return client;
    };

    const canAuthenticate = !!(String(username || '').trim() && String(accessToken || '').trim());
    try {
        if (canAuthenticate) {
            twitchChatClient = await connectClient('authenticated');
            console.log(`[Twitch] Chat listener started for #${channelName}`);
            return;
        }
        twitchChatClient = await connectClient('anonymous');
        console.log(`[Twitch] Anonymous chat listener started for #${channelName}`);
    } catch (authErr) {
        if (!canAuthenticate) throw authErr;
        console.error('[Twitch] Authenticated chat connection failed:', authErr?.message || String(authErr));
        console.log('[Twitch] Retrying chat in anonymous read-only mode...');
        twitchChatClient = await connectClient('anonymous');
        console.log(`[Twitch] Anonymous chat listener started for #${channelName}`);
    }
}

async function startTwitchListener() {
    const channelOverride = normalizeTwitchChannelName(config.twitchChatChannel || '');
    await stopTwitchChatClient();
    twitchApiClient = null;

    if (!config.twitchAccessToken || !config.twitchClientId) {
        console.log('[WARN] Twitch credentials missing in config.');
        setListenerStatus('twitch', 'disconnected');
        if (channelOverride) {
            try {
                await loadTwitchBadgeCatalog('');
                await startTwitchChatClient({
                    username: '',
                    channelName: channelOverride,
                    accessToken: ''
                });
                setListenerStatus('twitch', 'connected');
                console.log(`[Twitch] Chat-only anonymous listener started for #${channelOverride}`);
            } catch (err) {
                console.error('[Twitch] Chat-only listener error:', err?.message || String(err));
            }
        }
        return;
    }

    await stopTwitchChatClient();

    const authProvider = new StaticAuthProvider(config.twitchClientId, config.twitchAccessToken);
    const apiClient = new ApiClient({ authProvider });
    twitchApiClient = apiClient;
    const listener = new EventSubWsListener({ apiClient });
    twitchListener = listener;

    try {
        const user = await apiClient.users.getAuthenticatedUser(config.twitchAccessToken);
        if (!user) {
            const msg = 'Could not get authenticated user';
            console.error('[Twitch] ' + msg);
            setListenerStatus('twitch', 'error', msg);
            return;
        }

        const broadcasterId = user.id;
        console.log(`[Twitch] ID: ${broadcasterId} (${user.name})`);

        await listener.start();
        setListenerStatus('twitch', 'connected');
        console.log('[Twitch] EventSub listener started');

        await safeRegisterEventSub('channel.follow', () => listener.onChannelFollow(broadcasterId, broadcasterId, (e) => {
            bumpListenerEvent('twitch');
            console.log(`[Twitch] Follow: ${e.userName}`);
            emitAlert('follower-latest', { name: e.userName }, { platform: 'twitch' });
        }));

        const subCreated = await safeRegisterEventSub('channel.subscribe', () => listener.onChannelSubscription(broadcasterId, (event) => {
            emitTwitchSubscriptionAlert({
                name: event.userName,
                amount: 1,
                subscriptionCount: 1,
                tier: event.tier,
                logLabel: 'New Sub'
            });
        }));

        const subMessageCreated = await safeRegisterEventSub('channel.subscription.message', () => listener.onChannelSubscriptionMessage(broadcasterId, (event) => {
            emitTwitchSubscriptionAlert({
                name: event.userName,
                amount: event.cumulativeMonths || 1,
                subscriptionCount: 1,
                tier: event.tier,
                message: event.messageText,
                logLabel: 'Resub'
            });
        }));

        if (!subCreated || !subMessageCreated) {
            console.error('[Twitch] Subscription EventSub registration failed. Falling back to chat USERNOTICE sub events.');
            console.error('[Twitch] Verify token scope includes `channel:read:subscriptions` for reliable EventSub sub alerts.');
        }

        await safeRegisterEventSub('channel.cheer', () => listener.onChannelCheer(broadcasterId, (event) => {
            bumpListenerEvent('twitch');
            console.log(`[Twitch] Cheer: ${event.userName} (${event.bits} bits)`);
            emitAlert('cheer-latest', { name: event.userName, amount: event.bits, message: event.message }, { platform: 'twitch' });
        }));

        await safeRegisterEventSub('channel.raid.from', () => listener.onChannelRaidFrom(broadcasterId, (event) => {
            bumpListenerEvent('twitch');
            console.log(`[Twitch] Raid from: ${event.raidingBroadcasterDisplayName} (${event.viewers} viewers)`);
            emitAlert('raid-latest', { name: event.raidingBroadcasterDisplayName, amount: event.viewers }, { platform: 'twitch' });
        }));

        const channelName = normalizeTwitchChannelName(config.twitchChatChannel || user.name);
        let channelIdForBadges = broadcasterId;
        if (channelName && channelName !== String(user.name || '').toLowerCase()) {
            try {
                const channelUser = await apiClient.users.getUserByName(channelName);
                if (channelUser?.id) {
                    channelIdForBadges = channelUser.id;
                }
            } catch (resolveErr) {
                console.error('[Twitch] Could not resolve channel for badge catalog:', resolveErr?.message || String(resolveErr));
            }
        }

        await loadTwitchBadgeCatalog(channelIdForBadges);
        if (channelName) {
            try {
                await startTwitchChatClient({
                    username: user.name,
                    channelName,
                    accessToken: config.twitchAccessToken
                });
            } catch (chatErr) {
                console.error('[Twitch] Chat listener error:', chatErr?.message || String(chatErr));
                console.error('[Twitch] Ensure token includes `chat:read` scope for chat ingestion.');
            }
        }
    } catch (e) {
        const msg = e?.message || String(e);
        listenerHealth.twitch.reconnectAttempts += 1;
        console.error('[Twitch] Start Error:', msg);
        setListenerStatus('twitch', 'error', msg);

        if (channelOverride) {
            console.log(`[Twitch] Falling back to anonymous chat-only mode for #${channelOverride}`);
            try {
                await loadTwitchBadgeCatalog('', null);
                await startTwitchChatClient({
                    username: '',
                    channelName: channelOverride,
                    accessToken: ''
                });
                setListenerStatus('twitch', 'connected');
                console.log(`[Twitch] Anonymous fallback chat listener started for #${channelOverride}`);
            } catch (fallbackErr) {
                console.error('[Twitch] Anonymous fallback failed:', fallbackErr?.message || String(fallbackErr));
            }
        }
    }
}

async function stopTwitchListener() {
    if (twitchListener) {
        try {
            twitchListener.stop();
            console.log('[Twitch] Listener stopped');
        } catch (e) {
            console.error('[Twitch] Stop error:', e.message);
        }
    }
    twitchListener = null;
    await stopTwitchChatClient();
    setListenerStatus('twitch', 'disconnected');
}

async function restartTwitchListener(options = {}) {
    await stopTwitchListener();
    if (options.stopOnly === true) return;
    await startTwitchListener();
}

async function moderateTwitchChat({ action, chatname, id }) {
    if (!twitchChatClient) throw new Error("Twitch chat client not connected via OAuth");
    const channelName = normalizeTwitchChannelName(config.twitchChatChannel);
    if (!channelName) throw new Error("No twitch channel configured");
    
    if (!chatname && action !== 'delete') throw new Error("Missing chatname for moderation");
    if (!id && action === 'delete') throw new Error("Missing message ID for deletion");

    if (action === 'delete') {
        await twitchChatClient.deletemessage(channelName, id);
    } else if (action === 'timeout') {
         // Default timeout 600s
         await twitchChatClient.timeout(channelName, chatname, 600, "Timeout from Stream Event Hub Core");
    } else if (action === 'ban') {
         await twitchChatClient.ban(channelName, chatname, "Banned from Stream Event Hub Core");
    } else {
        throw new Error("Unknown action: " + action);
    }
    return true;
}

module.exports = { startTwitchListener, stopTwitchListener, restartTwitchListener, moderateTwitchChat };
