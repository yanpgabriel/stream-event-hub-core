'use strict';

const router = require('express').Router();
const { config, CONFIG_VERSION, redactConfig, validateConfigPatch, applyConfigPatch, shouldTriggerRestartForPatch } = require('../config');
const { emitChatOptions } = require('../services/chat');

router.get('/api/config', (req, res) => {
    res.json(redactConfig(config));
});

router.post('/api/config/validate', (req, res) => {
    const result = validateConfigPatch(req.body);
    if (!result.ok) return res.status(400).json({ ok: false, errors: result.errors, version: config.version || CONFIG_VERSION });
    res.json({ ok: true, version: config.version || CONFIG_VERSION });
});

router.post('/api/config', (req, res) => {
    const result = validateConfigPatch(req.body);
    if (!result.ok) return res.status(400).json({ ok: false, errors: result.errors, version: config.version || CONFIG_VERSION });
    const shouldRestart = shouldTriggerRestartForPatch(result.patch);

    applyConfigPatch(result.patch, { triggerRestart: shouldRestart });
    if (
        'featureChatAutoHideSeconds' in result.patch
        || 'chatMessageTextSize' in result.patch
        || 'clickableChatMessageTextSize' in result.patch
        || 'featureMessageTextSize' in result.patch
        || 'chatTextSizeOffset' in result.patch
    ) {
        emitChatOptions();
    }
    res.json({ ok: true, version: config.version, lastSavedAt: config.lastSavedAt, config: redactConfig(config) });
});

module.exports = router;
