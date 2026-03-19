'use strict';

const crypto = require('crypto');

const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
const ADMIN_TRUST_LOCAL_NETWORK = !/^(0|false|no|off)$/i.test(String(process.env.ADMIN_TRUST_LOCAL_NETWORK || 'true'));
const COOKIE_SECURE_MODE = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
const SOCKET_ALLOWED_ORIGINS = String(process.env.SOCKET_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const LIVEPIX_WIDGET_SOCKET_TOKEN = String(process.env.LIVEPIX_WIDGET_SOCKET_TOKEN || '').trim();
const LIVEPIX_WEBHOOK_SECRET = String(process.env.LIVEPIX_WEBHOOK_SECRET || '').trim();

function normalizeIp(value) {
    let ip = String(value || '').trim().toLowerCase();
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (ip === '::1') return '127.0.0.1';
    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
    return ip;
}

function isPrivateNetworkIp(value) {
    const ip = normalizeIp(value);
    if (!ip) return false;
    if (ip === '127.0.0.1' || ip === '0.0.0.0') return true;
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    if (/^fc|^fd/.test(ip)) return true;
    if (/^fe80:/.test(ip)) return true;
    return false;
}

function canTrustForwardedHeaders(directIp) {
    if (!TRUST_PROXY) return false;
    return isPrivateNetworkIp(directIp);
}

function extractIpFromForwardedHeader(value, directIp = '') {
    if (!TRUST_PROXY) return '';
    if (!canTrustForwardedHeaders(directIp)) return '';
    const first = String(value || '').split(',')[0];
    return normalizeIp(first);
}

function getRequestIp(req) {
    const direct = normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress || '');
    const forwarded = extractIpFromForwardedHeader(req?.headers?.['x-forwarded-for'], direct);
    if (forwarded) return forwarded;
    if (direct) return direct;
    return normalizeIp(req?.ip || '');
}

function getSocketIp(socket) {
    const direct = normalizeIp(socket?.conn?.remoteAddress || socket?.handshake?.address || '');
    const forwarded = extractIpFromForwardedHeader(socket?.handshake?.headers?.['x-forwarded-for'], direct);
    if (forwarded) return forwarded;
    return direct;
}

function isTrustedLocalRequest(req) {
    if (!ADMIN_TRUST_LOCAL_NETWORK) return false;
    return isPrivateNetworkIp(getRequestIp(req));
}

function isTrustedLocalSocket(socket) {
    if (!ADMIN_TRUST_LOCAL_NETWORK) return false;
    return isPrivateNetworkIp(getSocketIp(socket));
}

function buildTrustedLocalSession() {
    return {
        sid: 'trusted-local-network',
        username: 'local-network',
        csrfToken: '',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        trustedLocal: true
    };
}

function shouldUseSecureCookies(req) {
    if (COOKIE_SECURE_MODE === 'true' || COOKIE_SECURE_MODE === 'always') return true;
    if (COOKIE_SECURE_MODE === 'false' || COOKIE_SECURE_MODE === 'never') return false;
    if (req?.secure) return true;
    if (TRUST_PROXY) {
        const proto = String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
        if (proto === 'https') return true;
    }
    return false;
}

function isAllowedSocketOrigin(origin) {
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        const normalizedOrigin = parsed.origin.toLowerCase();
        if (SOCKET_ALLOWED_ORIGINS.length) {
            return SOCKET_ALLOWED_ORIGINS.some((allowed) => allowed.toLowerCase() === normalizedOrigin);
        }
        const hostname = parsed.hostname.toLowerCase();
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname.endsWith('.local')
            || isPrivateNetworkIp(hostname);
    } catch {
        return false;
    }
}

function socketCorsOrigin(origin, callback) {
    const allowed = isAllowedSocketOrigin(origin);
    if (typeof callback === 'function') {
        callback(allowed ? null : new Error('Origin not allowed'), allowed);
    }
}

function timingSafeTokenMatch(expected, provided) {
    const expectedText = String(expected || '').trim();
    const providedText = String(provided || '').trim();
    if (!expectedText || !providedText) return false;
    const left = Buffer.from(expectedText);
    const right = Buffer.from(providedText);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function isValidLivePixSocketToken(value) {
    return timingSafeTokenMatch(LIVEPIX_WIDGET_SOCKET_TOKEN, value);
}

function isValidLivePixWebhookSecret(value) {
    return timingSafeTokenMatch(LIVEPIX_WEBHOOK_SECRET, value);
}

module.exports = {
    TRUST_PROXY,
    ADMIN_TRUST_LOCAL_NETWORK,
    LIVEPIX_WIDGET_SOCKET_TOKEN,
    LIVEPIX_WEBHOOK_SECRET,
    normalizeIp,
    isPrivateNetworkIp,
    canTrustForwardedHeaders,
    getRequestIp,
    getSocketIp,
    isTrustedLocalRequest,
    isTrustedLocalSocket,
    buildTrustedLocalSession,
    shouldUseSecureCookies,
    socketCorsOrigin,
    isAllowedSocketOrigin,
    isValidLivePixSocketToken,
    isValidLivePixWebhookSecret
};
