'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SECRET_FIELDS,
    splitConfigForPersistence,
    shouldTriggerRestartForPatch,
} = require('../src/config');

test('splitConfigForPersistence keeps secrets out of public config', () => {
    const cfg = {
        youtubeLiveId: 'abc123',
        googleClientSecret: 'secret-one',
        twitchAccessToken: 'secret-two',
        alertDuration: 8
    };
    const { publicConfig, secretConfig } = splitConfigForPersistence(cfg);

    assert.equal(publicConfig.youtubeLiveId, 'abc123');
    assert.equal(publicConfig.alertDuration, 8);
    for (const field of SECRET_FIELDS) {
        assert.equal(field in publicConfig, false);
    }
    assert.equal(secretConfig.googleClientSecret, 'secret-one');
    assert.equal(secretConfig.twitchAccessToken, 'secret-two');
});

test('shouldTriggerRestartForPatch skips UI-only changes and restarts integrations when needed', () => {
    assert.equal(shouldTriggerRestartForPatch({ chatMessageTextSize: 24 }), false);
    assert.equal(shouldTriggerRestartForPatch({ alertSounds: { tip: { url: '/sounds/a.mp3', volume: 60 } } }), false);
    assert.equal(shouldTriggerRestartForPatch({ youtubeLiveId: 'new-live-id' }), true);
    assert.equal(shouldTriggerRestartForPatch({ livePixNotificationUrl: 'https://widget.livepix.gg/embed/abc' }), true);
});
