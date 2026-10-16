'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-hub-overlay-test-'));
process.env.STREAM_HUB_DATA_DIR = root;
const { cameraGeometry } = require('../../shared/presentation.mjs');
const {
    createOverlayStore,
    validateLayout,
} = require('../src/services/overlay');
const { createObsManager } = require('../src/services/obs');
const {
    convertLegacy,
    createMigrationService,
} = require('../src/services/overlayMigration');
let index = 0;
function directory() {
    const dir = path.join(root, String(index++));
    fs.mkdirSync(dir);
    return dir;
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('drafts, live controls and presets do not change unrelated presentation state', () => {
    const dir = directory();
    let metrics = { twitchSubs: { total: 7 } };
    const store = createOverlayStore({
        directory: dir,
        metrics: () => metrics,
    });
    store.draft(
        { theme: { color: '#aa66ff' }, goal: { mode: 'twitchSubs' } },
        0,
    );
    assert.equal(store.snapshot().layout.theme.color, '#39ff14');
    assert.throws(() => store.publish(0), { status: 409 });
    store.publish(1);
    assert.equal(store.snapshot().layout.theme.color, '#aa66ff');
    assert.equal(store.snapshot().currentGoal, 7);
    store.runtime({ goalCurrent: 3, timer: 'start' });
    const timer = store.admin().runtime.timerStartedAt;
    const first = store.savePreset(
        { name: 'Cena A', scene: 'Live' },
        store.admin().revision,
    );
    store.draft({ theme: { color: '#ff0000' } }, store.admin().revision);
    const duplicate = store.savePreset(
        { name: 'Cópia', copyFrom: first.id },
        store.admin().revision,
    );
    assert.equal(duplicate.layout.theme.color, '#aa66ff');
    store.loadPreset(first.id, store.admin().revision);
    store.publish(store.admin().revision);
    assert.equal(store.admin().runtime.timerStartedAt, timer);
    assert.equal(store.snapshot().currentGoal, 10);
    store.draft({ message: { text: 'Rascunho' } }, store.admin().revision);
    store.live({ chat: { enabled: false } }, store.admin().revision);
    assert.equal(store.admin().draft.message.text, 'Rascunho');
    assert.equal(store.snapshot().layout.chat.enabled, false);
    metrics = { twitchSubs: { total: 8 } };
    assert.equal(store.snapshot().currentGoal, 11);
    const loaded = createOverlayStore({ directory: dir });
    assert.equal(loaded.admin().published.theme.color, '#aa66ff');
    const backup = store.backup();
    store.live({ theme: { color: '#000000' } }, store.admin().revision);
    store.restore(backup, store.admin().revision);
    assert.equal(store.snapshot().layout.theme.color, '#aa66ff');
});

test('layout validation rejects unknown fields, invalid QR/text and out-of-canvas webcam geometry', () => {
    assert.throws(
        () => validateLayout({ password: { value: 'secret' } }),
        /Grupo inválido/,
    );
    assert.throws(
        () => validateLayout(JSON.parse('{"theme":{"__proto__":{}}}')),
        /Campo desconhecido/,
    );
    assert.throws(() => validateLayout({ webcam: { width: 9000 } }), /webcam/);
    assert.throws(
        () => validateLayout({ theme: { color: 'url(fake)' } }),
        /hexadecimal/,
    );
    assert.throws(() => validateLayout({ goal: { target: 0 } }), /meta/);
    assert.throws(
        () => validateLayout({ webcam: { showLabel: 'false' } }),
        /inválido/,
    );
    assert.throws(
        () => validateLayout({ chat: { mode: 'external' } }),
        /Opção inválida/,
    );
    assert.throws(
        () => validateLayout({ chat: { overlayWidth: 0 } }),
        /overlay de chat/,
    );
    assert.throws(
        () => validateLayout({ chat: { overlayHeight: 2161 } }),
        /overlay de chat/,
    );
    assert.throws(
        () => validateLayout({ message: { effect: 'html' } }),
        /Opção inválida/,
    );
    assert.throws(
        () => validateLayout({ qr: { text: 'x'.repeat(2001) } }),
        /longo/,
    );
    for (const corner of [
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
    ]) {
        const layout = validateLayout({ webcam: { corner } });
        const original = cameraGeometry(layout);
        const scaled = cameraGeometry(layout, 1280, 720);
        assert.ok(
            Math.abs(scaled.inner.x - (original.inner.x * 1280) / 1920) < 1e-8,
        );
        assert.ok(
            Math.abs(scaled.inner.width - ((380 - 6) * 1280) / 1920) < 1e-8,
        );
        assert.ok(original.outer.x >= 0 && original.outer.y >= 0);
    }
});

test('each individual appearance is staged, published and persisted independently of the scene', () => {
    const dir = directory();
    const notifications = [];
    const store = createOverlayStore({
        directory: dir,
        notify: (value) => notifications.push(value),
    });
    store.draft({ theme: { color: '#ff0000' } }, 0);
    for (const kind of ['alertas', 'chat', 'destaque', 'widgets', 'sorteio']) {
        const initial = store.snapshot().appearances[kind].accentColor;
        store.appearanceDraft(
            kind,
            {
                accentColor: '#123456',
                textSize: 27,
                backgroundOpacity: 0,
                position: 'top-right',
                maxHeight: 420,
            },
            store.admin().revision,
        );
        assert.equal(store.snapshot().appearances[kind].accentColor, initial);
        assert.equal(
            notifications.at(-1).appearances[kind].accentColor,
            initial,
        );
        const revision = store.admin().revision;
        assert.throws(() => store.appearancePublish(kind, revision - 1), {
            status: 409,
        });
        store.appearancePublish(kind, revision);
        assert.equal(store.snapshot().appearances[kind].accentColor, '#123456');
        assert.equal(store.snapshot().appearances[kind].backgroundOpacity, 0);
        assert.equal(store.snapshot().appearances[kind].maxHeight, 420);
        assert.equal(store.snapshot().layout.theme.color, '#39ff14');
        assert.equal(store.admin().draft.theme.color, '#ff0000');
    }
    const persisted = createOverlayStore({ directory: dir });
    assert.equal(persisted.snapshot().appearances.chat.textSize, 27);
    assert.equal(persisted.snapshot().appearances.chat.maxHeight, 420);
    const before = store.backup();
    store.appearanceDraft(
        'chat',
        { useSceneColor: true },
        store.admin().revision,
    );
    store.appearancePublish('chat', store.admin().revision);
    assert.equal(store.snapshot().appearances.alertas.useSceneColor, false);
    store.restore(before, store.admin().revision);
    assert.equal(store.snapshot().appearances.chat.useSceneColor, false);
});

test('appearance validation rejects CSS injection, unknown keys, invalid measures and kinds without changing state', () => {
    const store = createOverlayStore({ directory: directory() });
    for (const patch of [
        { accentColor: 'red; display:none' },
        { font: 'url(https://external.test)' },
        { position: 'fixed' },
        { animation: 'evil' },
        { textAlign: 'justify' },
        { backgroundOpacity: 101 },
        { titleSize: 0 },
        { textSize: 7 },
        { margin: -1 },
        { padding: 1.5 },
        { maxWidth: Infinity },
        { maxHeight: -1 },
        { maxHeight: 2161 },
        { maxHeight: 12.5 },
        { maxHeight: '200' },
        { glow: 'yes' },
        JSON.parse('{"__proto__": {"test": true}}'),
    ])
        assert.throws(() => store.appearanceDraft('chat', patch, 0));
    assert.throws(() => store.appearanceDraft('unknown', {}, 0));
    assert.throws(() => store.appearancePublish('__proto__', 0));
    assert.equal(store.admin().revision, 0);
});

test('pre-customization stores and backups get defaults without losing existing scene or runtime', () => {
    const dir = directory();
    const first = createOverlayStore({ directory: dir });
    first.runtime({ goalCurrent: 17 });
    const old = first.admin();
    delete old.appearances;
    fs.writeFileSync(path.join(dir, 'overlay-store.json'), JSON.stringify(old));
    const loaded = createOverlayStore({ directory: dir });
    assert.equal(loaded.snapshot().runtime.goalCurrent, 17);
    assert.equal(loaded.snapshot().appearances.chat.titleSize, 14);
    assert.equal(
        loaded.admin().appearances.draft.widgets.backgroundOpacity,
        90,
    );
    const backup = loaded.backup();
    fs.writeFileSync(
        path.join(dir, 'overlay-backups', backup),
        JSON.stringify(old),
    );
    loaded.restore(backup, loaded.admin().revision);
    assert.equal(loaded.snapshot().appearances.alertas.accentColor, '#bb98eb');
    assert.equal(loaded.snapshot().runtime.goalCurrent, 17);
});
test('older appearance records and backups receive automatic height without losing custom values', () => {
    const dir = directory();
    const store = createOverlayStore({ directory: dir });
    store.appearanceDraft(
        'chat',
        { maxWidth: 400, maxHeight: 300, accentColor: '#112233' },
        0,
    );
    store.appearancePublish('chat', store.admin().revision);
    const old = store.admin();
    for (const phase of ['draft', 'published'])
        for (const appearance of Object.values(old.appearances[phase]))
            delete appearance.maxHeight;
    fs.writeFileSync(path.join(dir, 'overlay-store.json'), JSON.stringify(old));
    const loaded = createOverlayStore({ directory: dir });
    assert.equal(loaded.admin().appearances.draft.chat.maxHeight, 0);
    assert.equal(loaded.snapshot().appearances.chat.maxHeight, 0);
    assert.equal(loaded.snapshot().appearances.chat.maxWidth, 400);
    assert.equal(loaded.snapshot().appearances.chat.accentColor, '#112233');
    const backup = loaded.backup();
    fs.writeFileSync(
        path.join(dir, 'overlay-backups', backup),
        JSON.stringify(old),
    );
    loaded.appearanceDraft('chat', { maxHeight: 500 }, loaded.admin().revision);
    loaded.appearancePublish('chat', loaded.admin().revision);
    loaded.restore(backup, loaded.admin().revision);
    assert.equal(loaded.snapshot().appearances.chat.maxHeight, 0);
    assert.equal(loaded.snapshot().appearances.chat.maxWidth, 400);
});
test('webcam caption and embedded chat are staged, preserved by presets and normalized in older stores/backups', () => {
    const dir = directory();
    const first = createOverlayStore({ directory: dir });
    first.draft(
        {
            webcam: { showLabel: false },
            chat: { mode: 'overlay', overlayWidth: 500, overlayHeight: 650 },
        },
        0,
    );
    assert.equal(first.snapshot().layout.webcam.showLabel, true);
    assert.equal(first.snapshot().layout.chat.mode, 'native');
    const preset = first.savePreset(
        { name: 'Chat overlay' },
        first.admin().revision,
    );
    first.publish(first.admin().revision);
    assert.equal(first.snapshot().layout.webcam.showLabel, false);
    assert.equal(first.snapshot().layout.webcam.label, 'LIVE ONLINE');
    assert.equal(first.snapshot().layout.chat.mode, 'overlay');
    first.draft(
        { webcam: { showLabel: true }, chat: { mode: 'native' } },
        first.admin().revision,
    );
    first.loadPreset(preset.id, first.admin().revision);
    assert.equal(first.admin().draft.chat.overlayWidth, 500);
    assert.equal(first.admin().draft.webcam.showLabel, false);
    const old = first.admin();
    for (const layout of [
        old.draft,
        old.published,
        ...old.presets.map((p) => p.layout),
    ]) {
        delete layout.webcam.showLabel;
        delete layout.chat.mode;
        delete layout.chat.overlayWidth;
        delete layout.chat.overlayHeight;
    }
    fs.writeFileSync(path.join(dir, 'overlay-store.json'), JSON.stringify(old));
    const loaded = createOverlayStore({ directory: dir });
    assert.equal(loaded.snapshot().layout.webcam.showLabel, true);
    assert.equal(loaded.snapshot().layout.chat.mode, 'native');
    assert.equal(loaded.admin().presets[0].layout.chat.overlayWidth, 450);
    assert.equal(loaded.admin().presets[0].layout.chat.overlayHeight, 540);
    loaded.draft({ chat: { mode: 'overlay' } }, loaded.admin().revision);
    loaded.publish(loaded.admin().revision);
    assert.equal(loaded.snapshot().layout.chat.overlayWidth, 450);
    const backup = loaded.backup();
    fs.writeFileSync(
        path.join(dir, 'overlay-backups', backup),
        JSON.stringify(old),
    );
    loaded.restore(backup, loaded.admin().revision);
    assert.equal(loaded.snapshot().layout.chat.mode, 'native');
    assert.equal(loaded.snapshot().layout.webcam.showLabel, true);
});

test('legacy import is session-bound, redacts credentials and stages runtime until publication', async () => {
    const dir = directory();
    const store = createOverlayStore({ directory: dir });
    let config = null;
    const obs = {
        backup: () => ({ settings: { host: 'previous' }, password: 'before' }),
        configure: async (value) => {
            config = value;
        },
        restoreBackup: async () => {},
        syncCamera: async () => {},
    };
    const migration = createMigrationService({ directory: dir, store, obs });
    const input = {
        config: {
            webcamPos: 'top-left',
            themeColor: '#123456',
            goalCurrent: 42,
            goalTarget: 50,
            liveSince: 1000,
            screenMessageEffect: 'pulse',
        },
        presets: {
            Wrapper: { config: { themeColor: '#abcdef' }, obsScene: 'Live' },
            Legacy: { themeColor: '#fedcba' },
        },
        obs: {
            host: 'localhost',
            port: 4455,
            password: 'never-publish-this',
            overlayScene: 'Live',
            webcamSource: 'Camera',
        },
        html: '<span>Instagram</span><span>@meucanal</span>',
    };
    const preview = migration.preview(input, 'session-one');
    assert.ok(!JSON.stringify(preview).includes('never-publish-this'));
    assert.equal(preview.layout.topbar.socialValue, '@meucanal');
    await assert.rejects(
        migration.apply({ token: preview.token, revision: 0 }, 'session-two'),
        { status: 409 },
    );
    const result = await migration.apply(
        { token: preview.token, revision: 0, includeObs: true },
        'session-one',
    );
    assert.equal(store.admin().draft.webcam.corner, 'top-left');
    assert.equal(store.admin().published.webcam.corner, 'bottom-right');
    assert.equal(store.admin().runtime.goalCurrent, 0);
    assert.equal(store.admin().runtime.timerStartedAt, null);
    assert.equal(store.admin().presets.length, 2);
    assert.equal(config.manageWebcam, false);
    assert.equal(config.enabled, false);
    assert.equal(config.password, 'never-publish-this');
    store.publish(store.admin().revision);
    assert.equal(store.snapshot().currentGoal, 42);
    await migration.restore({
        backup: result.backup,
        revision: store.admin().revision,
    });
    assert.equal(store.snapshot().layout.theme.color, '#39ff14');
    assert.throws(
        () => convertLegacy({ config: { themeColor: 'invalid' } }),
        /hexadecimal/,
    );
    await assert.rejects(
        migration.apply(
            { token: preview.token, revision: store.admin().revision },
            'session-one',
        ),
        { status: 409 },
    );
});

class FakeObs extends EventEmitter {
    constructor() {
        super();
        this.calls = [];
    }
    async connect() {
        return {};
    }
    async disconnect() {
        this.emit('ConnectionClosed');
    }
    async call(type, data) {
        this.calls.push({ type, data });
        switch (type) {
            case 'GetSceneList':
                return {
                    scenes: [{ sceneName: 'Live' }, { sceneName: 'BRB' }],
                    currentProgramSceneName: 'Live',
                };
            case 'GetSceneItemList':
                return {
                    sceneItems: [
                        {
                            sceneItemId: 2,
                            sourceName: 'Camera',
                            sceneItemEnabled: true,
                        },
                    ],
                };
            case 'GetSceneItemTransform':
                return {
                    sceneItemTransform: {
                        positionX: 200,
                        positionY: 100,
                        boundsType: 'OBS_BOUNDS_NONE',
                    },
                };
            case 'GetSceneItemEnabled':
                return { sceneItemEnabled: true };
            case 'GetVideoSettings':
                return { baseWidth: 1920, baseHeight: 1080 };
            default:
                return {};
        }
    }
}
test('OBS manages only the selected item, restores originals and never exposes its password', async () => {
    const dir = directory();
    const rpc = new FakeObs();
    let secret = '';
    const manager = createObsManager({
        directory: dir,
        clientFactory: () => rpc,
        password: () => secret,
        savePassword: (value) => {
            secret = value;
        },
        layout: () => validateLayout({ webcam: { corner: 'top-left' } }),
    });
    await manager.configure({
        host: 'localhost',
        port: 4455,
        password: 'private-password',
        scene: 'Live',
        source: 'Camera',
        itemId: 2,
        manageWebcam: true,
    });
    assert.ok(!JSON.stringify(manager.status()).includes('private-password'));
    await manager.connect();
    assert.equal(manager.status().connected, true);
    const transform = rpc.calls.find((c) => c.type === 'SetSceneItemTransform');
    assert.equal(transform.data.sceneName, 'Live');
    assert.equal(transform.data.sceneItemId, 2);
    assert.equal(transform.data.sceneItemTransform.positionX, 63);
    assert.equal(transform.data.sceneItemTransform.positionY, 83);
    assert.equal(transform.data.sceneItemTransform.boundsWidth, 374);
    await manager.switchScene('BRB');
    assert.equal(manager.status().currentScene, 'BRB');
    await assert.rejects(manager.switchScene('Missing'), { status: 404 });
    await manager.restoreCamera();
    assert.equal(manager.status().config.manageWebcam, false);
    assert.equal(
        rpc.calls.filter((c) => c.type === 'SetSceneItemTransform').at(-1).data
            .sceneItemTransform.positionX,
        200,
    );
    await manager.shutdown();
    assert.equal(manager.status().connected, false);
});

test('OBS connection failures do not queue scene switches or block configuration access', async () => {
    const rpc = new FakeObs();
    rpc.connect = async () => {
        throw new Error('offline');
    };
    const manager = createObsManager({
        directory: directory(),
        clientFactory: () => rpc,
        password: () => '',
        savePassword: () => {},
    });
    await assert.rejects(manager.connect(), { status: 502 });
    assert.equal(manager.status().connected, false);
    await assert.rejects(manager.switchScene('Live'));
    assert.ok(!rpc.calls.some((c) => c.type === 'SetCurrentProgramScene'));
    await manager.shutdown();
});
