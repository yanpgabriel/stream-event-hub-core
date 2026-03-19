'use strict';

const router = require('express').Router();
const { requireAdmin, requireCsrf } = require('../auth');
const alerts = require('../alerts');

router.get('/api/alert-history', (req, res) => {
    alerts.pruneExpiredReplayHistory({ persist: true });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const cursor = Math.max(0, Number(req.query.cursor || 0));
    const filtered = alerts.filterHistory(alerts.alertHistory, req.query);
    const items = filtered.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < filtered.length ? cursor + limit : null;
    res.json({ items, nextCursor, total: filtered.length });
});

router.get('/api/alert-history/export', (req, res) => {
    alerts.pruneExpiredReplayHistory({ persist: true });
    const format = (req.query.format || 'json').toLowerCase();
    const filtered = alerts.filterHistory(alerts.alertHistory, req.query);
    if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="alert-history-${Date.now()}.csv"`);
        return res.send(alerts.historyCsv(filtered));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="alert-history-${Date.now()}.json"`);
    return res.send(JSON.stringify(filtered, null, 2));
});

router.post('/api/alert-replay', (req, res) => {
    const { listener, event: eventData } = req.body || {};
    if (!listener || !eventData) return res.status(400).json({ error: 'listener and event required' });
    alerts.emitAlert(listener, eventData, {
        target: 'production',
        ignoreToggles: true,
        recordHistory: true,
        replay: true,
        platform: 'replay'
    });
    console.log(`[Replay] Re-emitted ${listener} for ${eventData.name || 'unknown'}`);
    res.json({ success: true });
});

router.get('/api/queue/status', (req, res) => {
    res.json(alerts.queueStatus());
});

router.post('/api/queue/clear', (req, res) => {
    alerts.outboundQueue.length = 0;
    res.json({ ok: true, ...alerts.queueStatus() });
});

router.post('/api/test-alert', (req, res) => {
    const body = req.body || {};
    const event = String(body.event || '').trim();
    const validEvents = ['follow', 'sub', 'tip', 'cheer', 'raid'];
    if (!validEvents.includes(event)) {
        return res.status(400).json({ error: 'Invalid event. Use follow|sub|tip|cheer|raid' });
    }

    const listener = {
        follow: 'follower-latest',
        sub: 'subscriber-latest',
        tip: 'tip-latest',
        cheer: 'cheer-latest',
        raid: 'raid-latest'
    }[event];

    const payload = {
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'TestUser',
        amount: body.amount,
        message: typeof body.message === 'string' ? body.message : '',
        tier: typeof body.tier === 'string' ? body.tier : ''
    };

    const target = body.target === 'sandbox' ? 'sandbox' : 'production';
    const duplicateCount = Math.min(20, Math.max(1, Number(body.duplicateCount || 1)));
    const cooldownMs = Math.min(5000, Math.max(0, Number(body.cooldownMs || 0)));

    for (let i = 0; i < duplicateCount; i++) {
        setTimeout(() => {
            alerts.emitAlert(listener, payload, { target });
        }, i * cooldownMs);
    }

    res.json({ ok: true, listener, target, duplicateCount, cooldownMs, payload });
});

// Backward compatibility test endpoint
router.post('/test-trigger', requireAdmin, requireCsrf, (req, res) => {
    const body = req.body || {};
    const mapping = { follow: 'follower-latest', sub: 'subscriber-latest', tip: 'tip-latest', cheer: 'cheer-latest', raid: 'raid-latest' };
    const listener = mapping[body.event] || 'follower-latest';
    alerts.emitAlert(listener, {
        name: body.name || 'TestUser',
        amount: body.amount,
        message: body.message,
        tier: body.tier
    }, { target: 'production' });
    res.json({ success: true });
});

module.exports = router;
