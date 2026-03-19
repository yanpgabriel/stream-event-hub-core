'use strict';

const crypto = require('crypto');
const ctx = require('../ctx');
const { config } = require('../config');
const sorteios = require('./sorteios');

const CHAT_HISTORY_LIMIT = 500;
const DEFAULT_STATE_LIMIT = 120;
const MESSAGE_MAX_AGE_MS = 30 * 60 * 1000;
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 128;
const DEFAULT_CHAT_MESSAGE_TEXT_SIZE = 20;
const DEFAULT_CLICKABLE_CHAT_MESSAGE_TEXT_SIZE = 12;
const DEFAULT_FEATURE_MESSAGE_TEXT_SIZE = 48;

const recentMessages = [];
let featuredMessage = null;
let featuredAutoClearTimer = null;

function sanitizeText(value, maxLen = 400) {
    if (value == null) return '';
    return String(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxLen);
}

function sanitizeUrl(value) {
    const str = sanitizeText(value, 2048);
    if (!str) return '';
    if (str.startsWith('//')) return `https:${str}`;
    if (/^https?:\/\//i.test(str)) return str;
    if (/^data:image\//i.test(str)) return str;
    return '';
}

function cloneMessage(message) {
    if (!message) return null;
    return {
        ...message,
        chatbadges: Array.isArray(message.chatbadges) ? message.chatbadges.map((badge) => {
            if (badge && typeof badge === 'object') return { ...badge };
            return badge;
        }) : []
    };
}

function badgeKeyToLabel(value) {
    const key = sanitizeText(value || '', 32).toLowerCase();
    if (!key) return '';

    if (['subscriber', 'subscription', 'sub', 'sub_gifter'].includes(key)) return 'SUB';
    if (['member', 'membership', 'sponsor', 'sponsorship', 'new_sponsor'].includes(key)) return 'MEM';
    if (key === 'founder') return 'FDR';
    if (['moderator', 'mod'].includes(key)) return 'MOD';
    if (key === 'vip') return 'VIP';
    if (['broadcaster', 'host', 'owner'].includes(key)) return 'HOST';
    if (['verified', 'verification'].includes(key)) return 'VER';
    if (['premium', 'prime'].includes(key)) return 'PRIME';
    if (key === 'staff') return 'STAFF';
    if (key === 'artist') return 'ART';
    return '';
}

function normalizeBadges(rawBadges) {
    const source = [];
    if (Array.isArray(rawBadges)) {
        source.push(...rawBadges);
    } else if (rawBadges && typeof rawBadges === 'object') {
        for (const [setId, version] of Object.entries(rawBadges)) {
            source.push({ setId, version });
        }
    } else {
        return [];
    }

    const out = [];
    for (const badge of source) {
        if (out.length >= 4) break;
        if (typeof badge === 'string') {
            const src = sanitizeUrl(badge);
            if (src) {
                out.push(src);
                continue;
            }
            const text = badgeKeyToLabel(badge);
            if (text) out.push({ type: 'text', text });
            continue;
        }
        if (!badge || typeof badge !== 'object') continue;

        const type = sanitizeText(badge.type || badge.kind || '', 16).toLowerCase();
        const setId = sanitizeText(badge.setId || badge.id || badge.key || badge.badge || '', 32).toLowerCase();
        const version = sanitizeText(badge.version || badge.level || '', 24);
        const tierText = (() => {
            if (/^\d+$/.test(version) && Number(version) > 0) {
                if (setId === 'subscriber' || setId === 'subscription' || setId === 'sub') return `SUB ${Number(version)}`;
                if (setId === 'member' || setId === 'membership' || setId === 'sponsor') return `MEM ${Number(version)}M`;
            }
            return '';
        })();
        const fallbackText = sanitizeText(
            badge.text
            || badge.label
            || badge.title
            || badge.name
            || badge.alt
            || tierText
            || badgeKeyToLabel(setId || version),
            24
        );

        if (type === 'text') {
            if (fallbackText) {
                const textBadge = { type: 'text', text: fallbackText };
                if (setId) textBadge.setId = setId;
                if (version) textBadge.version = version;
                out.push(textBadge);
            }
            continue;
        }

        const src = sanitizeUrl(
            badge.src
            || badge.url
            || badge.image
            || badge.imageUrl
            || badge.icon
            || badge.iconUrl
            || badge?.customThumbnail?.thumbnails?.[2]?.url
            || badge?.customThumbnail?.thumbnails?.[1]?.url
            || badge?.customThumbnail?.thumbnails?.[0]?.url
            || badge?.thumbnail?.url
            || badge?.thumbnail
            || ''
        );
        if (src) {
            const imgBadge = { type: 'img', src };
            if (setId) imgBadge.setId = setId;
            if (version) imgBadge.version = version;
            out.push(imgBadge);
            continue;
        }

        if (!fallbackText) continue;
        const textBadge = { type: 'text', text: fallbackText };
        if (setId) textBadge.setId = setId;
        if (version) textBadge.version = version;
        out.push(textBadge);
    }
    return out;
}

function normalizeSource(raw, fallback = 'unknown') {
    const source = sanitizeText(raw || fallback, 32).toLowerCase();
    if (!source) return 'unknown';
    if (source === 'yt') return 'youtube';
    if (source === 'tw') return 'twitch';
    return source;
}

function normalizeMessage(payload = {}, defaults = {}) {
    if (!payload || typeof payload !== 'object') return null;

    const source = normalizeSource(payload.source || payload.platform, defaults.source);
    const idRaw = sanitizeText(payload.id || payload.mid || payload.messageId || '', 120);
    const id = idRaw || crypto.randomUUID();

    const chatname = sanitizeText(payload.chatname || payload.name || payload.author || '', 120);
    const userId = sanitizeText(payload.userId || payload.authorId || '', 120);
    const chatmessage = sanitizeText(payload.chatmessage || payload.message || payload.text || '', 900);
    const donation = sanitizeText(payload.donation || payload.hasDonation || '', 150);
    const chatimg = sanitizeUrl(payload.chatimg || payload.avatar || '');
    const contentimg = sanitizeUrl(payload.contentimg || '');
    const membership = payload.membership === true;

    if (!chatname && !chatmessage && !donation && !contentimg) {
        return null;
    }

    const chatbadges = normalizeBadges(payload.chatbadges || payload.badges);
    const timestampRaw = sanitizeText(payload.timestamp || '', 80);
    const timestamp = timestampRaw && !Number.isNaN(Date.parse(timestampRaw))
        ? new Date(timestampRaw).toISOString()
        : new Date().toISOString();

    return {
        id,
        mid: id,
        source,
        platform: source,
        userId,
        chatname: chatname || 'Anonymous',
        chatmessage,
        donation,
        hasDonation: donation,
        chatimg,
        chatbadges,
        contentimg,
        membership,
        timestamp
    };
}

function emitSocketEvent(eventName, payload) {
    if (!ctx.io) return;
    ctx.io.emit(eventName, payload);
    ctx.io.of('/admin').emit(eventName, payload);
}

function normalizeTextSize(value, fallback) {
    const base = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_CHAT_MESSAGE_TEXT_SIZE;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return base;
    const rounded = Math.round(raw);
    return Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, rounded));
}

