'use strict';

const crypto = require('crypto');
const {
    isTrustedLocalRequest,
    buildTrustedLocalSession,
    shouldUseSecureCookies,
} = require('./security');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_COOKIE = 'st_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const sessions = new Map();

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    return raw.split(';').reduce((acc, item) => {
        const idx = item.indexOf('=');
        if (idx < 0) return acc;
        const key = item.slice(0, idx).trim();
        const val = decodeURIComponent(item.slice(idx + 1).trim());
        acc[key] = val;
        return acc;
    }, {});
}

function createSession(username) {
    const sid = crypto.randomBytes(24).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const session = {
        sid,
        username,
        csrfToken,
        createdAt: Date.now(),
        lastSeenAt: Date.now()
    };
    sessions.set(sid, session);
    return session;
}

function isSessionExpired(session, nowMs = Date.now()) {
    if (!session || typeof session !== 'object') return true;
    const lastSeenAt = Number(session.lastSeenAt || 0);
    if (!Number.isFinite(lastSeenAt) || lastSeenAt <= 0) return true;
    return nowMs - lastSeenAt > SESSION_TTL_MS;
}

function getSessionById(sid, options = {}) {
    const key = String(sid || '').trim();
    if (!key) return null;

    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const shouldTouch = options.touch !== false;
    const session = sessions.get(key);
    if (!session) return null;

    if (isSessionExpired(session, nowMs)) {
        sessions.delete(key);
        return null;
    }

    if (shouldTouch) {
        session.lastSeenAt = nowMs;
    }
    return session;
}

function getSession(req) {
    if (isTrustedLocalRequest(req)) {
        return buildTrustedLocalSession();
    }
    const sid = parseCookies(req)[SESSION_COOKIE];
    return getSessionById(sid);
}

function clearExpiredSessions(nowMs = Date.now()) {
    let removed = 0;
    for (const [sid, session] of sessions.entries()) {
        if (!isSessionExpired(session, nowMs)) continue;
        sessions.delete(sid);
        removed += 1;
    }
    return removed;
}

function clearSession(req, res) {
    const sid = parseCookies(req)[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    res.cookie(SESSION_COOKIE, '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req),
        path: '/'
    });
}

function requireAdmin(req, res, next) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    next();
}

function requireCsrf(req, res, next) {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
    const exempt = ['/api/auth/login'];
    if (exempt.includes(req.path)) return next();
    const session = req.session || getSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    if (session.trustedLocal === true) return next();
    const header = req.get('x-csrf-token');
    if (!header || header !== session.csrfToken) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
}

module.exports = {
    ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_COOKIE, SESSION_TTL_MS,
    sessions, parseCookies, createSession, isSessionExpired,
    getSessionById, getSession, clearExpiredSessions, clearSession,
    requireAdmin, requireCsrf,
};
