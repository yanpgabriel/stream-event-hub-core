'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');

test('late youtube-chat errors stay handled after listener stop', async () => {
    const createdListeners = [];
    const originalLoad = Module._load;
    const youtubeServicePath = require.resolve('../src/services/youtube');
    const { config } = require('../src/config');
    const { listenerStatus } = require('../src/health');
    const previousConfig = {
        youtubeLiveId: config.youtubeLiveId,
        youtubeChannelId: config.youtubeChannelId,
        googleClientId: config.googleClientId,
        googleClientSecret: config.googleClientSecret,
        youtubeAccessToken: config.youtubeAccessToken
    };

    class FakeLiveChat extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            createdListeners.push(this);
        }

        async start() {
            return false;
        }

        stop(reason) {
            this.emit('end', reason);
        }
    }

    Module._load = function mockLoad(request, parent, isMain) {
        if (request === 'youtube-chat') {
            return { LiveChat: FakeLiveChat };
        }
        if (request === 'youtube-chat/dist/requests') {
            return {
                fetchLivePage: async () => {
                    throw new Error('not used in this test');
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[youtubeServicePath];

    Object.assign(config, {
        youtubeLiveId: 'test-live-id',
        youtubeChannelId: '',
        googleClientId: '',
        googleClientSecret: '',
        youtubeAccessToken: ''
    });

    try {
        const youtubeService = require('../src/services/youtube');

        await youtubeService.startYouTubeListener();
        assert.equal(createdListeners.length, 1);

        await youtubeService.stopYouTubeListener();
        assert.equal(listenerStatus.youtube, 'disconnected');

        assert.doesNotThrow(() => {
            createdListeners[0].emit('error', new Error('late youtube-chat failure'));
        });
        assert.equal(listenerStatus.youtube, 'disconnected');
    } finally {
        Object.assign(config, previousConfig);
        Module._load = originalLoad;
        delete require.cache[youtubeServicePath];
    }
});
