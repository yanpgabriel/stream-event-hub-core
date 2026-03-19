'use strict';

const express = require('express');
const router = express.Router();
const sorteiosModule = require('../services/sorteios');

router.get('/api/sorteios/state', (req, res) => {
    try {
        const state = sorteiosModule.getState();
        res.json({ ok: true, state });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/api/sorteios/start', (req, res) => {
    try {
        const { keyword } = req.body;
        const state = sorteiosModule.startRaffle(keyword);
        res.json({ ok: true, state });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/api/sorteios/stop', (req, res) => {
    try {
        const state = sorteiosModule.stopRaffle();
        res.json({ ok: true, state });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/api/sorteios/clear', (req, res) => {
    try {
        const state = sorteiosModule.clearParticipants();
        res.json({ ok: true, state });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/api/sorteios/draw', (req, res) => {
    try {
        const winner = sorteiosModule.drawWinner();
        res.json({ ok: true, winner });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/api/sorteios/replay', (req, res) => {
    try {
        const { name } = req.body;
        sorteiosModule.replayWinner(name);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
