'use strict';

const { config } = require('./config');

const listenerStatus = { twitch: 'disconnected', youtube: 'disconnected', livepix: 'disconnected' };
const listenerHealth = {
    twitch: {
        status: 'disconnected',
        connectedSince: null,
        lastConnectedAt: null,
        lastEventAt: null,
        lastError: '',
        lastErrorAt: null,
        reconnectAttempts: 0
    },
    youtube: {
        status: 'disconnected',
        connectedSince: null,
        lastConnectedAt: null,
        lastEventAt: null,
        lastError: '',
        lastErrorAt: null,
        reconnectAttempts: 0
    },
    livepix: {
        status: 'disconnected',
        connectedSince: null,
        lastConnectedAt: null,
        lastEventAt: null,
        lastError: '',
        lastErrorAt: null,
        reconnectAttempts: 0
    }
};

function setListenerStatus(platform, status, errorMessage = '') {
    listenerStatus[platform] = status;
    listenerHealth[platform].status = status;
    if (status === 'connected') {
        listenerHealth[platform].connectedSince = new Date().toISOString();
        listenerHealth[platform].lastConnectedAt = new Date().toISOString();
    } else {
        listenerHealth[platform].connectedSince = null;
    }
    if (errorMessage) recordListenerError(platform, errorMessage);
}

function recordListenerError(platform, errorMessage = '') {
    if (!errorMessage) return;
    listenerHealth[platform].lastError = errorMessage;
    listenerHealth[platform].lastErrorAt = new Date().toISOString();
}

function bumpListenerEvent(platform) {
    listenerHealth[platform].lastEventAt = new Date().toISOString();
}

function getHealthResponse() {
    const now = Date.now();
    const out = {};
    for (const platform of ['twitch', 'youtube', 'livepix']) {
        const h = listenerHealth[platform];
        out[platform] = {
            ...h,
            uptimeMs: h.connectedSince ? now - Date.parse(h.connectedSince) : 0
        };
    }
    return out;
}

function decodeJwtExpiry(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload.exp) return null;
        const expiry = Number(payload.exp) * 1000;
        return {
            expiresAt: new Date(expiry).toISOString(),
            expiresInMs: Math.max(0, expiry - Date.now())
        };
    } catch {
        return null;
    }
}

function buildTokenHealth() {
    const decoded = decodeJwtExpiry(config.twitchAccessToken);
    const livePixMode = config.livePixNotificationUrl
        ? 'notification_url'
        : (config.livePixClientId && config.livePixClientSecret ? 'api' : 'unconfigured');
    return {
        twitch: {
            accessTokenPresent: !!config.twitchAccessToken,
            refreshTokenPresent: !!config.twitchRefreshToken,
            decodedExpiry: decoded,
            note: decoded ? 'Decoded JWT expiry' : 'Opaque token or no JWT exp claim'
        },
        youtube: {
            clientIdPresent: !!config.googleClientId,
            clientSecretPresent: !!config.googleClientSecret,
            accessTokenPresent: !!config.youtubeAccessToken,
            refreshTokenPresent: !!config.youtubeRefreshToken,
            tokenExpiresAt: config.youtubeTokenExpiresAt || null
        },
        livepix: {
            mode: livePixMode,
            notificationUrlConfigured: !!config.livePixNotificationUrl,
            accessTokenPresent: !!config.livePixAccessToken,
            tokenExpiresAt: config.livePixTokenExpiresAt || null
        }
    };
}

module.exports = {
    listenerStatus, listenerHealth,
    setListenerStatus, recordListenerError, bumpListenerEvent,
    getHealthResponse, decodeJwtExpiry, buildTokenHealth,
};
