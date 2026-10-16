'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const ctx = require('./ctx');
const configModule = require('./config');
const { ADMIN_USERNAME, ADMIN_PASSWORD } = require('./auth');
const {
    TRUST_PROXY,
    socketCorsOrigin,
    ADMIN_TRUST_LOCAL_NETWORK,
} = require('./security');
const alerts = require('./alerts');
const sessionMetrics = require('./sessionMetrics');
const { createListenerManager } = require('./listenerManager');

async function bootstrap() {
    configModule.loadConfig();
    alerts.loadAlertHistory();
    sessionMetrics.loadSessionMetricsStore({ seedHistory: alerts.alertHistory });

    const PORT = process.env.PORT || 3232;
    const app = express();
    if (TRUST_PROXY) {
        app.set('trust proxy', true);
    }
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: {
            origin: socketCorsOrigin,
            credentials: true
        }
    });

    ctx.io = io;
    ctx.server = server;
    ctx.app = app;

    const { setupSocket } = require('./socket');
    setupSocket(io);

    app.use(express.json({limit:'512kb'}));
    app.use(express.urlencoded({ extended: true }));

    app.use('/sounds', express.static(configModule.SOUNDS_DIR));

    app.use(require('./routes/auth'));
    app.use(require('./routes/config'));
    app.use(require('./routes/sounds'));
    app.use(require('./routes/alerts'));
    app.use(require('./routes/sessionMetrics'));
    app.use(require('./routes/analytics'));
    app.use(require('./routes/chat'));
    app.use(require('./routes/health'));
    app.use(require('./routes/twitch-auth'));
    app.use(require('./routes/youtube-auth'));
    app.use(require('./routes/livepix'));
    app.use(require('./routes/widget'));
    app.use(require('./routes/sorteios'));
    app.use(require('./routes/overlay'));
    app.use(require('./routes/obs'));
    require('./frontend').mountFrontend(app);

    // Upload/JSON failures must retain an API error contract for the UI.
    app.use((err, req, res, next) => {
        if (!req.path.startsWith('/api/')) return next(err);
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 400);
        return res.status(status).json({ error: err.message || 'Request failed' });
    });

    const {
        restartTwitchListener,
        stopTwitchListener
    } = require('./services/twitch');
    const {
        restartYouTubeListener,
        stopYouTubeListener
    } = require('./services/youtube');
    const {
        restartLivePixListener,
        stopLivePixListener
    } = require('./services/livepix');

    const listenerManager = createListenerManager({
        restartTwitchListener,
        stopTwitchListener,
        restartYouTubeListener,
        stopYouTubeListener,
        restartLivePixListener,
        stopLivePixListener
    });

    async function restartListeners() {
        console.log('Restarting listeners with new config...');
        return listenerManager.restartAll();
    }

    ctx.listenerManager = listenerManager;
    ctx.restartListeners = restartListeners;
    ctx.restartTwitchListener = (options) => listenerManager.restartPlatform('twitch', options);
    ctx.restartYouTubeListener = (options) => listenerManager.restartPlatform('youtube', options);
    ctx.restartLivePixListener = (options) => listenerManager.restartPlatform('livepix', options);

    function logStartupBanner() {
        console.log(`Stream Event Hub Core running on http://localhost:${PORT}`);
        console.log(` - API root: http://localhost:${PORT}/`);
        console.log(` - Ready check: http://localhost:${PORT}/api/health/ready`);
        if (ADMIN_TRUST_LOCAL_NETWORK) {
            console.log('[SECURITY] Local network trust mode is enabled for protected routes and admin socket.');
        } else if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
            console.log('[SECURITY] Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env');
        }
    }

    async function shutdown(signal) {
        if (ctx.shuttingDown) return;
        ctx.shuttingDown = true;
        console.log(`[Runtime] Shutdown requested (${signal})`);
        try {
            await listenerManager.shutdown();
            await require('./services/obs').getObs().shutdown();
        } catch (err) {
            console.error('[Runtime] Listener shutdown failed:', err?.message || String(err));
        }
        server.close((err) => {
            if (err) {
                console.error('[Runtime] Server close failed:', err?.message || String(err));
                process.exitCode = 1;
            }
            process.exit();
        });
        setTimeout(() => {
            console.error('[Runtime] Forced shutdown after timeout');
            process.exit(1);
        }, 10000).unref();
    }

    process.on('SIGINT', () => {
        shutdown('SIGINT').catch((err) => {
            console.error('[Runtime] SIGINT shutdown failed:', err?.message || String(err));
            process.exit(1);
        });
    });
    process.on('SIGTERM', () => {
        shutdown('SIGTERM').catch((err) => {
            console.error('[Runtime] SIGTERM shutdown failed:', err?.message || String(err));
            process.exit(1);
        });
    });

    await restartListeners();
    await require('./services/obs').getObs().start();
    await new Promise((resolve) => {
        server.listen(PORT, () => {
            ctx.serverReady = true;
            logStartupBanner();
            resolve();
        });
    });

    return { app, server, io };
}

module.exports = { bootstrap };
