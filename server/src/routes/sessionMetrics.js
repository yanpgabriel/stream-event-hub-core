'use strict';

const router = require('express').Router();
const sessionMetrics = require('../sessionMetrics');

router.get('/api/session/summary', (_req, res) => {
    const summary = sessionMetrics.getCurrentSessionSummary();
    res.json(summary);
});

router.post('/api/session/start', (_req, res) => {
    const session = sessionMetrics.startNewSession({ reason: 'manual', persist: true });
    res.json({
        ok: true,
        session: {
            id: session.id,
            startedAt: session.startedAt,
            updatedAt: session.updatedAt
        },
        summary: sessionMetrics.getCurrentSessionSummary()
    });
});

router.post('/api/session/end', (_req, res) => {
    const session = sessionMetrics.endCurrentSession({ reason: 'manual', persist: true });
    if (!session) {
        return res.status(500).json({ ok: false, error: 'Could not end session' });
    }
    return res.json({
        ok: true,
        session: {
            id: session.id,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            updatedAt: session.updatedAt
        },
        summary: sessionMetrics.getCurrentSessionSummary()
    });
});

module.exports = router;
