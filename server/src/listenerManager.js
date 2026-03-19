'use strict';

const ctx = require('./ctx');

function createListenerManager(handlers = {}) {
    const restartHandlers = {
        twitch: handlers.restartTwitchListener,
        youtube: handlers.restartYouTubeListener,
        livepix: handlers.restartLivePixListener
    };
    const stopHandlers = {
        twitch: handlers.stopTwitchListener || handlers.restartTwitchListener,
        youtube: handlers.stopYouTubeListener || handlers.restartYouTubeListener,
        livepix: handlers.stopLivePixListener || handlers.restartLivePixListener
    };

    let queue = Promise.resolve();
    let shuttingDown = false;

    const runSerial = (label, task) => {
        const wrapped = queue.then(async () => {
            if (shuttingDown && label !== 'shutdown') return null;
            return task();
        });
        queue = wrapped.catch((err) => {
            console.error(`[Listeners] ${label} failed:`, err?.message || String(err));
            throw err;
        }).catch(() => null);
        return wrapped;
    };

    const restartPlatform = async (platform, options = {}) => {
        if (!restartHandlers[platform]) {
            throw new Error(`Unknown platform: ${platform}`);
        }
        return runSerial(`restart:${platform}`, async () => {
            await restartHandlers[platform](options);
            return { ok: true, platform };
        });
    };

    const restartAll = async (options = {}) => runSerial('restart:all', async () => {
        await restartHandlers.twitch?.(options);
        await restartHandlers.youtube?.(options);
        await restartHandlers.livepix?.(options);
        return { ok: true };
    });

    const shutdown = async () => {
        shuttingDown = true;
        if (ctx.restartTimer) {
            clearTimeout(ctx.restartTimer);
            ctx.restartTimer = null;
        }
        return runSerial('shutdown', async () => {
            await stopHandlers.twitch?.({ stopOnly: true });
            await stopHandlers.youtube?.({ stopOnly: true });
            await stopHandlers.livepix?.({ stopOnly: true });
            return { ok: true };
        });
    };

    return {
        restartAll,
        restartPlatform,
        shutdown,
        isShuttingDown: () => shuttingDown
    };
}

module.exports = { createListenerManager };
