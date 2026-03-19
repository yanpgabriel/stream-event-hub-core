'use strict';

const router = require('express').Router();
const { config, validateConfigPatch, applyConfigPatch, saveConfig } = require('../config');
const { listenerStatus, listenerHealth, setListenerStatus, bumpListenerEvent } = require('../health');
const { emitAlert } = require('../alerts');
const {
    normalizeLivePixWebhookPayload, processLivePixResourceById,
    getLivePixErrorMessage, markLivePixSeen, getBaseUrl,
    getLivePixAccessToken, syncLivePixWebhook, startLivePixListener,
    livePixWidgetCurrentId, livePixWidgetTopics, extractLivePixWidgetId,
} = require('../services/livepix');
const { LIVEPIX_WEBHOOK_SECRET, isValidLivePixWebhookSecret } = require('../security');

router.post('/webhooks/livepix', async (req, res) => {
    try {
        if (LIVEPIX_WEBHOOK_SECRET) {
            const providedSecret = req.get('x-livepix-secret')
                || req.get('x-stream-event-hub-secret')
                || req.query.secret
                || '';
            if (!isValidLivePixWebhookSecret(providedSecret)) {
                return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
            }
        }
        const payload = req.body || {};
        const normalized = normalizeLivePixWebhookPayload(payload);
        const resourceId = normalized?.rawId;
        const resourceKind = normalized?.kind || 'auto';
        let emitted = false;

        if (resourceId) {
            try {
                await processLivePixResourceById(resourceId, resourceKind);
                emitted = true;
            } catch (e) {
                const msg = getLivePixErrorMessage(e);
                console.error('[LivePix] Webhook enrichment warning:', msg);
            }
        }

        if (!emitted && normalized && markLivePixSeen(normalized.id)) {
            bumpListenerEvent('livepix');
            config.livePixLastSeenAt = normalized.createdAt || new Date().toISOString();
            saveConfig({ triggerRestart: false });
            emitAlert('tip-latest', normalized.event, { platform: 'livepix' });
        }
        res.json({ ok: true });
    } catch (err) {
        console.error('[LivePix] Webhook error:', err.response?.data || err.message);
        res.status(500).json({ ok: false, error: 'Webhook processing failed' });
    }
});

router.get('/api/livepix/status', (req, res) => {
    const configuredByUrl = !!config.livePixNotificationUrl;
    const configuredByApi = !!(config.livePixClientId && config.livePixClientSecret);
    res.json({
        configured: configuredByUrl || configuredByApi,
        mode: configuredByUrl ? 'notification_url' : (configuredByApi ? 'api' : 'unconfigured'),
        connected: listenerStatus.livepix === 'connected',
        webhookUrl: config.livePixWebhookUrl || '',
        webhookId: config.livePixWebhookId || '',
        notificationUrl: config.livePixNotificationUrl || '',
        widgetId: livePixWidgetCurrentId || extractLivePixWidgetId(config.livePixNotificationUrl || ''),
        topics: livePixWidgetTopics,
        tokenExpiresAt: config.livePixTokenExpiresAt || '',
        lastSeenAt: config.livePixLastSeenAt || ''
    });
});

router.post('/api/livepix/connect', async (req, res) => {
    try {
        const patch = {};
        if (typeof req.body?.livePixClientId === 'string') patch.livePixClientId = req.body.livePixClientId;
        if (typeof req.body?.livePixClientSecret === 'string') patch.livePixClientSecret = req.body.livePixClientSecret;
        if (typeof req.body?.livePixNotificationUrl === 'string') patch.livePixNotificationUrl = req.body.livePixNotificationUrl;
        if (Object.keys(patch).length) {
            const valid = validateConfigPatch(patch);
            if (!valid.ok) return res.status(400).json({ ok: false, errors: valid.errors });
            applyConfigPatch(valid.patch, { triggerRestart: false });
        }
        if (!config.livePixNotificationUrl) {
            const baseUrl = getBaseUrl(req);
            await getLivePixAccessToken(true);
            if (baseUrl) {
                try {
                    await syncLivePixWebhook(baseUrl);
                } catch (e) {
                    console.error('[LivePix] Webhook sync warning:', e.response?.data || e.message);
                }
            }
        }
        await startLivePixListener();
        if (listenerStatus.livepix === 'error') {
            throw new Error(listenerHealth.livepix.lastError || 'LivePix connection failed');
        }
        res.json({
            ok: true,
            status: listenerStatus.livepix,
            mode: config.livePixNotificationUrl ? 'notification_url' : 'api',
            webhookUrl: config.livePixWebhookUrl || '',
            notificationUrl: config.livePixNotificationUrl || ''
        });
    } catch (err) {
        console.error('[LivePix] Connect error:', err.response?.data || err.message);
        setListenerStatus('livepix', 'error', err.response?.data?.message || err.message);
        res.status(500).json({ ok: false, error: err.response?.data || err.message });
    }
});

module.exports = router;
