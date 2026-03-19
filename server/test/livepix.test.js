'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildSyntheticLivePixId,
    normalizeLivePixWebhookPayload,
    normalizeLivePixPayment,
} = require('../src/services/livepix');

test('LivePix synthetic IDs stay stable for equivalent payloads without provider IDs', () => {
    const payloadA = {
        amount: 1500,
        currency: 'BRL',
        createdAt: '2026-03-12T10:00:00.000Z',
        message: 'Valeu!',
        username: 'Viktor'
    };
    const payloadB = {
        username: 'Viktor',
        message: 'Valeu!',
        createdAt: '2026-03-12T10:00:00.000Z',
        currency: 'BRL',
        amount: 1500
    };

    const normalizedA = normalizeLivePixWebhookPayload(payloadA);
    const normalizedB = normalizeLivePixWebhookPayload(payloadB);

    assert.ok(normalizedA?.rawId.startsWith('synthetic:'));
    assert.equal(normalizedA?.rawId, normalizedB?.rawId);
    assert.equal(normalizedA?.id, normalizedB?.id);
});

test('normalizeLivePixPayment uses deterministic fallback IDs when the provider omits one', () => {
    const payment = {
        username: 'Viktor',
        amount: 2500,
        currency: 'BRL',
        message: 'Pix do café',
        createdAt: '2026-03-12T10:05:00.000Z'
    };

    const normalized = normalizeLivePixPayment(payment, 'payment');
    assert.ok(normalized?.rawId.startsWith('synthetic:'));
    assert.equal(
        normalized?.rawId,
        buildSyntheticLivePixId('payment', {
            donor: 'Viktor',
            amountRaw: 2500,
            amount: 'R$ 25,00',
            amountCents: 2500,
            currency: 'BRL',
            message: 'Pix do café',
            createdAt: '2026-03-12T10:05:00.000Z'
        })
    );
});
