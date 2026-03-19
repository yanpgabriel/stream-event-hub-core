'use strict';

const router = require('express').Router();
const { config, normalizeTtsText, normalizeTtsLang, fetchFallbackTtsAudio } = require('../config');
const { getLatestWidgetData } = require('../alerts');

router.get('/api/widget-data', (req, res) => {
    const latest = getLatestWidgetData();
    res.json({
        lastFollower: latest.lastFollower || config.lastFollower || '',
        lastSub: latest.lastSub || config.lastSub || '',
        lastFollowerMeta: latest.lastFollowerMeta || null,
        lastSubMeta: latest.lastSubMeta || null,
        livePixNotificationUrl: config.livePixNotificationUrl || ''
    });
});

router.get('/api/tts/fallback', async (req, res) => {
    try {
        const text = normalizeTtsText(req.query.text || req.query.q);
        if (!text) return res.status(400).json({ ok: false, error: 'text required' });
        const lang = normalizeTtsLang(req.query.lang || req.query.tl || 'en');
        const audio = await fetchFallbackTtsAudio(text, lang);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=120');
        return res.send(audio);
    } catch (err) {
        const msg = err?.message || String(err);
        console.error('[TTS] Fallback proxy error:', msg);
        return res.status(502).json({ ok: false, error: 'TTS upstream failed' });
    }
});

module.exports = router;
