'use strict';

const ctx = {
    io: null,
    server: null,
    app: null,
    serverReady: false,
    restartTimer: null,
    restartListeners: null,
    restartTwitchListener: null,
    restartYouTubeListener: null,
    restartLivePixListener: null,
    listenerManager: null,
    shuttingDown: false,
};

module.exports = ctx;
