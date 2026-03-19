'use strict';

const axios = require('axios');
const router = require('express').Router();
const { requireAdmin, requireCsrf } = require('../auth');
const { config, validateConfigPatch, applyConfigPatch } = require('../config');

router.post('/auth/twitch/device', requireAdmin, requireCsrf, async (req, res) => {
    if (!config.twitchClientId) {
        return res.status(400).json({ error: 'Save Client ID first' });
    }
    try {
        const scopes = 'user:read:email moderator:read:followers channel:read:subscriptions bits:read channel:read:redemptions chat:read';
        const response = await axios.post(
            'https://id.twitch.tv/oauth2/device',
            `client_id=${config.twitchClientId}&scopes=${encodeURIComponent(scopes)}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        console.log(`[Twitch] Device Code requested. User code: ${response.data.user_code}`);
        res.json(response.data);
    } catch (err) {
        console.error('[Twitch] Device Code Error:', err.response?.data || err.message);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

router.post('/auth/twitch/poll', requireAdmin, requireCsrf, async (req, res) => {
    const { device_code } = req.body || {};
    if (!device_code) return res.status(400).json({ error: 'Missing device_code' });

    try {
        const response = await axios.post(
            'https://id.twitch.tv/oauth2/token',
            `client_id=${config.twitchClientId}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const { access_token, refresh_token } = response.data;
        const patchResult = validateConfigPatch({ twitchAccessToken: access_token, twitchRefreshToken: refresh_token });
        if (!patchResult.ok) return res.status(500).json({ error: patchResult.errors });
        applyConfigPatch(patchResult.patch);
        console.log('[Twitch] Device Code Flow: Token saved');
        res.json({ success: true });
    } catch (err) {
        const errData = err.response?.data;
        if (errData && errData.message === 'authorization_pending') {
            return res.json({ pending: true });
        }
        console.error('[Twitch] Poll Error:', errData || err.message);
        res.status(500).json({ error: errData || err.message });
    }
});

module.exports = router;
