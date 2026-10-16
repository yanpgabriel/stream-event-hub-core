'use strict';

const fs = require('fs');
const path = require('path');
const { OBSWebSocket } = require('obs-websocket-js');
const configModule = require('../config');
const { cameraGeometry } = require('../../../shared/presentation.mjs');
const { fail } = require('./overlay');
const DEFAULTS = {
    host: '127.0.0.1',
    port: 4455,
    protocol: 'ws',
    scene: '',
    source: '',
    itemId: null,
    manageWebcam: false,
    enabled: false,
};

function validateObs(input, base = DEFAULTS) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw fail('Configuração OBS inválida.');
    for (const key of Object.keys(input))
        if (!Object.hasOwn(DEFAULTS, key) && key !== 'password')
            throw fail(`Campo OBS desconhecido: ${key}`);
    const next = { ...base };
    for (const key of Object.keys(DEFAULTS))
        if (key in input) next[key] = input[key];
    if (
        typeof next.host !== 'string' ||
        !next.host ||
        next.host.length > 253 ||
        !/^[a-zA-Z0-9._:[\]-]+$/.test(next.host)
    )
        throw fail('Informe somente o nome ou IP da máquina do OBS.');
    if (
        !Number.isInteger(next.port) ||
        next.port < 1 ||
        next.port > 65535 ||
        !['ws', 'wss'].includes(next.protocol)
    )
        throw fail('Porta/protocolo OBS inválidos.');
    if (
        typeof next.enabled !== 'boolean' ||
        typeof next.manageWebcam !== 'boolean' ||
        typeof next.scene !== 'string' ||
        typeof next.source !== 'string' ||
        next.scene.length > 150 ||
        next.source.length > 150
    )
        throw fail('Cena, fonte ou opções OBS inválidas.');
    if (
        next.itemId !== null &&
        (!Number.isInteger(next.itemId) || next.itemId < 0)
    )
        throw fail('ID do item OBS inválido.');
    if (
        'password' in input &&
        (typeof input.password !== 'string' || input.password.length > 500)
    )
        throw fail('Senha OBS inválida.');
    return next;
}