function getChatOptions() {
    const rawSeconds = Number(config.featureChatAutoHideSeconds ?? 0);
    const featureAutoHideSeconds = Number.isInteger(rawSeconds)
        ? Math.max(0, Math.min(30, rawSeconds))
        : 0;

    const legacyOffset = Number(config.chatTextSizeOffset ?? NaN);
    const legacySize = Number.isFinite(legacyOffset) ? (19 + legacyOffset) : NaN;
    const chatMessageTextSize = normalizeTextSize(
        config.chatMessageTextSize ?? legacySize,
        DEFAULT_CHAT_MESSAGE_TEXT_SIZE
    );
    const clickableChatMessageTextSize = normalizeTextSize(
        config.clickableChatMessageTextSize,
        DEFAULT_CLICKABLE_CHAT_MESSAGE_TEXT_SIZE
    );
    const featureMessageTextSize = normalizeTextSize(
        config.featureMessageTextSize,
        DEFAULT_FEATURE_MESSAGE_TEXT_SIZE
    );
    const chatTextSizeOffset = Math.max(-10, Math.min(10, Math.round(chatMessageTextSize - 19)));

    return {
        featureAutoHideSeconds,
        chatMessageTextSize,
        clickableChatMessageTextSize,
        featureMessageTextSize,
        chatTextSizeOffset
    };
}

