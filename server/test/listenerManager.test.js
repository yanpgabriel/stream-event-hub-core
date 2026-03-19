'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createListenerManager } = require('../src/listenerManager');

test('listener manager serializes restart operations', async () => {
    const calls = [];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const manager = createListenerManager({
        restartTwitchListener: async () => {
            calls.push('twitch:start');
            await wait(20);
            calls.push('twitch:end');
        },
        restartYouTubeListener: async () => {
            calls.push('youtube:start');
            await wait(5);
            calls.push('youtube:end');
        },
        restartLivePixListener: async () => {
            calls.push('livepix:start');
            await wait(5);
            calls.push('livepix:end');
        }
    });

    await Promise.all([
        manager.restartPlatform('twitch'),
        manager.restartPlatform('youtube')
    ]);

    assert.deepEqual(calls, [
        'twitch:start',
        'twitch:end',
        'youtube:start',
        'youtube:end'
    ]);
});
