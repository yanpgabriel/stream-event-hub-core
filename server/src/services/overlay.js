'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    DEFAULT_LAYOUT,
    DEFAULT_RUNTIME,
    cameraGeometry,
    goalValue,
} = require('../../../shared/presentation.mjs');
const { DATA_DIR, writeFileAtomic } = require('../config');
const {
    DEFAULT_APPEARANCES,
    OVERLAY_KINDS,
    validateAppearance,
} = require('../../../shared/overlayAppearance.mjs');
const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message, status = 400) =>
    Object.assign(new Error(message), { status });
const isObject = (value) =>
    value && typeof value === 'object' && !Array.isArray(value);

function validateLayout(patch, base = DEFAULT_LAYOUT) {
    if (!isObject(patch)) throw fail('A composição deve ser um objeto.');
    const next = clone(DEFAULT_LAYOUT);
    for (const group of Object.keys(DEFAULT_LAYOUT))
        Object.assign(next[group], base[group]);
    for (const [group, fields] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_LAYOUT, group) || !isObject(fields))
            throw fail(`Grupo inválido: ${group}`);
        for (const [key, value] of Object.entries(fields)) {
            if (!Object.hasOwn(DEFAULT_LAYOUT[group], key))
                throw fail(`Campo desconhecido: ${group}.${key}`);
            const expected = typeof DEFAULT_LAYOUT[group][key];
            if (
                typeof value !== expected ||
                (expected === 'number' &&
                    (!Number.isFinite(value) || value < 0 || value > 1000000))
            )
                throw fail(`Valor inválido: ${group}.${key}`);
            if (
                expected === 'string' &&
                value.length > (['text'].includes(key) ? 2000 : 150)
            )
                throw fail(`Texto muito longo: ${group}.${key}`);
            next[group][key] = value;
        }
    }
    const choices = {
        'webcam.corner': [
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
        ],
        'goal.mode': [
            'manual',
            'twitchSubs',
            'youtubeMembers',
            'bits',
            'donations',
        ],
        'stat.source': ['manual', 'lastFollower', 'lastSub'],
        'activity.source': ['manual', 'automatic', 'mixed'],
        'message.effect': ['flicker', 'pulse', 'glitch', 'typing'],
        'connection.behavior': ['keep', 'warning'],
        'chat.mode': ['native', 'overlay'],
    };
    for (const [field, allowed] of Object.entries(choices)) {
        const [group, key] = field.split('.');
        if (!allowed.includes(next[group][key]))
            throw fail(`Opção inválida: ${field}`);
    }
    if (!/^#[a-f0-9]{6}$/i.test(next.theme.color))
        throw fail('Use uma cor hexadecimal de seis dígitos.');
    const bounded = (n, min, max) =>
        Number.isInteger(n) && n >= min && n <= max;
    if (
        !bounded(next.canvas.width, 640, 3840) ||
        !bounded(next.canvas.height, 360, 2160)
    )
        throw fail('Canvas permitido: 640–3840 × 360–2160.');
    if (
        !bounded(next.chat.limit, 1, 20) ||
        !bounded(next.activity.limit, 1, 5) ||
        !bounded(next.chat.textSize, 8, 64)
    )
        throw fail('Limite de mensagens ou tamanho de texto inválido.');
    if (
        !bounded(next.chat.overlayWidth, 120, 3840) ||
        !bounded(next.chat.overlayHeight, 120, 2160)
    )
        throw fail('Área do overlay de chat permitida: 120–3840 × 120–2160.');
    if (!next.goal.target || next.ticker.speed < 5 || next.ticker.speed > 180)
        throw fail(
            'A meta deve ser positiva e o letreiro deve durar 5–180 segundos por ciclo.',
        );
    const cam = next.webcam;
    const { outer, inner } = cameraGeometry(next);
    if (
        cam.width < 60 ||
        cam.height < 40 ||
        inner.width <= 0 ||
        inner.height <= 0 ||
        outer.x < 0 ||
        outer.y < 0 ||
        outer.x + outer.width > next.canvas.width ||
        outer.y + outer.height > next.canvas.height
    )
        throw fail(
            'A webcam deve caber dentro do canvas, incluindo margens e moldura.',
        );
    return next;
}

