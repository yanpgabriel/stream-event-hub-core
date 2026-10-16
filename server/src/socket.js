'use strict';

const { SESSION_COOKIE, getSessionById, clearExpiredSessions } = require('./auth');
const { listenerStatus, setListenerStatus } = require('./health');
const {
    isTrustedLocalSocket,
    buildTrustedLocalSession,
    isValidLivePixSocketToken,
} = require('./security');
const {
    featureChatMessage,
    featureChatMessageById,
    clearFeaturedChatMessage,
    seedSocketWithChatState,
    removeChatMessages
} = require('./services/chat');
const { moderateTwitchChat } = require('./services/twitch');
const { moderateYouTubeChat } = require('./services/youtube');

let originalLog;
let originalError;
let adminSessionMonitorTimer = null;
const SERVER_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_SESSION_MONITOR_MS = 60 * 1000;

function connectedPayload() {
    return {
        status: 'online',
        instanceId: SERVER_INSTANCE_ID
    };
}

function getSocketSession(socket) {
    if (isTrustedLocalSocket(socket)) {
        return buildTrustedLocalSession();
    }
    const cookieHeader = socket?.handshake?.headers?.cookie || '';
    const cookies = cookieHeader.split(';').reduce((acc, item) => {
        const idx = item.indexOf('=');
        if (idx > 0) {
            acc[item.slice(0, idx).trim()] = decodeURIComponent(item.slice(idx + 1).trim());
        }
        return acc;
    }, {});
    const sid = cookies[SESSION_COOKIE];
    return sid ? getSessionById(sid) : null;
}

function requirePrivilegedSocketSession(socket) {
    const session = getSocketSession(socket);
    if (!session) return null;
    socket.data.session = session;
    return session;
}

function respondUnauthorized(socket, ack) {
    if (typeof ack === 'function') {
        ack({ ok: false, error: 'Unauthorized' });
    }
    if (socket && typeof socket.emit === 'function') {
        socket.emit('unauthorized');
    }
}

function registerChatControlHandlers(socket) {
    socket.on('chat:feature', (payload, ack) => {
        const session = requirePrivilegedSocketSession(socket);
        if (!session) {
            respondUnauthorized(socket, ack);
            return;
        }
        try {
            let featured = null;
            if (payload && typeof payload === 'object' && payload.id) {
                featured = featureChatMessageById(payload.id);
            } else {
                featured = featureChatMessage(payload || {});
            }

            if (typeof ack === 'function') {
                ack(featured ? { ok: true, featured } : { ok: false, error: 'Message not found' });
            }
        } catch (err) {
            if (typeof ack === 'function') {
                ack({ ok: false, error: err?.message || 'Failed to feature message' });
            }
        }
    });

    socket.on('chat:clear-feature', (_payload, ack) => {
        const session = requirePrivilegedSocketSession(socket);
        if (!session) {
            respondUnauthorized(socket, ack);
            return;
        }
        clearFeaturedChatMessage();
        if (typeof ack === 'function') {
            ack({ ok: true });
        }
    });

    socket.on('chat:moderate', async (payload, ack) => {
        const session = requirePrivilegedSocketSession(socket);
        if (!session) {
            respondUnauthorized(socket, ack);
            return;
        }
        try {
            const { action, id, source, userId, chatname } = payload || {};
            if (!action || !source) {
                if (typeof ack === 'function') ack({ ok: false, error: 'Missing action or source' });
                return;
            }
            if (source === 'twitch') {
                if (typeof moderateTwitchChat === 'function') {
                    await moderateTwitchChat({ action, chatname, id });
                } else {
                    throw new Error('Twitch moderation not supported');
                }
            } else if (source === 'youtube') {
                if (typeof moderateYouTubeChat === 'function') {
                    await moderateYouTubeChat({ action, id, userId });
                } else {
                    throw new Error('YouTube moderation not supported');
                }
            } else {
                throw new Error('Unsupported source: ' + source);
            }

            removeChatMessages({ action, id, source, userId, chatname });

            if (typeof ack === 'function') {
                ack({ ok: true });
            }
        } catch (err) {
            console.error('[Socket] chat:moderate error:', err?.message || String(err));
            if (typeof ack === 'function') {
                ack({ ok: false, error: err?.message || 'Failed to moderate: ' + err.message });
            }
        }
    });
}

function startAdminSessionMonitor(io) {
    if (adminSessionMonitorTimer) return;
    adminSessionMonitorTimer = setInterval(() => {
        clearExpiredSessions();
        for (const socket of io.of('/admin').sockets.values()) {
            if (socket?.data?.session?.trustedLocal === true) continue;
            const sid = socket?.data?.session?.sid || '';
            const session = sid ? getSessionById(sid, { touch: false }) : null;
            if (session) {
                socket.data.session = session;
                continue;
            }
            try {
                socket.emit('unauthorized');
                socket.disconnect(true);
            } catch { }
        }
    }, ADMIN_SESSION_MONITOR_MS);
    if (typeof adminSessionMonitorTimer.unref === 'function') {
        adminSessionMonitorTimer.unref();
    }
}

function broadcastLog(io, level, args) {
    const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    io.of('/admin').emit('server-log', { level, message: msg, timestamp: new Date().toISOString() });
}

function setupSocket(io) {
    originalLog = console.log.bind(console);
    originalError = console.error.bind(console);

    console.log = (...args) => {
        originalLog(...args);
        broadcastLog(io, 'info', args);
    };

    console.error = (...args) => {
        originalError(...args);
        broadcastLog(io, 'error', args);
    };

    startAdminSessionMonitor(io);

    io.of('/admin').use((socket, next) => {
        const session = getSocketSession(socket);
        if (!session) return next(new Error('Unauthorized'));
        socket.data.session = session;
        return next();
    });

    io.of('/admin').on('connection', (socket) => {
        console.log('Admin client connected:', socket.id);
        socket.emit('connected', connectedPayload());
        registerChatControlHandlers(socket);
    });

    io.on('connection', (socket) => {
        socket.emit('connected', connectedPayload());
        socket.emit('overlay:state', require('./services/overlay').getStore().snapshot());
        seedSocketWithChatState(socket, { limit: 320 });
        registerChatControlHandlers(socket);

        socket.on('livepix:widget-event', (payload) => {
            try {
                const trustedSocket = isTrustedLocalSocket(socket);
                const socketToken = payload && typeof payload === 'object'
                    ? payload.token || payload.socketToken || payload.authToken || ''
                    : '';
                if (!trustedSocket && !isValidLivePixSocketToken(socketToken)) {
                    return;
                }
                // Lazy require to avoid circular dependency
                const { ingestLivePixWidgetEvent } = require('./services/livepix');
                const result = ingestLivePixWidgetEvent(payload);
                if (!result.ok) return;
                if (listenerStatus.livepix !== 'connected') {
                    setListenerStatus('livepix', 'connected');
                }
            } catch (err) {
                console.error('[LivePix] Widget ingest error:', err?.message || String(err));
            }
        });
    });
}

module.exports = { setupSocket };
