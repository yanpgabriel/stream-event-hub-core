'use strict';

const router = require('express').Router();
const {
    ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_COOKIE, SESSION_TTL_MS,
    createSession, getSession, clearSession, requireAdmin, requireCsrf,
} = require('../auth');
const {
    isTrustedLocalRequest,
    shouldUseSecureCookies,
    ADMIN_TRUST_LOCAL_NETWORK,
} = require('../security');

router.post('/api/auth/login', (req, res) => {
    if (isTrustedLocalRequest(req)) {
        return res.json({
            ok: true,
            username: 'local-network',
            csrfToken: '',
            trustedLocal: true
        });
    }
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
        return res.status(503).json({ ok: false, error: 'Admin credentials are not configured' });
    }
    const { username, password } = req.body || {};
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    const session = createSession(username);
    res.cookie(SESSION_COOKIE, session.sid, {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req),
        path: '/',
        maxAge: SESSION_TTL_MS
    });
    res.json({ ok: true, username: session.username, csrfToken: session.csrfToken });
});

router.post('/api/auth/logout', requireAdmin, requireCsrf, (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
});

router.get('/api/auth/me', (req, res) => {
    const session = getSession(req);
    if (!session) return res.status(401).json({ authenticated: false });
    res.json({
        authenticated: true,
        username: session.username,
        csrfToken: session.csrfToken,
        trustedLocal: session.trustedLocal === true,
        authMode: session.trustedLocal === true ? 'local-trust' : 'session',
        adminTrustLocalNetwork: ADMIN_TRUST_LOCAL_NETWORK
    });
});

// Admin API protection middleware
router.use('/api', (req, res, next) => {
    const publicGets = new Set(['/widget-data', '/tts/fallback', '/health/ready', '/overlay/state']);
    const publicPosts = new Set(['/auth/login']);
    if (req.method === 'GET' && publicGets.has(req.path)) return next();
    if (req.method === 'POST' && publicPosts.has(req.path)) return next();
    if (isTrustedLocalRequest(req)) {
        req.session = getSession(req);
        return next();
    }
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    return requireCsrf(req, res, next);
});

module.exports = router;
