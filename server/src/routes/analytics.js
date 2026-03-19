'use strict';

const router = require('express').Router();
const sessionMetrics = require('../sessionMetrics');

router.get('/api/analytics/overview', (req, res) => {
    try {
        const payload = sessionMetrics.getAnalyticsOverview({
            period: req.query?.period,
            platform: req.query?.platform,
            from: req.query?.from,
            to: req.query?.to,
            bucket: req.query?.bucket,
            tzOffsetMin: req.query?.tzOffsetMin
        });
        return res.json(payload);
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: err?.message || 'Failed to compute analytics overview'
        });
    }
});

module.exports = router;
