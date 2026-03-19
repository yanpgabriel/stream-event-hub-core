'use strict';

const router = require('express').Router();
const ctx = require('../ctx');
const { listenerStatus, getHealthResponse, buildTokenHealth } = require('../health');
const { getAudienceSnapshot } = require('../services/audience');

router.get('/api/status', (req, res) => {
    res.json(listenerStatus);
});

router.get('/api/health/connections', (req, res) => {
    res.json(getHealthResponse());
});

router.get('/api/health/tokens', (req, res) => {
    res.json(buildTokenHealth());
});

router.get('/api/health/ready', (_req, res) => {
    if (ctx.serverReady && !ctx.shuttingDown) {
        return res.json({ ok: true, ready: true });
    }
    return res.status(503).json({ ok: false, ready: false, shuttingDown: !!ctx.shuttingDown });
});

router.get('/api/audience', async (req, res) => {
    try {
        const force = req.query.force === '1';
        const audience = await getAudienceSnapshot({ force });
        res.json(audience);
    } catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to load audience' });
    }
});

router.post('/api/listeners/restart', async (req, res) => {
    if (typeof ctx.restartListeners === 'function') await ctx.restartListeners();
    res.json({ ok: true, status: listenerStatus });
});

router.post('/api/listeners/restart/:platform', async (req, res) => {
    const platform = req.params.platform;
    if (!['twitch', 'youtube', 'livepix'].includes(platform)) {
        return res.status(400).json({ error: 'Platform must be twitch or youtube or livepix' });
    }
    if (platform === 'twitch' && typeof ctx.restartTwitchListener === 'function') {
        await ctx.restartTwitchListener();
    } else if (platform === 'youtube' && typeof ctx.restartYouTubeListener === 'function') {
        await ctx.restartYouTubeListener();
    } else if (platform === 'livepix' && typeof ctx.restartLivePixListener === 'function') {
        await ctx.restartLivePixListener();
    }
    res.json({ ok: true, status: listenerStatus[platform] });
});

module.exports = router;
