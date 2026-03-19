'use strict';

const { LiveChat } = require('youtube-chat');
const { fetchLivePage } = require('youtube-chat/dist/requests');
const axios = require('axios');
const { config } = require('../config');
const { validateConfigPatch, applyConfigPatch } = require('../config');
const { emitAlert } = require('../alerts');
const { setListenerStatus, bumpListenerEvent, listenerStatus, listenerHealth } = require('../health');
const { emitChatMessage } = require('./chat');

let youtubeListener = null;
let liveChat = null;
let ytReconnectDelay = 5000;
let ytReconnectTimer = null;
let ytRestartInProgress = false;
let ytWatchdogTimer = null;
const YT_MAX_RECONNECT_DELAY = 60000;
const YT_WATCHDOG_MS = 30000;
const ytSeenIds = new Set();
const YT_SEEN_MAX = 2000;
const ytRecentMembershipAlerts = new Map();
const YT_NEW_MEMBERSHIP_DEDUPE_MS = 120000;
const YT_OFFICIAL_MIN_POLL_MS = 2000;
const YT_OFFICIAL_MAX_POLL_MS = 30000;
const YT_OFFICIAL_DEFAULT_POLL_MS = 5000;
const YT_PUBLIC_GIFT_POLL_DEFAULT_MS = 2000;
const YT_PUBLIC_GIFT_POLL_MAX_MS = 15000;
const YT_PUBLIC_GIFT_POLL_RETRY_MS = 5000;

let ytOfficialPollTimer = null;
let ytOfficialRunning = false;
let ytOfficialPageToken = '';
let ytOfficialLiveChatId = '';
let ytPublicGiftPollTimer = null;
let ytPublicGiftPollErrorCount = 0;
let ytPublicGiftPollOptions = null;
let ytPublicGiftTarget = null;

function isActivePublicYouTubeListener(listener) {
    return !!listener && youtubeListener === listener && liveChat === listener;
}

function hasYouTubeChatTarget() {
    return !!(config.youtubeLiveId || config.youtubeChannelId);
}

function hasYouTubeOAuthConfig() {
    return !!(config.googleClientId && config.googleClientSecret && config.youtubeAccessToken);
}

function stopYouTubeOfficialPolling() {
    if (ytOfficialPollTimer) {
        clearTimeout(ytOfficialPollTimer);
        ytOfficialPollTimer = null;
    }
    ytOfficialRunning = false;
    ytOfficialPageToken = '';
    ytOfficialLiveChatId = '';
}

function stopYouTubePublicGiftPolling() {
    if (ytPublicGiftPollTimer) {
        clearTimeout(ytPublicGiftPollTimer);
        ytPublicGiftPollTimer = null;
    }
    ytPublicGiftPollOptions = null;
    ytPublicGiftTarget = null;
}

function rememberYouTubeMessageId(id) {
    const messageId = String(id || '').trim();
    if (!messageId) return false;
    if (ytSeenIds.has(messageId)) return false;
    ytSeenIds.add(messageId);
    if (ytSeenIds.size > YT_SEEN_MAX) {
        const first = ytSeenIds.values().next().value;
        ytSeenIds.delete(first);
    }
    return true;
}

async function refreshYouTubeAccessTokenIfNeeded(options = {}) {
    const force = options.force === true;
    if (!config.googleClientId || !config.googleClientSecret || !config.youtubeRefreshToken) return false;

    const expiresAtMs = Date.parse(String(config.youtubeTokenExpiresAt || ''));
    const now = Date.now();
    if (!force && Number.isFinite(expiresAtMs) && expiresAtMs - now > 2 * 60 * 1000) {
        return false;
    }

    try {
        const tokenRes = await axios.post(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                client_id: config.googleClientId,
                client_secret: config.googleClientSecret,
                refresh_token: config.youtubeRefreshToken,
                grant_type: 'refresh_token'
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 12000,
                validateStatus: () => true
            }
        );

        if (tokenRes.status < 200 || tokenRes.status >= 300) {
            const msg = tokenRes.data?.error_description || tokenRes.data?.error || `status ${tokenRes.status}`;
            throw new Error(`Token refresh failed: ${msg}`);
        }

        const nextAccessToken = String(tokenRes.data?.access_token || '').trim();
        const nextRefreshToken = String(tokenRes.data?.refresh_token || '').trim();
        const expiresInSec = Number(tokenRes.data?.expires_in || 0);
        const expiresAt = Number.isFinite(expiresInSec) && expiresInSec > 0
            ? new Date(Date.now() + expiresInSec * 1000).toISOString()
            : config.youtubeTokenExpiresAt || '';

        if (!nextAccessToken) {
            throw new Error('Token refresh returned no access token');
        }

        const patchInput = {
            youtubeAccessToken: nextAccessToken,
            youtubeTokenExpiresAt: expiresAt
        };
        if (nextRefreshToken) {
            patchInput.youtubeRefreshToken = nextRefreshToken;
        }

        const validation = validateConfigPatch(patchInput);
        if (!validation.ok) {
            throw new Error(validation.errors?.[0]?.message || 'Invalid token payload');
        }

        applyConfigPatch(validation.patch, { triggerRestart: false });
        console.log('[YouTube] OAuth access token refreshed');
        return true;
    } catch (err) {
        console.error('[YouTube] OAuth token refresh failed:', err?.message || String(err));
        return false;
    }
}

async function youtubeApiGet(path, params = {}, options = {}) {
    const retryAuth = options.retryAuth !== false;
    const execute = async () => {
        const url = `https://www.googleapis.com/youtube/v3/${path}`;
        return axios.get(url, {
            params,
            headers: {
                Authorization: `Bearer ${config.youtubeAccessToken}`
            },
            timeout: 12000,
            validateStatus: () => true
        });
    };

    let response = await execute();
    if (retryAuth && (response.status === 401 || response.status === 403)) {
        const refreshed = await refreshYouTubeAccessTokenIfNeeded({ force: true });
        if (refreshed) {
            response = await execute();
        }
    }
    return response;
}