function createObsManager({
    directory = configModule.DATA_DIR,
    clientFactory = () => new OBSWebSocket(),
    password = () => configModule.config.obsPassword || '',
    savePassword = (value) =>
        configModule.applyConfigPatch(
            { obsPassword: value },
            { triggerRestart: false },
        ),
    layout = () => require('./overlay').getStore().snapshot().layout,
    emit = () => {},
} = {}) {
    const file = path.join(directory, 'obs-settings.json');
    const originalFile = path.join(directory, 'obs-original-transforms.json');
    let settings = fs.existsSync(file)
        ? validateObs(JSON.parse(fs.readFileSync(file, 'utf8')))
        : { ...DEFAULTS };
    let originals = fs.existsSync(originalFile)
        ? JSON.parse(fs.readFileSync(originalFile, 'utf8'))
        : {};
    let client = null;
    let connected = false;
    let desired = false;
    let timer = null;
    let lastError = '';
    let scenes = [];
    let currentScene = '';
    let generation = 0;
    let queue = Promise.resolve();
    let retryDelay = 1000;
    const status = () => ({
        connected,
        status: connected
            ? 'connected'
            : desired
              ? 'reconnecting'
              : 'disconnected',
        lastError,
        scenes: [...scenes],
        currentScene,
        config: { ...settings, passwordConfigured: !!password() },
        canRestore: !!Object.keys(originals).length,
    });
    const notify = () => emit(status());
    const persist = () => {
        fs.mkdirSync(directory, { recursive: true });
        configModule.writeFileAtomic(file, JSON.stringify(settings, null, 2));
    };
    const serial = (task) => {
        const next = queue.then(task);
        queue = next.catch(() => {});
        return next;
    };
    function needClient() {
        if (!connected || !client)
            throw fail(
                'OBS desconectado. Conecte antes de executar esta ação.',
                409,
            );
        return client;
    }
    async function request(type, data, rpc = needClient()) {
        const run = generation;
        if (rpc !== needClient())
            throw fail('A conexão OBS mudou. Repita a ação.', 409);
        let timeout;
        try {
            const result = await Promise.race([
                rpc.call(type, data),
                new Promise((_, reject) => {
                    timeout = setTimeout(
                        () =>
                            reject(
                                fail(
                                    `OBS não respondeu a ${type} a tempo.`,
                                    504,
                                ),
                            ),
                        6000,
                    );
                }),
            ]);
            if (run !== generation || rpc !== client || !connected)
                throw fail('A conexão OBS mudou. Repita a ação.', 409);
            return result;
        } finally {
            clearTimeout(timeout);
        }
    }
    async function refresh() {
        const data = await request('GetSceneList');
        scenes = data.scenes.map((item) => item.sceneName);
        currentScene = data.currentProgramSceneName || '';
        notify();
        return status();
    }
    async function items(scene) {
        if (typeof scene !== 'string' || !scenes.includes(scene))
            throw fail('Cena não encontrada no OBS.', 404);
        const data = await request('GetSceneItemList', {
            sceneName: scene,
        });
        return data.sceneItems.map((item) => ({
            id: item.sceneItemId,
            name: item.sourceName,
            isGroup: !!item.isGroup,
            enabled: item.sceneItemEnabled,
        }));
    }
    async function mapped() {
        if (!settings.scene || !settings.source)
            throw fail('Escolha a cena e a fonte da webcam.', 409);
        const list = await items(settings.scene);
        const target = list.find(
            (item) =>
                item.name === settings.source &&
                (settings.itemId === null || item.id === settings.itemId),
        );
        if (!target || target.isGroup)
            throw fail(
                'Fonte não encontrada diretamente nesta cena. Escolha o item da webcam; grupos precisam ser remapeados.',
                409,
            );
        return { sceneName: settings.scene, sceneItemId: target.id };
    }
    async function syncCamera() {
        if (!settings.manageWebcam) return { skipped: true };
        const rpc = needClient();
        const target = await mapped();
        const key = JSON.stringify(target);
        if (!Object.hasOwn(originals, key)) {
            const [transform, enabled] = await Promise.all([
                request('GetSceneItemTransform', target, rpc),
                request('GetSceneItemEnabled', target, rpc),
            ]);
            originals[key] = {
                target,
                source: settings.source,
                transform: transform.sceneItemTransform,
                enabled: enabled.sceneItemEnabled,
            };
            fs.mkdirSync(directory, { recursive: true });
            configModule.writeFileAtomic(
                originalFile,
                JSON.stringify(originals, null, 2),
            );
        }
        const composition = layout();
        await request(
            'SetSceneItemEnabled',
            {
                ...target,
                sceneItemEnabled: composition.webcam.enabled,
            },
            rpc,
        );
        if (composition.webcam.enabled) {
            const video = await request('GetVideoSettings', undefined, rpc);
            const box = cameraGeometry(
                composition,
                video.baseWidth,
                video.baseHeight,
            ).inner;
            await request(
                'SetSceneItemTransform',
                {
                    ...target,
                    sceneItemTransform: {
                        positionX: box.x,
                        positionY: box.y,
                        rotation: 0,
                        alignment: 5,
                        boundsType: 'OBS_BOUNDS_STRETCH',
                        boundsWidth: box.width,
                        boundsHeight: box.height,
                        boundsAlignment: 0,
                        cropLeft: 0,
                        cropRight: 0,
                        cropTop: 0,
                        cropBottom: 0,
                    },
                },
                rpc,
            );
        }
        return { ok: true };
    }
    function schedule() {
        clearTimeout(timer);
        if (!desired) return;
        timer = setTimeout(
            () => void connect(false).catch(() => {}),
            retryDelay,
        );
        timer.unref?.();
        retryDelay = Math.min(30000, retryDelay * 2);
    }
    async function connect(persistEnabled = true) {
        desired = true;
        if (persistEnabled) {
            settings.enabled = true;
            persist();
        }
        clearTimeout(timer);
        const run = ++generation;
        const previous = client;
        client = null;
        connected = false;
        await previous?.disconnect().catch(() => {});
        const rpc = clientFactory();
        client = rpc;
        rpc.on('ConnectionClosed', () => {
            if (run !== generation) return;
            connected = false;
            scenes = [];
            currentScene = '';
            notify();
            schedule();
        });
        rpc.on('CurrentProgramSceneChanged', (event) => {
            if (run === generation) {
                currentScene = event.sceneName;
                notify();
            }
        });
        for (const event of [
            'SceneCreated',
            'SceneRemoved',
            'SceneNameChanged',
        ])
            rpc.on(event, () => {
                if (run === generation && connected)
                    void refresh().catch(() => {});
            });
        let deadline;
        try {
            const host =
                settings.host.includes(':') && !settings.host.startsWith('[')
                    ? `[${settings.host}]`
                    : settings.host;
            await Promise.race([
                rpc.connect(
                    `${settings.protocol}://${host}:${settings.port}`,
                    password() || undefined,
                    { rpcVersion: 1 },
                ),
                new Promise((_, reject) => {
                    deadline = setTimeout(
                        () =>
                            reject(new Error('Tempo de conexão OBS excedido.')),
                        6000,
                    );
                }),
            ]);
            if (run !== generation) {
                await rpc.disconnect().catch(() => {});
                return status();
            }
            connected = true;
            lastError = '';
            retryDelay = 1000;
            await refresh();
            if (settings.manageWebcam)
                await serial(syncCamera).catch((error) => {
                    lastError = error.message;
                    notify();
                });
            return status();
        } catch (error) {
            if (run === generation) {
                connected = false;
                lastError = String(error.message || 'Falha ao conectar ao OBS');
                await rpc.disconnect().catch(() => {});
                notify();
                schedule();
            }
            throw fail(
                'Não foi possível conectar ao OBS. Confira host, porta, senha e o servidor WebSocket.',
                502,
            );
        } finally {
            clearTimeout(deadline);
        }
    }
    async function disconnect(persistDisabled = true) {
        desired = false;
        generation++;
        clearTimeout(timer);
        const old = client;
        client = null;
        connected = false;
        scenes = [];
        currentScene = '';
        if (persistDisabled) {
            settings.enabled = false;
            persist();
        }
        await old?.disconnect().catch(() => {});
        notify();
        return status();
    }
    async function configure(input) {
        const next = validateObs(input, settings);
        await disconnect(false);
        if (input.password) savePassword(input.password);
        settings = next;
        settings.enabled = false;
        persist();
        notify();
        return status();
    }
    async function restoreCamera() {
        const rpc = needClient();
        const target = await mapped();
        const key = JSON.stringify(target);
        const saved = originals[key];
        if (!saved || saved.source !== settings.source)
            throw fail('Sem posição original para este item.', 404);
        await request(
            'SetSceneItemTransform',
            {
                ...target,
                sceneItemTransform: saved.transform,
            },
            rpc,
        );
        await request(
            'SetSceneItemEnabled',
            {
                ...target,
                sceneItemEnabled: saved.enabled,
            },
            rpc,
        );
        settings.manageWebcam = false;
        persist();
        notify();
        return status();
    }
    async function switchScene(scene) {
        if (!scenes.includes(scene))
            throw fail('Cena vinculada ao preset não existe no OBS.', 404);
        await request('SetCurrentProgramScene', { sceneName: scene });
        currentScene = scene;
        notify();
    }
    function backup() {
        return { settings: { ...settings }, password: password() };
    }
    async function restoreBackup(value) {
        const validated = validateObs(value.settings);
        await disconnect(false);
        savePassword(value.password || '');
        settings = { ...validated, enabled: false, manageWebcam: false };
        persist();
        notify();
        return status();
    }
    return {
        status,
        configure,
        connect,
        disconnect,
        refresh,
        items,
        backup,
        restoreBackup,
        syncCamera: () => serial(syncCamera),
        restoreCamera: () => serial(restoreCamera),
        switchScene: (scene) => serial(() => switchScene(scene)),
        start: () =>
            settings.enabled
                ? connect(false).catch(() => {})
                : Promise.resolve(),
        shutdown: () => disconnect(false),
    };
}
let singleton;
function getObs() {
    if (!singleton)
        singleton = createObsManager({
            emit: (status) =>
                require('../ctx').io?.of('/admin').emit('obs:status', status),
        });
    return singleton;
}
module.exports = { createObsManager, getObs, validateObs };
