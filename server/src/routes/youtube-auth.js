'use strict';

const crypto = require('crypto');
const axios = require('axios');
const router = require('express').Router();
const { requireAdmin, requireCsrf, getSession } = require('../auth');
const { config, validateConfigPatch, applyConfigPatch } = require('../config');
const ctx = require('../ctx');

const YT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ytOauthStates = new Map();
const YT_AUTH_SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

function resolveBaseUrl(req) {
    const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
    const proto = rawProto.split(',')[0].trim() || 'http';
    const rawHost = String(req.headers['x-forwarded-host'] || req.get('host') || '');
    const host = rawHost.split(',')[0].trim();
    return `${proto}://${host}`;
}

function resolveYouTubeRedirectUri(req) {
    const fromConfig = String(config.youtubeOAuthRedirectUri || '').trim();
    if (fromConfig) return fromConfig;
    const explicit = String(process.env.YOUTUBE_OAUTH_REDIRECT_URI || '').trim();
    if (explicit) return explicit;
    return `${resolveBaseUrl(req)}/auth/youtube/callback`;
}

function cleanupExpiredStates() {
    const now = Date.now();
    for (const [state, meta] of ytOauthStates.entries()) {
        if (!meta || meta.expiresAt <= now) {
            ytOauthStates.delete(state);
        }
    }
}

function successHtml(message = 'YouTube authorization completed. You can close this window.') {
    const payload = JSON.stringify({ type: 'youtube-auth-result', ok: true, message });
    const safeMessage = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube Auth</title></head><body><p>${safeMessage}</p><script>(function(){var msg=${payload};if(window.opener&&!window.opener.closed){try{window.opener.postMessage(msg,window.location.origin);}catch(e){}window.close();}})();</script></body></html>`;
}

function errorHtml(message = 'YouTube authorization failed.') {
    const payload = JSON.stringify({ type: 'youtube-auth-result', ok: false, message });
    const safeMessage = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube Auth Error</title></head><body><p>${safeMessage}</p><script>(function(){var msg=${payload};if(window.opener&&!window.opener.closed){try{window.opener.postMessage(msg,window.location.origin);}catch(e){}}})();</script></body></html>`;
}

router.post('/auth/youtube/start', requireAdmin, requireCsrf, async (req, res) => {
    if (!config.googleClientId || !config.googleClientSecret) {
        return res.status(400).json({ ok: false, error: 'Save Google Client ID and Client Secret first' });
    }

    cleanupExpiredStates();
    const state = crypto.randomBytes(24).toString('hex');
    ytOauthStates.set(state, {
        expiresAt: Date.now() + YT_OAUTH_STATE_TTL_MS,
        sid: req.session?.sid || ''
    });

    const redirectUri = resolveYouTubeRedirectUri(req);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', config.googleClientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('scope', YT_AUTH_SCOPES.join(' '));
    authUrl.searchParams.set('state', state);

    return res.json({ ok: true, authUrl: authUrl.toString(), redirectUri });
});

router.get('/auth/youtube/callback', async (req, res) => {
    cleanupExpiredStates();
    const state = String(req.query.state || '').trim();
    const code = String(req.query.code || '').trim();
    const oauthError = String(req.query.error || '').trim();

    const stateMeta = state ? ytOauthStates.get(state) : null;
    if (state) ytOauthStates.delete(state);

    if (!stateMeta || stateMeta.expiresAt <= Date.now()) {
        return res.status(400).send(errorHtml('Invalid or expired OAuth state. Start YouTube connection again.'));
    }

    const session = getSession(req);
    if (!session || (stateMeta.sid && session.sid !== stateMeta.sid)) {
        return res.status(401).send(errorHtml('Session expired. Login again and retry YouTube connection.'));
    }

    if (oauthError) {
        return res.status(400).send(errorHtml(`YouTube authorization denied: ${oauthError}`));
    }
    if (!code) {
        return res.status(400).send(errorHtml('Missing authorization code from Google.'));
    }
    if (!config.googleClientId || !config.googleClientSecret) {
        return res.status(400).send(errorHtml('Google OAuth credentials are not configured.'));
    }

    try {
        const redirectUri = resolveYouTubeRedirectUri(req);
        const tokenRes = await axios.post(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                code,
                client_id: config.googleClientId,
                client_secret: config.googleClientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 12000,
                validateStatus: () => true
            }
        );

        if (tokenRes.status < 200 || tokenRes.status >= 300) {
            const upstream = tokenRes.data?.error_description || tokenRes.data?.error || `status ${tokenRes.status}`;
            return res.status(502).send(errorHtml(`Google token exchange failed: ${upstream}`));
        }

        const accessToken = String(tokenRes.data?.access_token || '').trim();
        const refreshToken = String(tokenRes.data?.refresh_token || '').trim();
        const expiresInSec = Number(tokenRes.data?.expires_in || 0);
        const expiresAt = Number.isFinite(expiresInSec) && expiresInSec > 0
            ? new Date(Date.now() + expiresInSec * 1000).toISOString()
            : '';

        if (!accessToken) {
            return res.status(502).send(errorHtml('Google token exchange did not return an access token.'));
        }

        const patch = { youtubeAccessToken: accessToken, youtubeTokenExpiresAt: expiresAt };
        if (refreshToken) patch.youtubeRefreshToken = refreshToken;

        const validation = validateConfigPatch(patch);
        if (!validation.ok) {
            return res.status(500).send(errorHtml(validation.errors?.[0]?.message || 'Invalid token payload'));
        }

        applyConfigPatch(validation.patch, { triggerRestart: false });
        if (typeof ctx.restartYouTubeListener === 'function') {
            await ctx.restartYouTubeListener();
        } else if (typeof ctx.restartListeners === 'function') {
            await ctx.restartListeners();
        }

        return res.send(successHtml('YouTube connected successfully. You can close this window.'));
    } catch (err) {
        const msg = err?.message || String(err);
        return res.status(500).send(errorHtml(`YouTube authorization failed: ${msg}`));
    }
});

module.exports = router;
