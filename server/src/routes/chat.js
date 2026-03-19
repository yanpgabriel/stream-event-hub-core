'use strict';

const router = require('express').Router();
const {
    emitChatMessage,
    featureChatMessage,
    featureChatMessageById,
    clearFeaturedChatMessage,
    getChatState
} = require('../services/chat');

router.get('/api/chat/state', (req, res) => {
    const limit = Number(req.query.limit || 120);
    res.json(getChatState({ limit }));
});

router.post('/api/chat/test', (req, res) => {
    const body = req.body || {};
    const message = emitChatMessage({
        source: 'manual',
        chatname: body.chatname || body.name || 'StreamEventHub',
        chatmessage: body.chatmessage || body.message || '',
        donation: body.donation || '',
        chatimg: body.chatimg || '',
        chatbadges: body.chatbadges || []
    }, { source: 'manual' });

    if (!message) {
        return res.status(400).json({ ok: false, error: 'Invalid message payload' });
    }
    return res.json({ ok: true, message });
});

router.post('/api/chat/feature', (req, res) => {
    const body = req.body || {};
    const featured = (typeof body.id === 'string' && body.id.trim())
        ? featureChatMessageById(body.id)
        : featureChatMessage(body, { source: body.source || 'manual' });

    if (!featured) {
        return res.status(404).json({ ok: false, error: 'Message not found' });
    }
    return res.json({ ok: true, featured });
});

router.post('/api/chat/feature/clear', (_req, res) => {
    clearFeaturedChatMessage();
    res.json({ ok: true });
});

module.exports = router;
