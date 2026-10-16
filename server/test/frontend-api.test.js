'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { fetch, FormData, Blob } = globalThis;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-hub-api-test-'));
process.env.STREAM_HUB_DATA_DIR = dataDir;
process.env.ADMIN_TRUST_LOCAL_NETWORK = 'false';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-only-password';

const express = require('express');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const ctx = require('../src/ctx');
const configModule = require('../src/config');
const chat = require('../src/services/chat');
const { setupSocket } = require('../src/socket');
const { mountFrontend } = require('../src/frontend');

test('frontend API workflows enforce session/CSRF and synchronize stream features', async (t) => {
    const app = express();
    app.use(express.json());
    configModule.loadConfig();
    const server = http.createServer(app);
    const io = new Server(server);
    ctx.io = io;
    ctx.serverReady = true;
    setupSocket(io);
    for (const route of [
        'auth',
        'config',
        'sounds',
        'alerts',
        'sessionMetrics',
        'analytics',
        'chat',
        'health',
        'widget',
        'sorteios',
        'overlay',
        'obs',
    ]) {
        app.use(require(`../src/routes/${route}`));
    }
    mountFrontend(app, path.join(__dirname, 'fixtures/frontend'));
    app.use((err, _req, res, _next) =>
        res
            .status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
            .json({ error: err.message }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    let csrf = '';
    const sockets = [];
    async function request(
        route,
        body,
        method = body ? 'POST' : 'GET',
        includeCsrf = true,
    ) {
        return fetch(url + route, {
            method,
            headers: {
                cookie,
                ...(body && !(body instanceof FormData)
                    ? { 'Content-Type': 'application/json' }
                    : {}),
                ...(includeCsrf ? { 'x-csrf-token': csrf } : {}),
            },
            ...(body
                ? {
                      body:
                          body instanceof FormData
                              ? body
                              : JSON.stringify(body),
                  }
                : {}),
        });
    }
    try {
        await t.test(
            'only minimal readiness and overlay data are public',
            async () => {
                assert.equal((await request('/api/health/ready')).status, 200);
                assert.equal((await request('/api/widget-data')).status, 200);
                assert.equal((await request('/api/overlay/state')).status, 200);
                assert.equal(
                    (await request('/api/overlay/config')).status,
                    401,
                );
                assert.equal((await request('/api/obs/status')).status, 401);
                assert.equal((await request('/api/config')).status, 401);
                assert.equal((await request('/api/chat/state')).status, 401);
                assert.equal(
                    (
                        await request(
                            '/api/overlay/appearance/chat',
                            { revision: 0, patch: {} },
                            'PATCH',
                        )
                    ).status,
                    401,
                );
                const socket = connect(url + '/admin', {
                    reconnection: false,
                    transports: ['websocket'],
                });
                sockets.push(socket);
                const [error] = await once(socket, 'connect_error');
                assert.equal(error.message, 'Unauthorized');
            },
        );
        await t.test(
            'login establishes an HttpOnly session and CSRF guards mutations',
            async () => {
                assert.equal(
                    (
                        await request('/api/auth/login', {
                            username: 'test-admin',
                            password: 'wrong',
                        })
                    ).status,
                    401,
                );
                const login = await request('/api/auth/login', {
                    username: 'test-admin',
                    password: 'test-only-password',
                });
                assert.equal(login.status, 200);
                assert.match(login.headers.get('set-cookie'), /HttpOnly/);
                cookie = login.headers.get('set-cookie').split(';')[0];
                csrf = (await login.json()).csrfToken;
                assert.equal(
                    (
                        await request(
                            '/api/config',
                            { alertDuration: 8 },
                            'POST',
                            false,
                        )
                    ).status,
                    403,
                );
                assert.equal(
                    (
                        await request('/api/config/validate', {
                            alertDuration: 1,
                        })
                    ).status,
                    400,
                );
                assert.equal(
                    (await request('/api/config', { alertDuration: 8 })).status,
                    200,
                );
            },
        );
        await t.test(
            'configuration preserves existing secrets and rejects read-only fields',
            async () => {
                await request('/api/config', {
                    twitchAccessToken: 'test-secret',
                });
                await request('/api/config', {
                    twitchAccessToken: '',
                    alertDuration: 6,
                });
                const cfg = await (await request('/api/config')).json();
                assert.equal(cfg.twitchAccessToken, '');
                assert.equal(cfg.hasSecrets.twitchAccessToken, true);
                assert.equal(
                    configModule.config.twitchAccessToken,
                    'test-secret',
                );
                assert.equal(
                    (await request('/api/config/validate', { hasSecrets: {} }))
                        .status,
                    400,
                );
            },
        );
        await t.test(
            'sandbox is isolated from production/history and arrives over the public socket',
            async () => {
                const socket = connect(url, { transports: ['websocket'] });
                sockets.push(socket);
                await once(socket, 'connect');
                let productionEvents = 0;
                socket.on('event', () => productionEvents++);
                const incoming = once(socket, 'event:sandbox');
                assert.equal(
                    (
                        await request('/api/test-alert', {
                            event: 'tip',
                            name: 'Sandbox',
                            target: 'sandbox',
                        })
                    ).status,
                    200,
                );
                const [payload] = await incoming;
                assert.equal(payload.event.name, 'Sandbox');
                assert.equal(payload.target, 'sandbox');
                assert.equal(productionEvents, 0);
                assert.equal(
                    (await (await request('/api/alert-history')).json()).total,
                    0,
                );
            },
        );
        await t.test(
            'presentation APIs enforce CSRF and publish only explicitly reviewed drafts',
            async () => {
                let config = await (
                    await request('/api/overlay/config')
                ).json();
                assert.equal(
                    (
                        await request(
                            '/api/overlay/config',
                            {
                                revision: config.revision,
                                patch: { theme: { color: '#abcdef' } },
                            },
                            'PATCH',
                            false,
                        )
                    ).status,
                    403,
                );
                const saved = await (
                    await request(
                        '/api/overlay/config',
                        {
                            revision: config.revision,
                            patch: { theme: { color: '#abcdef' } },
                        },
                        'PATCH',
                    )
                ).json();
                assert.equal(
                    (await (await request('/api/overlay/state')).json()).layout
                        .theme.color,
                    '#39ff14',
                );
                assert.equal(
                    (
                        await request('/api/overlay/publish', {
                            revision: saved.revision,
                        })
                    ).status,
                    200,
                );
                assert.equal(
                    (await (await request('/api/overlay/state')).json()).layout
                        .theme.color,
                    '#abcdef',
                );
                config = await (await request('/api/overlay/config')).json();
                const preset = await (
                    await request('/api/overlay/presets', {
                        revision: config.revision,
                        preset: { name: 'Ensaio', scene: '' },
                    })
                ).json();
                assert.ok(preset.id);
                const preview = await (
                    await request('/api/migration/overlays/preview', {
                        config: { themeColor: '#123456', goalCurrent: 12 },
                        obs: {
                            host: 'localhost',
                            port: 4455,
                            password: 'private-obs-value',
                        },
                    })
                ).json();
                assert.ok(
                    !JSON.stringify(preview).includes('private-obs-value'),
                );
                config = await (await request('/api/overlay/config')).json();
                const imported = await (
                    await request('/api/migration/overlays/apply', {
                        token: preview.token,
                        revision: config.revision,
                    })
                ).json();
                assert.ok(imported.backup);
                assert.equal(imported.state.draft.theme.color, '#123456');
                assert.equal(
                    (await (await request('/api/overlay/state')).json()).layout
                        .theme.color,
                    '#abcdef',
                );
                const publicState = JSON.stringify(
                    await (await request('/api/overlay/state')).json(),
                );
                assert.ok(!publicState.includes('private-obs-value'));
                assert.ok(!publicState.includes('twitchAccessToken'));
            },
        );
        await t.test(
            'individual appearance APIs protect drafts and publish only the selected overlay',
            async () => {
                const before = await (
                    await request('/api/overlay/config')
                ).json();
                assert.equal(
                    (
                        await request(
                            '/api/overlay/appearance/chat',
                            { revision: before.revision, patch: {} },
                            'PATCH',
                            false,
                        )
                    ).status,
                    403,
                );
                const saved = await (
                    await request(
                        '/api/overlay/appearance/chat',
                        {
                            revision: before.revision,
                            patch: {
                                accentColor: '#fedcba',
                                backgroundOpacity: 25,
                                maxHeight: 350,
                                useSceneColor: true,
                            },
                        },
                        'PATCH',
                    )
                ).json();
                const staged = await (
                    await request('/api/overlay/state')
                ).json();
                assert.equal(staged.appearances.chat.accentColor, '#bb98eb');
                assert.equal(staged.appearances.chat.maxHeight, 0);
                assert.equal(staged.appearances.draft, undefined);
                assert.equal(
                    (
                        await request(
                            '/api/overlay/appearance/chat/publish',
                            { revision: saved.revision },
                            'POST',
                            false,
                        )
                    ).status,
                    403,
                );
                const response = await request(
                    '/api/overlay/appearance/chat/publish',
                    { revision: saved.revision },
                );
                assert.equal(response.status, 200);
                const after = await (
                    await request('/api/overlay/state')
                ).json();
                assert.equal(after.appearances.chat.accentColor, '#fedcba');
                assert.equal(after.appearances.chat.maxHeight, 350);
                assert.equal(after.appearances.chat.useSceneColor, true);
                assert.equal(after.appearances.widgets.accentColor, '#bb98eb');
                assert.deepEqual(after.layout, staged.layout);
                const config = await (
                    await request('/api/overlay/config')
                ).json();
                assert.deepEqual(config.draft, before.draft);
                assert.deepEqual(config.pendingRuntime, before.pendingRuntime);
                assert.equal(
                    (
                        await request(
                            '/api/overlay/appearance/chat',
                            {
                                revision: config.revision,
                                patch: { backgroundColor: 'url(evil)' },
                            },
                            'PATCH',
                        )
                    ).status,
                    400,
                );
            },
        );
        await t.test(
            'disabled animations retain metrics, while tests and replays do not increment automatic goals',
            async () => {
                await request('/api/session/start', {});
                await request('/api/config', {
                    alertToggles: { cheer: false },
                });
                const alerts = require('../src/alerts');
                alerts.emitAlert(
                    'cheer-latest',
                    { name: 'Apoiador', amount: 100 },
                    { platform: 'twitch' },
                );
                let summary = await (
                    await request('/api/session/summary')
                ).json();
                assert.equal(summary.metrics.twitchBits.total, 100);
                assert.equal(alerts.alertHistory[0].suppressed, true);
                alerts.emitAlert(
                    'cheer-latest',
                    { name: 'Teste', amount: 200 },
                    { platform: 'twitch', origin: 'test' },
                );
                alerts.emitAlert(
                    'cheer-latest',
                    { name: 'Replay', amount: 300 },
                    { platform: 'replay', replay: true },
                );
                summary = await (await request('/api/session/summary')).json();
                assert.equal(summary.metrics.twitchBits.total, 100);
            },
        );
        await t.test(
            'chat, feature, raffle and moderation removal share consistent state',
            async () => {
                await request('/api/sorteios/start', { keyword: '!sorteio' });
                const { message } = await (
                    await request('/api/chat/test', {
                        chatname: 'Teste',
                        message: '!sorteio participando',
                    })
                ).json();
                await request('/api/chat/feature', { id: message.id });
                assert.equal(
                    (await (await request('/api/chat/state')).json()).featured
                        .id,
                    message.id,
                );
                const raffle = await (
                    await request('/api/sorteios/state')
                ).json();
                assert.equal(raffle.state.participants.length, 1);
                const draw = await (
                    await request('/api/sorteios/draw', {})
                ).json();
                assert.equal(draw.winner.name, 'Teste');
                const ids = chat.removeChatMessages({
                    action: 'delete',
                    id: message.id,
                    source: 'manual',
                });
                assert.deepEqual(ids, [message.id]);
                const state = await (await request('/api/chat/state')).json();
                assert.equal(state.featured, null);
                assert.equal(state.recent.length, 0);
                await request('/api/sorteios/clear', {});
                assert.equal(
                    (await (await request('/api/sorteios/draw', {})).json())
                        .winner,
                    null,
                );
            },
        );
        await t.test(
            'audio upload, reference protection, rename and delete are usable from the UI',
            async () => {
                const form = new FormData();
                form.append(
                    'sound',
                    new Blob(['test-audio'], { type: 'audio/wav' }),
                    'test.wav',
                );
                const upload = await request('/api/sounds/upload', form);
                assert.equal(upload.status, 200);
                const sound = await upload.json();
                await request('/api/config', {
                    alertSounds: { follow: { url: sound.url, volume: 80 } },
                });
                assert.equal(
                    (
                        await request(
                            `/api/sounds/${sound.filename}`,
                            null,
                            'DELETE',
                        )
                    ).status,
                    409,
                );
                await request('/api/config', {
                    alertSounds: { follow: { url: '', volume: 80 } },
                });
                const rename = await request(
                    `/api/sounds/${sound.filename}`,
                    { newName: 'renamed' },
                    'PATCH',
                );
                assert.equal(rename.status, 200);
                assert.equal(
                    (await request('/api/sounds/renamed.wav', null, 'DELETE'))
                        .status,
                    200,
                );
                const invalid = new FormData();
                invalid.append(
                    'sound',
                    new Blob(['html'], { type: 'audio/wav' }),
                    'payload.html',
                );
                assert.equal(
                    (await request('/api/sounds/upload', invalid)).status,
                    400,
                );
            },
        );
        await t.test(
            'metrics session controls, exports and frontend deep links retain their contracts',
            async () => {
                await request('/api/session/start', {});
                assert.equal(
                    (await (await request('/api/session/summary')).json())
                        .session.isActive,
                    true,
                );
                await request('/api/session/end', {});
                assert.equal(
                    (await (await request('/api/session/summary')).json())
                        .session.isActive,
                    false,
                );
                assert.equal(
                    (
                        await request(
                            '/api/analytics/overview?period=day&tzOffsetMin=-180',
                        )
                    ).status,
                    200,
                );
                assert.match(
                    (
                        await request('/api/alert-history/export?format=csv')
                    ).headers.get('content-type'),
                    /text\/csv/,
                );
                for (const route of [
                    '/',
                    '/admin',
                    '/admin/chat',
                    '/login',
                    '/overlays/alertas',
                    '/overlays/cena',
                    '/admin/dock',
                ]) {
                    const response = await request(route);
                    assert.equal(response.status, 200);
                    assert.match(
                        await response.text(),
                        /Stream Hub frontend fixture/,
                    );
                }
                const missing = await request('/api/nonexistent');
                assert.equal(missing.status, 404);
                assert.match(
                    missing.headers.get('content-type'),
                    /application\/json/,
                );
                await request('/api/auth/logout', {});
                assert.equal((await request('/api/config')).status, 401);
            },
        );
    } finally {
        for (const socket of sockets) socket.disconnect();
        await new Promise((resolve) => io.close(resolve));
        ctx.io = null;
        // This is an exact mkdtemp-created, test-only directory, never runtime user data.
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