function emitChatOptions() {
    pruneExpiredMessages();
    const options = getChatOptions();
    if (featuredMessage) {
        scheduleFeaturedAutoClear();
    }
    emitSocketEvent('chat-options', options);
    return options;
}

function clearFeaturedAutoTimer() {
    if (!featuredAutoClearTimer) return;
    clearTimeout(featuredAutoClearTimer);
    featuredAutoClearTimer = null;
}

function scheduleFeaturedAutoClear() {
    clearFeaturedAutoTimer();
    const options = getChatOptions();
    if (!options.featureAutoHideSeconds) return;

    featuredAutoClearTimer = setTimeout(() => {
        featuredAutoClearTimer = null;
        clearFeaturedChatMessage();
    }, options.featureAutoHideSeconds * 1000);
}

function parseMessageTimestampMs(message) {
    if (!message || !message.timestamp) return 0;
    const ms = Date.parse(String(message.timestamp));
    return Number.isFinite(ms) ? ms : 0;
}

function pruneExpiredMessages() {
    const cutoff = Date.now() - MESSAGE_MAX_AGE_MS;
    for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
        const ts = parseMessageTimestampMs(recentMessages[i]);
        if (!ts || ts >= cutoff) continue;
        recentMessages.splice(i, 1);
    }

    if (featuredMessage) {
        const ts = parseMessageTimestampMs(featuredMessage);
        if (ts && ts < cutoff) {
            clearFeaturedChatMessage();
        }
    }
}

function emitChatMessage(payload, options = {}) {
    pruneExpiredMessages();
    const message = normalizeMessage(payload, options);
    if (!message) return null;

    recentMessages.unshift(message);
    if (recentMessages.length > CHAT_HISTORY_LIMIT) {
        recentMessages.length = CHAT_HISTORY_LIMIT;
    }

    sorteios.handleMessage(message);

    emitSocketEvent('chat-message', message);
    return cloneMessage(message);
}

function featureChatMessage(payload, options = {}) {
    pruneExpiredMessages();
    const message = normalizeMessage(payload, options);
    if (!message) return null;

    featuredMessage = {
        ...message,
        featuredAt: new Date().toISOString()
    };
    emitSocketEvent('chat-featured', featuredMessage);
    scheduleFeaturedAutoClear();
    return cloneMessage(featuredMessage);
}

function featureChatMessageById(messageId) {
    pruneExpiredMessages();
    const id = sanitizeText(messageId, 120);
    if (!id) return null;
    const found = recentMessages.find((message) => message.id === id || message.mid === id);
    if (!found) return null;

    featuredMessage = {
        ...found,
        featuredAt: new Date().toISOString()
    };
    emitSocketEvent('chat-featured', featuredMessage);
    scheduleFeaturedAutoClear();
    return cloneMessage(featuredMessage);
}

function clearFeaturedChatMessage() {
    const hadFeatured = !!featuredMessage;
    clearFeaturedAutoTimer();
    featuredMessage = null;
    if (hadFeatured) {
        emitSocketEvent('chat-featured', null);
    }
    return hadFeatured;
}

function getChatState(options = {}) {
    pruneExpiredMessages();
    const rawLimit = Number(options.limit ?? DEFAULT_STATE_LIMIT);
    const limit = Number.isFinite(rawLimit)
        ? Math.max(1, Math.min(CHAT_HISTORY_LIMIT, Math.floor(rawLimit)))
        : DEFAULT_STATE_LIMIT;

    return {
        total: recentMessages.length,
        options: getChatOptions(),
        featured: cloneMessage(featuredMessage),
        recent: recentMessages.slice(0, limit).map(cloneMessage)
    };
}

function seedSocketWithChatState(socket, options = {}) {
    if (!socket || typeof socket.emit !== 'function') return;
    pruneExpiredMessages();
    socket.emit('chat-options', getChatOptions());
    socket.emit('chat-state', getChatState(options));
    if (featuredMessage) {
        socket.emit('chat-featured', cloneMessage(featuredMessage));
    }
}

module.exports = {
    emitChatMessage,
    featureChatMessage,
    featureChatMessageById,
    clearFeaturedChatMessage,
    getChatOptions,
    emitChatOptions,
    getChatState,
    seedSocketWithChatState
};