async function youtubeApiDelete(path, params = {}, options = {}) {
    const retryAuth = options.retryAuth !== false;
    const execute = async () => {
        const url = `https://www.googleapis.com/youtube/v3/${path}`;
        return axios.delete(url, {
            params,
            headers: {
                Authorization: `Bearer ${config.youtubeAccessToken}`
            },
            timeout: 12000,
            validateStatus: () => true
        });
    };

    let response = await execute();
    if (retryAuth && (response.status === 401 || response.status === 403)) {
        const refreshed = await refreshYouTubeAccessTokenIfNeeded({ force: true });
        if (refreshed) {
            response = await execute();
        }
    }
    return response;
}

async function youtubeApiPost(path, data = {}, params = {}, options = {}) {
    const retryAuth = options.retryAuth !== false;
    const execute = async () => {
        const url = `https://www.googleapis.com/youtube/v3/${path}`;
        return axios.post(url, data, {
            params,
            headers: {
                Authorization: `Bearer ${config.youtubeAccessToken}`,
                "Content-Type": "application/json"
            },
            timeout: 12000,
            validateStatus: () => true
        });
    };

    let response = await execute();
    if (retryAuth && (response.status === 401 || response.status === 403)) {
        const refreshed = await refreshYouTubeAccessTokenIfNeeded({ force: true });
        if (refreshed) {
            response = await execute();
        }
    }
    return response;
}

function extractOfficialYouTubeBadges(authorDetails = {}, isMembershipEvent = false) {
    const out = [];
    const push = (text) => {
        if (out.length >= 4) return;
        out.push({ type: 'text', text });
    };

    if (authorDetails.isChatOwner) push('HOST');
    if (authorDetails.isChatModerator) push('MOD');
    if (authorDetails.isVerified) push('VER');
    if (authorDetails.isChatSponsor || isMembershipEvent) push('MEMBER');
    return out;
}

function parseOfficialYouTubeMessageText(item) {
    const display = item?.snippet?.displayMessage;
    if (typeof display === 'string' && display.trim()) return display.trim();
    const text = item?.snippet?.textMessageDetails?.messageText;
    if (typeof text === 'string') return text.trim();
    return '';
}