function createOverlayStore({
    directory = DATA_DIR,
    notify = () => {},
    metrics = () => ({}),
    history = () => [],
    widgets = () => ({}),
} = {}) {
    const file = path.join(directory, 'overlay-store.json');
    let state;
    const initial = () => ({
        schemaVersion: 1,
        revision: 0,
        draft: clone(DEFAULT_LAYOUT),
        published: clone(DEFAULT_LAYOUT),
        runtime: clone(DEFAULT_RUNTIME),
        presets: [],
        appearances: {
            draft: clone(DEFAULT_APPEARANCES),
            published: clone(DEFAULT_APPEARANCES),
        },
    });
    function normalizeAppearances(value) {
        const result = { draft: {}, published: {} };
        for (const phase of ['draft', 'published'])
            for (const kind of OVERLAY_KINDS)
                result[phase][kind] = validateAppearance(
                    kind,
                    value?.[phase]?.[kind] || {},
                );
        return result;
    }
    function load() {
        if (!state) {
            state = fs.existsSync(file)
                ? JSON.parse(fs.readFileSync(file, 'utf8'))
                : initial();
            if (state.schemaVersion !== 1)
                throw fail('Versão de apresentação incompatível.');
            state.draft = validateLayout(state.draft);
            state.published = validateLayout(state.published);
            for (const preset of state.presets)
                preset.layout = validateLayout(preset.layout);
            state.appearances = normalizeAppearances(state.appearances);
        }
        return state;
    }
    function save() {
        fs.mkdirSync(directory, { recursive: true });
        writeFileAtomic(file, JSON.stringify(load(), null, 2));
    }
    function bump() {
        load().revision++;
        save();
        notify(snapshot());
    }
    function check(revision) {
        if (revision !== load().revision)
            throw fail(
                'A apresentação mudou em outra aba. Recarregue antes de salvar.',
                409,
            );
    }
    function snapshot() {
        const s = load();
        const layout = s.published;
        const widget = widgets();
        const labels = {
            follow: 'Novo seguidor',
            sub: 'Inscrição / membro',
            tip: 'Doação',
            cheer: 'Bits',
            raid: 'Raid',
        };
        const automatic = history()
            .filter((item) => !item.replay && item.origin !== 'test')
            .slice(0, 5)
            .map((item) => ({
                id: String(item.id),
                name: String(item.event?.name || 'Anônimo'),
                label: labels[item.type] || 'Evento',
                source: 'automatic',
            }));
        const activity =
            layout.activity.source === 'manual'
                ? s.runtime.activity
                : layout.activity.source === 'automatic'
                  ? automatic
                  : [...s.runtime.activity, ...automatic];
        return clone({
            layout,
            runtime: s.runtime,
            currentGoal: goalValue(layout, s.runtime, metrics()),
            statValue:
                layout.stat.source === 'manual'
                    ? layout.stat.value
                    : widget[layout.stat.source] || layout.stat.value,
            activity: activity.slice(0, layout.activity.limit),
            revision: s.revision,
            appearances: s.appearances.published,
        });
    }
    function admin() {
        return clone(load());
    }
    function draft(patch, revision) {
        check(revision);
        load().draft = validateLayout(patch, load().draft);
        bump();
        return admin();
    }
    function publish(revision) {
        check(revision);
        load().published = validateLayout(load().draft);
        if (load().pendingRuntime) {
            Object.assign(load().runtime, load().pendingRuntime);
            load().pendingRuntime = null;
        }
        bump();
        return snapshot();
    }
    function live(patch, revision) {
        check(revision);
        load().published = validateLayout(patch, load().published);
        bump();
        return snapshot();
    }
    function appearanceDraft(kind, patch, revision) {
        check(revision);
        const next = validateAppearance(
            kind,
            patch,
            load().appearances.draft[kind],
        );
        load().appearances.draft[kind] = next;
        bump();
        return admin();
    }
    function appearancePublish(kind, revision) {
        check(revision);
        const next = validateAppearance(kind, load().appearances.draft[kind]);
        load().appearances.published[kind] = next;
        bump();
        return admin();
    }
    function runtime(patch) {
        if (!isObject(patch)) throw fail('Operação de apresentação inválida.');
        if (
            'timer' in patch &&
            !['start', 'pause', 'reset'].includes(patch.timer)
        )
            throw fail('Ação de cronômetro inválida.');
        const s = load();
        if ('goalCurrent' in patch) {
            if (
                !Number.isFinite(patch.goalCurrent) ||
                patch.goalCurrent < 0 ||
                patch.goalCurrent > 1000000
            )
                throw fail('Valor de meta inválido.');
            s.runtime.goalCurrent = patch.goalCurrent;
        }
        if ('timer' in patch) {
            if (!['start', 'pause', 'reset'].includes(patch.timer))
                throw fail('Ação de cronômetro inválida.');
            if (s.runtime.timerStartedAt)
                s.runtime.timerElapsedMs +=
                    Date.now() - s.runtime.timerStartedAt;
            s.runtime.timerStartedAt =
                patch.timer === 'start' ? Date.now() : null;
            if (patch.timer === 'reset') s.runtime.timerElapsedMs = 0;
        }
        bump();
        return snapshot();
    }
    function activity(name, label) {
        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.length > 120 ||
            typeof label !== 'string' ||
            !label.trim() ||
            label.length > 120
        )
            throw fail('Informe nome e tipo com até 120 caracteres.');
        load().runtime.activity.unshift({
            id: crypto.randomUUID(),
            name: name.trim(),
            label: label.trim(),
            source: 'manual',
        });
        load().runtime.activity.length = Math.min(
            5,
            load().runtime.activity.length,
        );
        bump();
        return snapshot();
    }
    function removeActivity(id) {
        load().runtime.activity = load().runtime.activity.filter(
            (item) => item.id !== id,
        );
        bump();
        return snapshot();
    }
    function savePreset({ name, scene = '', id, copyFrom }, revision) {
        check(revision);
        if (
            typeof name !== 'string' ||
            !name.trim() ||
            name.length > 100 ||
            typeof scene !== 'string' ||
            scene.length > 150
        )
            throw fail('Nome do preset ou cena inválidos.');
        const s = load();
        const existing = id ? s.presets.find((p) => p.id === id) : null;
        if (id && !existing) throw fail('Preset não encontrado.', 404);
        if (!existing && s.presets.length >= 50)
            throw fail('Limite de 50 presets atingido.');
        const source = copyFrom ? preset(copyFrom).layout : null;
        const value = {
            id: existing?.id || crypto.randomUUID(),
            name: name.trim(),
            scene,
            layout: clone(existing?.layout || source || s.draft),
        };
        if (existing) Object.assign(existing, value);
        else s.presets.push(value);
        bump();
        return value;
    }
    function preset(id) {
        const p = load().presets.find((p) => p.id === id);
        if (!p) throw fail('Preset não encontrado.', 404);
        return clone(p);
    }
    function loadPreset(id, revision) {
        check(revision);
        load().draft = validateLayout(preset(id).layout);
        load().pendingRuntime = null;
        bump();
        return admin();
    }
    function deletePreset(id, revision) {
        check(revision);
        preset(id);
        load().presets = load().presets.filter((p) => p.id !== id);
        bump();
        return admin();
    }
    function backup() {
        load();
        const id = `${Date.now()}-${crypto.randomUUID()}.json`;
        const dir = path.join(directory, 'overlay-backups');
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, id), JSON.stringify(state, null, 2));
        return id;
    }
    function backups() {
        const dir = path.join(directory, 'overlay-backups');
        return fs.existsSync(dir)
            ? fs
                  .readdirSync(dir)
                  .filter((n) => /^\d+-[a-f0-9-]+\.json$/.test(n))
                  .sort()
                  .reverse()
                  .slice(0, 20)
            : [];
    }
    function restore(id, revision) {
        check(revision);
        if (!backups().includes(id)) throw fail('Backup não encontrado.', 404);
        const old = JSON.parse(
            fs.readFileSync(
                path.join(directory, 'overlay-backups', id),
                'utf8',
            ),
        );
        old.draft = validateLayout(old.draft);
        old.published = validateLayout(old.published);
        for (const preset of old.presets)
            preset.layout = validateLayout(preset.layout);
        old.appearances = normalizeAppearances(old.appearances);
        const before = backup();
        const nextRevision = load().revision + 1;
        state = old;
        state.revision = nextRevision;
        save();
        notify(snapshot());
        return { backup: before, state: admin() };
    }
    function importData(converted, revision) {
        check(revision);
        const layout = validateLayout(converted.layout);
        const s = load();
        if (s.presets.length + converted.presets.length > 50)
            throw fail('A importação ultrapassa 50 presets.');
        const id = backup();
        s.draft = layout;
        s.pendingRuntime = {
            goalCurrent: converted.goalCurrent,
            activity: converted.activity,
        };
        for (const p of converted.presets)
            s.presets.push({
                id: crypto.randomUUID(),
                name: p.name,
                scene: p.scene,
                layout: validateLayout(p.layout),
            });
        bump();
        return { backup: id, state: admin() };
    }
    return {
        admin,
        snapshot,
        draft,
        publish,
        live,
        appearanceDraft,
        appearancePublish,
        runtime,
        activity,
        removeActivity,
        savePreset,
        preset,
        loadPreset,
        deletePreset,
        backup,
        backups,
        restore,
        importData,
    };
}
let singleton;
function getStore() {
    if (!singleton)
        singleton = createOverlayStore({
            notify: emitState,
            metrics: () =>
                require('../sessionMetrics').getCurrentSessionSummary().metrics,
            history: () => require('../alerts').alertHistory,
            widgets: () => require('../alerts').getLatestWidgetData(),
        });
    return singleton;
}
function emitState(snapshot) {
    const io = require('../ctx').io;
    if (!io) return;
    const value = snapshot || getStore().snapshot();
    io.emit('overlay:state', value);
    io.of('/admin').emit('overlay:state', value);
}
module.exports = {
    createOverlayStore,
    validateLayout,
    getStore,
    emitState,
    fail,
};