function parseYouTubeRunsText(runs) {
    if (!Array.isArray(runs)) return '';
    return runs
        .map((part) => {
            if (typeof part?.text === 'string') return part.text;
            const shortcut = Array.isArray(part?.emoji?.shortcuts) ? part.emoji.shortcuts[0] : '';
            if (typeof shortcut === 'string' && shortcut.trim()) return shortcut;
            if (typeof part?.alt === 'string') return part.alt;
            if (typeof part?.emoji?.emojiId === 'string') return part.emoji.emojiId;
            return '';
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseYouTubeTextNode(node) {
    if (typeof node?.simpleText === 'string' && node.simpleText.trim()) {
        return node.simpleText.trim();
    }
    return parseYouTubeRunsText(node?.runs);
}

function extractYouTubeThumbnailUrlFromList(thumbnails) {
    if (!Array.isArray(thumbnails)) return '';
    for (let i = thumbnails.length - 1; i >= 0; i -= 1) {
        const candidate = thumbnails[i];
        const url = String(candidate?.url || candidate || '').trim();
        if (url) return url;
    }
    return '';
}

function parseYouTubeTimestampUsec(value) {
    const usec = Number(value);
    if (!Number.isFinite(usec) || usec <= 0) return new Date().toISOString();
    return new Date(usec / 1000).toISOString();
}

function parseYouTubeTimestamp(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }
    const ms = Date.parse(String(value || ''));
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
    return parseYouTubeTimestampUsec(value);
}

function isOfficialMembershipEvent(item) {
    const type = String(item?.snippet?.type || '').toLowerCase();
    return [
        'newsponsorevent',
        'membermilestonechatevent',
        'membershipgiftingevent',
        'giftmembershipreceivedevent'
    ].includes(type);
}

function getOfficialMembershipKind(item, messageText) {
    const type = String(item?.snippet?.type || '').toLowerCase();
    if (type === 'newsponsorevent') return 'new';
    if (type === 'membermilestonechatevent') return 'milestone';
    if (type === 'membershipgiftingevent' || type === 'giftmembershipreceivedevent') return 'gift';
    const inferred = detectMembershipKindFromText(messageText);
    if (inferred) return inferred;
    return 'membership';
}

function parsePositiveCountToken(value, fallback = 0) {
    const raw = String(value ?? '').trim();
    if (!raw) return Math.max(0, Math.round(Number(fallback) || 0));
    const digits = raw.replace(/[^\d]/g, '');
    if (!digits) return Math.max(0, Math.round(Number(fallback) || 0));
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(0, Math.round(Number(fallback) || 0));
    return Math.max(0, Math.round(parsed));
}

function parseGiftMembershipCountFromText(messageText, fallback = 1) {
    const text = String(messageText || '').trim();
    if (!text) return Math.max(1, parsePositiveCountToken(fallback, 1));

    const patterns = [
        /gift(?:ed|ing)?\s+(\d{1,4}(?:[.,]\d{3})*|\d+)\s+(?:membership|memberships|subs?|subscriptions?)/i,
        /(\d{1,4}(?:[.,]\d{3})*|\d+)\s+(?:gifted\s+memberships?|gift\s+memberships?)/i,
        /sent\s+(\d{1,4}(?:[.,]\d{3})*|\d+)\s+.+?\s+gift memberships?/i,
        /presenteou\s+(\d{1,4}(?:[.,]\d{3})*|\d+)\s+(?:assinaturas?|membros?)/i,
        /(\d{1,4}(?:[.,]\d{3})*|\d+)\s+(?:assinaturas?|membros?)\s+de\s+presente/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const parsed = parsePositiveCountToken(match[1], 0);
        if (parsed > 0) return parsed;
    }
    if (/\bsent\s+a\b/i.test(text) && /\bgift membership\b/i.test(text)) {
        return 1;
    }
    return Math.max(1, parsePositiveCountToken(fallback, 1));
}

function normalizeMembershipMessageText(messageText) {
    return String(messageText || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectMembershipKindFromText(messageText) {
    const txt = normalizeMembershipMessageText(messageText);
    if (!txt) return '';

    const giftPatterns = [
        /\b(giftmembership|membershipgifting|gift(ed|ing)?\s+\d+\s+(membership|memberships|subs?|subscriptions?)|gifted memberships?|received a gifted membership|gifted by)\b/,
        /\b(sent\s+\d+\s+.+?\s+gift memberships?|sent a .+? gift membership|received a gift membership by)\b/,
        /\b(presenteou\s+\d+\s+(assinaturas?|membros?)|assinaturas?\s+de\s+presente|membros?\s+de\s+presente|presentead[oa] por)\b/,
        /\b(regal[oó]\s+\d+\s+membres[ií]as?|membres[ií]as?\s+de\s+regalo|regalad[oa] por)\b/
    ];
    if (giftPatterns.some((pattern) => pattern.test(txt))) return 'gift';

    const milestonePatterns = [
        /\b(member for \d+\s+(month|months|year|years)|membership anniversary|membership renewal|renewed (their )?membership|resubscribed)\b/,
        /\b(membro h[aá] \d+\s+m[eê]s(?:es)?|anivers[áa]rio de membro|renovou (a )?assinatura)\b/,
        /\b(miembro desde hace \d+\s+(mes|meses|a[ñn]o|a[ñn]os)|aniversario de membres[ií]a|renov[oó] su membres[ií]a)\b/
    ];
    if (milestonePatterns.some((pattern) => pattern.test(txt))) return 'milestone';

    const newPatterns = [
        /\b(new member|just joined|joined( the)? channel|became a member|is now a member|thanks for becoming a member)\b/,
        /\b(novo membro|acabou de se tornar membro|tornou[- ]se membro|agora (e|é) membro)\b/,
        /\b(nuevo miembro|se uni[oó] (como )?miembro|se convirti[oó] en miembro|ahora es miembro)\b/
    ];
    if (newPatterns.some((pattern) => pattern.test(txt))) return 'new';

    if (/\b(member(ship)?|sponsor(ship)?|subscriber|subscription|membro|membros|assinante|assinatura|miembro|membres[ií]a)\b/.test(txt)) {
        return 'membership';
    }
    return '';
}

function getOfficialMembershipSourceType(item) {
    return String(item?.snippet?.type || '').trim().toLowerCase();
}

function getOfficialGiftedCount(item, messageText, sourceType = '') {
    const source = String(sourceType || '').toLowerCase();
    if (source === 'giftmembershipreceivedevent') return 1;

    const details = item?.snippet?.membershipGiftingDetails || item?.snippet?.giftMembershipDetails || {};
    const candidates = [
        details?.giftMembershipsCount,
        details?.giftMembershipCount,
        details?.memberCount,
        details?.count
    ];
    for (const candidate of candidates) {
        const parsed = parsePositiveCountToken(candidate, 0);
        if (parsed > 0) return parsed;
    }
    return parseGiftMembershipCountFromText(messageText, 1);
}

function cleanupRecentMembershipAlerts(now = Date.now()) {
    for (const [key, ts] of ytRecentMembershipAlerts.entries()) {
        if (now - ts > YT_NEW_MEMBERSHIP_DEDUPE_MS) {
            ytRecentMembershipAlerts.delete(key);
        }
    }
}

function shouldEmitMembershipAlert(authorName, kind, authorId = '') {
    if (kind !== 'new') return true;
    const stableId = String(authorId || '').trim().toLowerCase();
    const displayName = String(authorName || '').trim().toLowerCase();
    const userKey = stableId
        ? `id:${stableId}`
        : (displayName ? `name:${displayName}` : '');
    if (!userKey) return true;

    const now = Date.now();
    cleanupRecentMembershipAlerts(now);
    const dedupeKey = `new|${userKey}`;
    const lastTs = ytRecentMembershipAlerts.get(dedupeKey);
    if (lastTs && (now - lastTs) < YT_NEW_MEMBERSHIP_DEDUPE_MS) {
        return false;
    }
    ytRecentMembershipAlerts.set(dedupeKey, now);
    if (ytRecentMembershipAlerts.size > 500) {
        const first = ytRecentMembershipAlerts.keys().next().value;
        ytRecentMembershipAlerts.delete(first);
    }
    return true;
}

function processOfficialYouTubeChatItem(item) {
    if (!item || !item.id) return;
    if (!rememberYouTubeMessageId(item.id)) return;

    const author = item.authorDetails || {};
    const snippet = item.snippet || {};
    const authorName = author.displayName || 'Unknown';
    const authorId = String(author.channelId || '').trim();
    const messageText = parseOfficialYouTubeMessageText(item);
    const officialDonationDetails = snippet?.superChatDetails || snippet?.superStickerDetails || {};
    const donationAmount = String(
        officialDonationDetails?.amountDisplayString
        || ''
    ).trim();
    const donationCurrency = String(officialDonationDetails?.currency || '').trim().toUpperCase();
    const donationMicros = Number(officialDonationDetails?.amountMicros || 0);
    const membershipEvent = isOfficialMembershipEvent(item);
    const hasMembershipBadge = author.isChatSponsor === true || membershipEvent;

    const normalized = emitChatMessage({
        id: item.id,
        source: 'youtube',
        chatname: authorName,
        chatmessage: messageText,
        donation: donationAmount,
        hasDonation: donationAmount,
        chatimg: String(author.profileImageUrl || ''),
        chatbadges: extractOfficialYouTubeBadges(author, membershipEvent),
        membership: hasMembershipBadge,
        timestamp: snippet?.publishedAt || new Date().toISOString()
    }, { source: 'youtube' });

    if (normalized) {
        bumpListenerEvent('youtube');
    }

    if (donationAmount) {
        emitAlert('tip-latest', {
            name: authorName,
            amount: donationAmount,
            message: messageText || '',
            ...(donationCurrency ? { currency: donationCurrency } : {}),
            ...(Number.isFinite(donationMicros) && donationMicros > 0 ? { amountMicros: donationMicros } : {})
        }, { platform: 'youtube' });
    } else if (membershipEvent) {
        const membershipKind = getOfficialMembershipKind(item, messageText);
        const membershipSourceType = getOfficialMembershipSourceType(item);
        const giftedCount = membershipKind === 'gift'
            ? getOfficialGiftedCount(item, messageText, membershipSourceType)
            : 0;
        if (!shouldEmitMembershipAlert(authorName, membershipKind, authorId)) {
            console.log(`[YouTube] Membership alert deduped (official): ${authorName} (${membershipKind})`);
            return;
        }
        emitAlert('subscriber-latest', {
            name: authorName,
            amount: 1,
            message: messageText || 'Joined as a member!',
            membershipKind,
            membershipSourceType,
            memberCount: membershipKind === 'gift' ? 0 : 1,
            giftedCount
        }, { platform: 'youtube' });
    }
}

async function resolveOfficialLiveChatTarget() {
    const configuredLiveId = String(config.youtubeLiveId || '').trim();
    const configuredChannelId = String(config.youtubeChannelId || '').trim();
    let liveId = configuredLiveId;

    if (!liveId && configuredChannelId) {
        const searchRes = await youtubeApiGet('search', {
            part: 'id',
            channelId: configuredChannelId,
            eventType: 'live',
            type: 'video',
            maxResults: 1
        });
        if (searchRes.status >= 200 && searchRes.status < 300) {
            liveId = String(searchRes.data?.items?.[0]?.id?.videoId || '').trim();
        } else {
            const reason = searchRes.data?.error?.message || `status ${searchRes.status}`;
            throw new Error(`Could not resolve live video: ${reason}`);
        }
    }

    if (!liveId) return null;

    const videoRes = await youtubeApiGet('videos', {
        part: 'liveStreamingDetails,snippet',
        id: liveId,
        maxResults: 1
    });
    if (videoRes.status < 200 || videoRes.status >= 300) {
        const reason = videoRes.data?.error?.message || `status ${videoRes.status}`;
        throw new Error(`Could not fetch video details: ${reason}`);
    }

    const video = videoRes.data?.items?.[0];
    const liveChatId = String(video?.liveStreamingDetails?.activeLiveChatId || '').trim();
    if (!liveChatId) return null;

    return { liveId, liveChatId };
}

function scheduleOfficialPoll(delayMs = YT_OFFICIAL_DEFAULT_POLL_MS) {
    if (!ytOfficialRunning) return;
    const ms = Math.max(YT_OFFICIAL_MIN_POLL_MS, Math.min(YT_OFFICIAL_MAX_POLL_MS, Number(delayMs) || YT_OFFICIAL_DEFAULT_POLL_MS));
    ytOfficialPollTimer = setTimeout(async () => {
        try {
            await pollOfficialYouTubeChat();
        } catch (err) {
            const msg = err?.message || String(err);
            stopYouTubeOfficialPolling();
            setListenerStatus('youtube', 'error', msg);
            scheduleYouTubeReconnect(msg);
        }
    }, ms);
}

async function pollOfficialYouTubeChat() {
    if (!ytOfficialRunning || !ytOfficialLiveChatId) return;

    const params = {
        liveChatId: ytOfficialLiveChatId,
        part: 'id,snippet,authorDetails',
        maxResults: 200
    };
    if (ytOfficialPageToken) {
        params.pageToken = ytOfficialPageToken;
    }

    const res = await youtubeApiGet('liveChat/messages', params, { retryAuth: true });
    if (res.status < 200 || res.status >= 300) {
        const reason = res.data?.error?.message || `status ${res.status}`;
        throw new Error(`YouTube live chat poll failed: ${reason}`);
    }

    const payload = res.data || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
        processOfficialYouTubeChatItem(item);
    }

    if (payload.nextPageToken) {
        ytOfficialPageToken = payload.nextPageToken;
    }
    const nextMs = Number(payload.pollingIntervalMillis || YT_OFFICIAL_DEFAULT_POLL_MS);
    scheduleOfficialPoll(nextMs);
}

async function startOfficialYouTubeListener() {
    if (!hasYouTubeOAuthConfig()) return false;

    const refreshed = await refreshYouTubeAccessTokenIfNeeded({ force: false });
    if (refreshed) {
        // continue with updated token
    }

    const target = await resolveOfficialLiveChatTarget();
    if (!target || !target.liveChatId) {
        const msg = 'No active YouTube live chat found for OAuth mode';
        console.log(`[YouTube] ${msg}`);
        setListenerStatus('youtube', 'disconnected', msg);
        return false;
    }

    ytOfficialLiveChatId = target.liveChatId;
    ytOfficialPageToken = '';
    ytOfficialRunning = true;
    setListenerStatus('youtube', 'connected');
    console.log(`[YouTube] OAuth live chat connected: ${target.liveId}`);

    await pollOfficialYouTubeChat();
    return true;
}

function extractYouTubeMessageText(chatItem) {
    if (!Array.isArray(chatItem?.message)) return '';
    return chatItem.message
        .map((part) => {
            if (part && typeof part.text === 'string') return part.text;
            if (part && typeof part.alt === 'string') return part.alt;
            return '';
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractYouTubeAuthorAvatar(chatItem) {
    const thumb = chatItem?.author?.thumbnail;
    if (!thumb) return '';
    if (typeof thumb === 'string') return thumb;
    if (typeof thumb.url === 'string') return thumb.url;
    return '';
}

function normalizeYouTubeBadgeLabel(value) {
    const raw = String(value || '').trim();
    const key = raw.toLowerCase();
    if (!key) return '';
    const durationMatch = key.match(/(\d+)\s*(month|months|mo|year|years|yr|yrs)/);
    if (durationMatch && /(member|membership|sponsor|subscriber|subscription|new[_\s]?sponsor)/.test(key)) {
        const count = Number(durationMatch[1]);
        const unit = durationMatch[2];
        if (Number.isFinite(count) && count > 0) {
            const suffix = /^y/.test(unit) ? 'Y' : 'M';
            return `MEM ${count}${suffix}`;
        }
    }
    if (/(owner|creator|broadcaster|channel[_\s]?owner|host)/.test(key)) return 'HOST';
    if (/(moderator|mod)/.test(key)) return 'MOD';
    if (/(verified|verification)/.test(key)) return 'VER';
    if (/(member|membership|sponsor|subscriber|subscription|new[_\s]?sponsor)/.test(key)) return 'MEMBER';
    if (/(founder)/.test(key)) return 'FDR';
    if (/(vip)/.test(key)) return 'VIP';
    return '';
}

function extractYouTubeBadges(chatItem) {
    const out = [];
    const seenSrc = new Set();
    const seenText = new Set();

    const pushText = (value, setId = '') => {
        if (out.length >= 4) return;
        const normalizedText = normalizeYouTubeBadgeLabel(value) || String(value || '').trim().slice(0, 24).toUpperCase();
        if (!normalizedText) return;
        const normalizedSetId = String(setId || '').trim().toLowerCase();
        const key = `${normalizedSetId}|${normalizedText}`;
        if (seenText.has(key)) return;
        seenText.add(key);
        const badge = { type: 'text', text: normalizedText };
        if (normalizedSetId) badge.setId = normalizedSetId;
        out.push(badge);
    };

    const pushImage = (value, setId = '') => {
        if (out.length >= 4) return;
        const rawSrc = String(value || '').trim();
        if (!rawSrc) return;
        const src = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;
        if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) return;
        if (seenSrc.has(src)) return;
        seenSrc.add(src);
        const normalizedSetId = String(setId || '').trim().toLowerCase();
        const badge = { type: 'img', src };
        if (normalizedSetId) badge.setId = normalizedSetId;
        out.push(badge);
    };

    const pushBadge = (badgeLike) => {
        if (out.length >= 4) return;
        if (!badgeLike || typeof badgeLike !== 'object') return;
        const setId = String(
            badgeLike?.setId
            || badgeLike?.badgeId
            || badgeLike?.id
            || badgeLike?.iconType
            || badgeLike?.type
            || badgeLike?.name
            || ''
        ).trim().toLowerCase();
        const customThumbs = Array.isArray(badgeLike?.customThumbnail?.thumbnails)
            ? badgeLike.customThumbnail.thumbnails
            : [];
        const bestCustomThumb = customThumbs.length ? customThumbs[customThumbs.length - 1]?.url : '';
        const src = badgeLike?.thumbnail?.url
            || badgeLike?.thumbnail
            || badgeLike?.src
            || badgeLike?.url
            || badgeLike?.image
            || badgeLike?.imageUrl
            || badgeLike?.icon
            || badgeLike?.iconUrl
            || bestCustomThumb
            || '';
        if (src) {
            pushImage(src, setId);
            return;
        }
        pushText(
            badgeLike?.text
            || badgeLike?.label
            || badgeLike?.title
            || badgeLike?.tooltip
            || badgeLike?.alt
            || badgeLike?.name
            || badgeLike?.iconType
            || badgeLike?.type
            || '',
            setId
        );
    };

    const authorBadges = chatItem?.author?.badges;
    if (Array.isArray(authorBadges)) {
        authorBadges.forEach(pushBadge);
    }
    if (chatItem?.author?.badge) {
        pushBadge(chatItem.author.badge);
    }

    if (chatItem?.isOwner || chatItem?.author?.isChatOwner) pushText('HOST', 'owner');
    if (chatItem?.isModerator || chatItem?.author?.isChatModerator) pushText('MOD', 'moderator');
    if (chatItem?.isVerified || chatItem?.author?.isVerified) pushText('VER', 'verified');
    if (chatItem?.author?.isChatSponsor || chatItem?.isMembership || chatItem?.membership || chatItem?.isNewSponsor || chatItem?.isSponsorship || chatItem?.isMemberMilestone) {
        pushText('MEMBER', 'member');
    }

    return out;
}

function isYouTubeMembershipEvent(chatItem, messageText) {
    const typeText = [chatItem?.type, chatItem?.messageType, chatItem?.rendererType]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
    const hasMembershipType = /(membership|sponsor|new_sponsor|member_milestone|sponsorship|membershipitem)/.test(typeText);
    if (hasMembershipType) return true;

    if (chatItem?.membership || chatItem?.isNewSponsor || chatItem?.isSponsorship || chatItem?.isMemberMilestone) return true;

    const inferredKind = detectMembershipKindFromText(messageText);
    if (inferredKind && inferredKind !== 'membership') return true;

    // youtube-chat sets isMembership=true on normal member-badged chat,
    // so fallback text matching must be strict to avoid false positives.
    if (!chatItem?.isMembership) return false;
    const txt = normalizeMembershipMessageText(messageText);
    if (!txt || txt.length > 120) return false;

    return /^(welcome to|bem-vind[oa]s?|bienvenid[oa]s?)\b/.test(txt);
}

function getPublicMembershipKind(chatItem, messageText) {
    const typeText = [chatItem?.type, chatItem?.messageType, chatItem?.rendererType]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');

    if (/(membershipgifting|membership_gifting|giftmembership|gift_membership)/.test(typeText)) return 'gift';
    if (chatItem?.isMemberMilestone || /(member[_\s]?milestone)/.test(typeText)) return 'milestone';
    if (chatItem?.isNewSponsor || /(new[_\s]?sponsor|newsponsor)/.test(typeText)) return 'new';

    const inferredKind = detectMembershipKindFromText(messageText);
    if (inferredKind) return inferredKind;
    return 'membership';
}

function getPublicMembershipSourceType(chatItem, messageText, membershipKind = '') {
    if (String(membershipKind || '').toLowerCase() !== 'gift') return '';

    const typeText = [chatItem?.type, chatItem?.messageType, chatItem?.rendererType]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
    const txt = String(messageText || '').toLowerCase().replace(/\s+/g, ' ').trim();

    if (/(giftmembershipreceived|gift_membership_received)/.test(typeText)) return 'giftmembershipreceivedevent';
    if (/(membershipgifting|membership_gifting|giftmembership)/.test(typeText)) return 'membershipgiftingevent';
    if (/(gifted by|received a gift membership by|received a gifted membership by|presentead[oa] por)/.test(txt)) return 'giftmembershipreceivedevent';
    if (/(gift(ed|ing)?\s+\d+|sent\s+\d+\s+.+?\s+gift memberships?|sent a .+? gift membership|presenteou\s+\d+)/.test(txt)) return 'membershipgiftingevent';
    return 'giftmembershipunknown';
}

function getPublicGiftedCount(chatItem, messageText, membershipSourceType = '') {
    const source = String(membershipSourceType || '').toLowerCase();
    if (source === 'giftmembershipreceivedevent') return 1;

    const candidates = [
        chatItem?.giftMembershipsCount,
        chatItem?.giftMembershipCount,
        chatItem?.memberCount,
        chatItem?.amount
    ];
    for (const candidate of candidates) {
        const parsed = parsePositiveCountToken(candidate, 0);
        if (parsed > 0) return parsed;
    }
    return parseGiftMembershipCountFromText(messageText, 1);
}

function extractRawYouTubeBadges(authorBadges) {
    const out = [];
    const seenSrc = new Set();
    const seenText = new Set();

    const pushText = (value, setId = '') => {
        if (out.length >= 4) return;
        const normalizedText = normalizeYouTubeBadgeLabel(value) || String(value || '').trim().slice(0, 24).toUpperCase();
        if (!normalizedText) return;
        const normalizedSetId = String(setId || '').trim().toLowerCase();
        const key = `${normalizedSetId}|${normalizedText}`;
        if (seenText.has(key)) return;
        seenText.add(key);
        const badge = { type: 'text', text: normalizedText };
        if (normalizedSetId) badge.setId = normalizedSetId;
        out.push(badge);
    };

    const pushImage = (value, setId = '') => {
        if (out.length >= 4) return;
        const rawSrc = String(value || '').trim();
        if (!rawSrc) return;
        const src = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;
        if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) return;
        if (seenSrc.has(src)) return;
        seenSrc.add(src);
        const normalizedSetId = String(setId || '').trim().toLowerCase();
        const badge = { type: 'img', src };
        if (normalizedSetId) badge.setId = normalizedSetId;
        out.push(badge);
    };

    const source = Array.isArray(authorBadges) ? authorBadges : [];
    for (const container of source) {
        if (out.length >= 4) break;
        const badge = container?.liveChatAuthorBadgeRenderer || container;
        if (!badge || typeof badge !== 'object') continue;
        const tooltip = String(
            badge?.tooltip
            || badge?.accessibility?.accessibilityData?.label
            || badge?.icon?.iconType
            || ''
        ).trim();
        const setId = String(badge?.icon?.iconType || tooltip || '').trim().toLowerCase().replace(/\s+/g, '_');
        const imageUrl = extractYouTubeThumbnailUrlFromList(badge?.customThumbnail?.thumbnails);
        if (imageUrl) {
            pushImage(imageUrl, setId || 'member');
            continue;
        }
        pushText(tooltip, setId);
    }

    return out;
}

function extractPublicGiftPurchaseRendererFromAction(action) {
    const direct = action?.addChatItemAction?.item?.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
    if (direct) return direct;

    const ticker = action?.addLiveChatTickerItemAction?.item?.liveChatTickerSponsorItemRenderer
        ?.showItemEndpoint?.showLiveChatItemEndpoint?.renderer?.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
    if (ticker) return ticker;

    return null;
}

function getPublicGiftPollContinuation(data) {
    const continuationData = data?.continuationContents?.liveChatContinuation?.continuations?.[0] || {};
    return String(
        continuationData?.invalidationContinuationData?.continuation
        || continuationData?.timedContinuationData?.continuation
        || continuationData?.reloadContinuationData?.continuation
        || ''
    ).trim();
}

function getPublicGiftPollDelayMs(data) {
    const continuationData = data?.continuationContents?.liveChatContinuation?.continuations?.[0] || {};
    const raw = Number(
        continuationData?.invalidationContinuationData?.timeoutMs
        ?? continuationData?.timedContinuationData?.timeoutMs
        ?? continuationData?.reloadContinuationData?.timeoutMs
        ?? YT_PUBLIC_GIFT_POLL_DEFAULT_MS
    );
    if (!Number.isFinite(raw) || raw <= 0) return YT_PUBLIC_GIFT_POLL_DEFAULT_MS;
    return Math.max(1000, Math.min(YT_PUBLIC_GIFT_POLL_MAX_MS, Math.round(raw)));
}

function processPublicGiftPurchaseRenderer(renderer) {
    if (!renderer || !renderer.id) return false;
    if (!rememberYouTubeMessageId(renderer.id)) return false;

    const header = renderer?.header?.liveChatSponsorshipsHeaderRenderer || {};
    const authorName = parseYouTubeTextNode(header.authorName) || 'Unknown';
    const authorId = String(renderer?.authorExternalChannelId || '').trim();
    const messageText = parseYouTubeTextNode(header.primaryText) || 'Sent a gift membership';
    const giftedCount = parseGiftMembershipCountFromText(messageText, 1);
    const normalized = emitChatMessage({
        id: renderer.id,
        source: 'youtube',
        chatname: authorName,
        chatmessage: messageText,
        chatimg: extractYouTubeThumbnailUrlFromList(header?.authorPhoto?.thumbnails),
        chatbadges: extractRawYouTubeBadges(header?.authorBadges),
        membership: true,
        timestamp: parseYouTubeTimestampUsec(renderer?.timestampUsec)
    }, { source: 'youtube' });

    if (normalized) {
        bumpListenerEvent('youtube');
    }

    if (!shouldEmitMembershipAlert(authorName, 'gift', authorId)) {
        return true;
    }

    emitAlert('subscriber-latest', {
        name: authorName,
        amount: 1,
        message: messageText,
        membershipKind: 'gift',
        membershipSourceType: 'membershipgiftingevent',
        memberCount: 0,
        giftedCount
    }, { platform: 'youtube' });

    return true;
}

async function ensurePublicGiftPollOptions() {
    if (ytPublicGiftPollOptions) return ytPublicGiftPollOptions;
    if (!ytPublicGiftTarget) return null;
    ytPublicGiftPollOptions = await fetchLivePage(ytPublicGiftTarget);
    return ytPublicGiftPollOptions;
}

function schedulePublicGiftPoll(delayMs = YT_PUBLIC_GIFT_POLL_DEFAULT_MS) {
    if (!ytPublicGiftTarget) return;
    if (ytPublicGiftPollTimer) {
        clearTimeout(ytPublicGiftPollTimer);
        ytPublicGiftPollTimer = null;
    }
    const safeDelay = Math.max(1000, Math.min(YT_PUBLIC_GIFT_POLL_MAX_MS, Number(delayMs) || YT_PUBLIC_GIFT_POLL_DEFAULT_MS));
    ytPublicGiftPollTimer = setTimeout(async () => {
        ytPublicGiftPollTimer = null;
        try {
            const options = await ensurePublicGiftPollOptions();
            if (!options) return;

            const res = await axios.post(
                `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${options.apiKey}`,
                {
                    context: {
                        client: {
                            clientVersion: options.clientVersion,
                            clientName: 'WEB'
                        }
                    },
                    continuation: options.continuation
                },
                {
                    timeout: 12000,
                    validateStatus: () => true
                }
            );

            if (res.status < 200 || res.status >= 300) {
                throw new Error(`status ${res.status}`);
            }

            const data = res.data || {};
            const nextContinuation = getPublicGiftPollContinuation(data);
            if (nextContinuation) {
                options.continuation = nextContinuation;
            }

            const actions = Array.isArray(data?.continuationContents?.liveChatContinuation?.actions)
                ? data.continuationContents.liveChatContinuation.actions
                : [];

            for (const action of actions) {
                const renderer = extractPublicGiftPurchaseRendererFromAction(action);
                if (!renderer) continue;
                processPublicGiftPurchaseRenderer(renderer);
            }

            ytPublicGiftPollErrorCount = 0; // Reset on success
            schedulePublicGiftPoll(getPublicGiftPollDelayMs(data));
        } catch (err) {
            console.error('[YouTube] Public gift poll failed:', err?.message || String(err));
            ytPublicGiftPollOptions = null;
            ytPublicGiftPollErrorCount++;
            const backoffMs = Math.min(YT_PUBLIC_GIFT_POLL_RETRY_MS * Math.pow(2, ytPublicGiftPollErrorCount - 1), 60000);
            schedulePublicGiftPoll(backoffMs);
        }
    }, safeDelay);
}

async function startPublicGiftPolling(liveChatOptions) {
    stopYouTubePublicGiftPolling();
    ytPublicGiftTarget = liveChatOptions ? { ...liveChatOptions } : null;
    if (!ytPublicGiftTarget) return;
    ytPublicGiftPollErrorCount = 0;
    try {
        await ensurePublicGiftPollOptions();
        schedulePublicGiftPoll(500);
    } catch (err) {
        console.error('[YouTube] Public gift poll bootstrap failed:', err?.message || String(err));
        ytPublicGiftPollOptions = null;
        ytPublicGiftPollErrorCount++;
        schedulePublicGiftPoll(YT_PUBLIC_GIFT_POLL_RETRY_MS);
    }
}

function ensureYouTubeWatchdog() {
    if (ytWatchdogTimer) return;
    ytWatchdogTimer = setInterval(() => {
        if (!hasYouTubeChatTarget()) return;
        if (listenerStatus.youtube === 'connected') return;
        if (ytReconnectTimer || ytRestartInProgress) return;
        scheduleYouTubeReconnect('watchdog');
    }, YT_WATCHDOG_MS);
}

function scheduleYouTubeReconnect(reason = '') {
    if (ytReconnectTimer) return;
    listenerHealth.youtube.reconnectAttempts += 1;
    const delayMs = ytReconnectDelay;
    const suffix = reason ? ` (${reason})` : '';
    console.error(`[YouTube] Reconnect in ${Math.round(delayMs / 1000)}s${suffix}`);
    ytReconnectTimer = setTimeout(async () => {
        ytReconnectTimer = null;
        if (ytRestartInProgress) return;
        try {
            ytRestartInProgress = true;
            await restartYouTubeListener({ fromReconnect: true });
        } catch (err) {
            const msg = err?.message || String(err);
            setListenerStatus('youtube', 'error', msg);
        } finally {
            ytRestartInProgress = false;
        }
    }, delayMs);
    ytReconnectDelay = Math.min(delayMs * 2, YT_MAX_RECONNECT_DELAY);
}

async function startPublicYouTubeListener() {
    const configuredLiveId = String(config.youtubeLiveId || '').trim();
    const configuredChannelId = String(config.youtubeChannelId || '').trim();

    if (!configuredLiveId && !configuredChannelId) {
        console.log('[WARN] YouTube Live ID or Channel ID missing in config.');
        setListenerStatus('youtube', 'disconnected');
        return;
    }

    const liveChatOptions = configuredLiveId
        ? { liveId: configuredLiveId }
        : { channelId: configuredChannelId };

    stopYouTubePublicGiftPolling();
    const currentLiveChat = new LiveChat(liveChatOptions);
    liveChat = currentLiveChat;
    youtubeListener = currentLiveChat;

    currentLiveChat.on('start', (liveId) => {
        if (!isActivePublicYouTubeListener(currentLiveChat)) return;
        ytReconnectDelay = 5000;
        setListenerStatus('youtube', 'connected');
        console.log(`[YouTube] Connected to live: ${liveId}`);
    });

    currentLiveChat.on('end', (reason) => {
        if (!isActivePublicYouTubeListener(currentLiveChat)) return;
        const msg = reason || 'Stream ended';
        stopYouTubePublicGiftPolling();
        setListenerStatus('youtube', 'disconnected', String(msg));
        console.log(`[YouTube] Stream ended: ${msg}`);
        scheduleYouTubeReconnect('stream ended');
    });

    currentLiveChat.on('error', (err) => {
        if (!isActivePublicYouTubeListener(currentLiveChat)) return;
        const msg = err?.message || String(err);
        stopYouTubePublicGiftPolling();
        setListenerStatus('youtube', 'error', msg);
        console.error('[YouTube] Error:', msg);
        scheduleYouTubeReconnect(msg);
    });

    currentLiveChat.on('chat', (chatItem) => {
        if (!isActivePublicYouTubeListener(currentLiveChat)) return;
        if (!chatItem || !chatItem.id) return;
        if (!rememberYouTubeMessageId(chatItem.id)) return;

        const messageText = extractYouTubeMessageText(chatItem);
        const authorName = chatItem.author?.name || 'Unknown';
        const authorId = String(chatItem?.author?.channelId || '').trim();
        const donationAmount = chatItem?.superchat?.amount || '';
        const membershipEvent = isYouTubeMembershipEvent(chatItem, messageText);
        const hasMembershipBadge = !!(
            chatItem?.author?.isChatSponsor
            || chatItem?.isMembership
            || chatItem?.membership
            || chatItem?.isNewSponsor
            || chatItem?.isSponsorship
            || chatItem?.isMemberMilestone
            || membershipEvent
        );
        const normalized = emitChatMessage({
            id: chatItem.id,
            source: 'youtube',
            chatname: authorName,
            chatmessage: messageText,
            donation: donationAmount,
            hasDonation: donationAmount,
            chatimg: extractYouTubeAuthorAvatar(chatItem),
            chatbadges: extractYouTubeBadges(chatItem),
            membership: hasMembershipBadge,
            timestamp: parseYouTubeTimestamp(chatItem?.timestamp)
        }, { source: 'youtube' });

        if (normalized) {
            bumpListenerEvent('youtube');
        }

        if (chatItem.superchat) {
            const amount = donationAmount;
            console.log(`[YouTube] SuperChat from ${authorName}: ${amount}`);
            const donationCurrency = String(chatItem?.superchat?.currency || chatItem?.superchat?.currencyCode || '').trim().toUpperCase();
            const donationMicros = Number(chatItem?.superchat?.amountMicros || chatItem?.superchat?.micros || 0);
            emitAlert('tip-latest', {
                name: authorName,
                amount: amount,
                message: messageText || '',
                ...(donationCurrency ? { currency: donationCurrency } : {}),
                ...(Number.isFinite(donationMicros) && donationMicros > 0 ? { amountMicros: donationMicros } : {})
            }, { platform: 'youtube' });
        } else if (membershipEvent) {
            const membershipKind = getPublicMembershipKind(chatItem, messageText);
            const membershipSourceType = getPublicMembershipSourceType(chatItem, messageText, membershipKind);
            const giftedCount = membershipKind === 'gift'
                ? getPublicGiftedCount(chatItem, messageText, membershipSourceType)
                : 0;
            if (!shouldEmitMembershipAlert(authorName, membershipKind, authorId)) {
                console.log(`[YouTube] Membership alert deduped (public): ${authorName} (${membershipKind})`);
                return;
            }
            console.log(`[YouTube] Membership event: ${authorName}`);
            emitAlert('subscriber-latest', {
                name: authorName,
                amount: 1,
                message: messageText || 'Joined as a member!',
                membershipKind,
                membershipSourceType,
                memberCount: membershipKind === 'gift' ? 0 : 1,
                giftedCount
            }, { platform: 'youtube' });
        }
    });

    try {
        const ok = await currentLiveChat.start();
        if (!ok) {
            const msg = 'No live stream found';
            console.log(`[YouTube] ${msg}`);
            setListenerStatus('youtube', 'error', msg);
            scheduleYouTubeReconnect(msg);
            return;
        }
        await startPublicGiftPolling(liveChatOptions);
    } catch (err) {
        const msg = err?.message || String(err);
        console.error('[YouTube] Setup Error:', msg);
        setListenerStatus('youtube', 'error', msg);
        scheduleYouTubeReconnect(msg);
    }
    ensureYouTubeWatchdog();
}

async function startYouTubeListener() {
    const configuredLiveId = String(config.youtubeLiveId || '').trim();
    const configuredChannelId = String(config.youtubeChannelId || '').trim();
    if (!configuredLiveId && !configuredChannelId) {
        console.log('[WARN] YouTube Live ID or Channel ID missing in config.');
        setListenerStatus('youtube', 'disconnected');
        return;
    }

    stopYouTubeOfficialPolling();
    stopYouTubePublicGiftPolling();

    const canUseOfficial = hasYouTubeOAuthConfig();
    if (canUseOfficial) {
        try {
            const started = await startOfficialYouTubeListener();
            if (started) {
                ensureYouTubeWatchdog();
                return;
            }
            console.log('[YouTube] Falling back to public chat mode.');
        } catch (err) {
            const msg = err?.message || String(err);
            console.error('[YouTube] OAuth mode failed, falling back:', msg);
        }
    }

    await startPublicYouTubeListener();
}

async function stopYouTubeListener(options = {}) {
    const fromReconnect = options.fromReconnect === true;
    if (!fromReconnect && ytReconnectTimer) {
        clearTimeout(ytReconnectTimer);
        ytReconnectTimer = null;
    }
    const listener = youtubeListener;
    youtubeListener = null;
    liveChat = null;
    if (listener) {
        try {
            // Keep event listeners attached until in-flight requests settle so
            // late 'error' emissions from youtube-chat do not become unhandled.
            listener.stop(fromReconnect ? 'reconnect' : 'manual restart');
            console.log('[YouTube] Listener stopped');
        } catch (e) {
            console.error('[YouTube] Stop error:', e.message);
        }
    }
    stopYouTubeOfficialPolling();
    stopYouTubePublicGiftPolling();
    setListenerStatus('youtube', 'disconnected');
}

async function restartYouTubeListener(options = {}) {
    await stopYouTubeListener(options);
    if (options.stopOnly === true) return;
    await startYouTubeListener();
}

async function moderateYouTubeChat({ action, id, userId }) {
    if (!hasYouTubeOAuthConfig()) throw new Error("YouTube chat client not connected via OAuth");
    
    if (action === 'delete') {
        if (!id) throw new Error("Missing message ID for deletion");
        await youtubeApiDelete('liveChat/messages', { id });
    } else if (action === 'timeout') {
         if (!userId) throw new Error("Missing userId for timeout");
         if (!ytOfficialLiveChatId) throw new Error("No active live chat ID");
         await youtubeApiPost('liveChat/bans', {
            snippet: {
                liveChatId: ytOfficialLiveChatId,
                type: 'temporary',
                banDurationSeconds: 600,
                bannedUserDetails: { channelId: userId }
            }
         });
    } else if (action === 'ban') {
         if (!userId) throw new Error("Missing userId for ban");
         if (!ytOfficialLiveChatId) throw new Error("No active live chat ID");
         await youtubeApiPost('liveChat/bans', {
            snippet: {
                liveChatId: ytOfficialLiveChatId,
                type: 'permanent',
                bannedUserDetails: { channelId: userId }
            }
         });
    } else {
        throw new Error("Unknown action: " + action);
    }
    return true;
}

module.exports = {
    startYouTubeListener, stopYouTubeListener, restartYouTubeListener,
    extractYouTubeMessageText, isYouTubeMembershipEvent,
    parseGiftMembershipCountFromText, detectMembershipKindFromText,
    moderateYouTubeChat,
};
