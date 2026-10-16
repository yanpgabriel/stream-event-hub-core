'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_LAYOUT } = require('../../../shared/presentation.mjs');
const { validateLayout, fail } = require('./overlay');
const { validateObs } = require('./obs');
const { DATA_DIR, writeFileAtomic } = require('../config');
const clone = (value) => JSON.parse(JSON.stringify(value));
function convertLegacy(input) {
    if (
        !input ||
        typeof input !== 'object' ||
        !input.config ||
        typeof input.config !== 'object' ||
        Array.isArray(input.config)
    )
        throw fail('Selecione o config.json do projeto antigo.');
    const warnings = [];
    function convert(c) {
        const layout = clone(DEFAULT_LAYOUT);
        const fields = {
            webcam: ['webcam', 'enabled'],
            webcamPos: ['webcam', 'corner'],
            topbar: ['topbar', 'enabled'],
            showGoal: ['topbar', 'showGoal'],
            showStat: ['topbar', 'showStat'],
            chat: ['chat', 'enabled'],
            events: ['activity', 'enabled'],
            sponsors: ['ticker', 'enabled'],
            particles: ['theme', 'particles'],
            flicker: ['theme', 'flicker'],
            vignette: ['theme', 'vignette'],
            themeColor: ['theme', 'color'],
            sponsorText: ['ticker', 'text'],
            goalLabel: ['goal', 'label'],
            goalTarget: ['goal', 'target'],
            statLabel: ['stat', 'label'],
            statValue: ['stat', 'value'],
            qrcode: ['qr', 'enabled'],
            qrText: ['qr', 'text'],
            screenMessageEnabled: ['message', 'enabled'],
            screenMessageText: ['message', 'text'],
            screenMessageEffect: ['message', 'effect'],
        };
        layout.stat.source = 'manual';
        for (const [old, [group, key]] of Object.entries(fields))
            if (Object.hasOwn(c, old)) layout[group][key] = c[old];
        return validateLayout(layout);
    }
    const layout = convert(input.config);
    if (input.html) {
        if (typeof input.html !== 'string' || input.html.length > 100000)
            throw fail('HTML de referência inválido.');
        const match = input.html.match(
            /<span[^>]*>Instagram<\/span>\s*<span[^>]*>([^<]*)<\/span>/i,
        );
        if (match)
            layout.topbar.socialValue = match[1]
                .slice(0, 150)
                .replaceAll('&amp;', '&');
    }
    const goalCurrent = input.config.goalCurrent ?? 0;
    if (
        !Number.isFinite(goalCurrent) ||
        goalCurrent < 0 ||
        goalCurrent > 1000000
    )
        throw fail('Valor atual da meta legado inválido.');
    if (input.config.liveSince)
        warnings.push('O cronômetro antigo não será iniciado automaticamente.');
    warnings.push(
        'A importação salva um rascunho. A publicação e o controle real do OBS continuam sendo ações separadas.',
    );
    const activity = (
        Array.isArray(input.config.activityLog) ? input.config.activityLog : []
    )
        .slice(0, 5)
        .map((entry) => {
            if (
                typeof entry.user !== 'string' ||
                typeof entry.kind !== 'string' ||
                entry.user.length > 120 ||
                entry.kind.length > 120
            )
                throw fail('Atividade legada inválida.');
            return {
                id: crypto.randomUUID(),
                name: entry.user,
                label: entry.kind,
                source: 'manual',
            };
        });
    if (
        input.presets &&
        (typeof input.presets !== 'object' || Array.isArray(input.presets))
    )
        throw fail('presets.json deve conter um objeto.');
    const presets = Object.entries(input.presets || {}).map(([name, entry]) => {
        if (name.length > 100 || !entry || typeof entry !== 'object')
            throw fail('Preset legado inválido.');
        const scene = entry.obsScene || '';
        if (typeof scene !== 'string' || scene.length > 150)
            throw fail('Cena legada inválida.');
        return { name, scene, layout: convert(entry.config || entry) };
    });
    if (presets.length > 50) throw fail('Máximo de 50 presets por importação.');
    let obs = null;
    if (input.obs) {
        const c = input.obs;
        obs = {
            host: c.host,
            port: c.port,
            protocol: 'ws',
            scene: c.overlayScene || '',
            source: c.webcamSource || '',
            itemId: null,
            manageWebcam: false,
            enabled: false,
            ...(typeof c.password === 'string' ? { password: c.password } : {}),
        };
        validateObs(obs);
    }
    const known = new Set([
        'webcam',
        'webcamPos',
        'topbar',
        'showGoal',
        'showStat',
        'chat',
        'events',
        'sponsors',
        'particles',
        'flicker',
        'vignette',
        'themeColor',
        'sponsorText',
        'goalLabel',
        'goalTarget',
        'goalCurrent',
        'statLabel',
        'statValue',
        'qrcode',
        'qrText',
        'screenMessageEnabled',
        'screenMessageText',
        'screenMessageEffect',
        'activityLog',
        'liveSince',
    ]);
    const ignored = Object.keys(input.config).filter((key) => !known.has(key));
    if (ignored.length)
        warnings.push(`Campos ignorados: ${ignored.join(', ')}`);
    return { layout, goalCurrent, activity, presets, obs, warnings };
}

function createMigrationService({ store, obs, directory = DATA_DIR } = {}) {
    const pending = new Map();
    function preview(input, sessionId) {
        for (const [key, item] of pending)
            if (item.expires < Date.now()) pending.delete(key);
        if (pending.size >= 20)
            throw fail(
                'Muitas prévias de importação. Aguarde ou recarregue mais tarde.',
                429,
            );
        const converted = convertLegacy(input);
        const token = crypto.randomBytes(24).toString('hex');
        pending.set(token, {
            converted,
            sessionId,
            expires: Date.now() + 10 * 60 * 1000,
        });
        return {
            token,
            layout: converted.layout,
            goalCurrent: converted.goalCurrent,
            presets: converted.presets.map((p) => ({
                name: p.name,
                scene: p.scene,
            })),
            activityCount: converted.activity.length,
            warnings: converted.warnings,
            obs: converted.obs
                ? {
                      ...converted.obs,
                      password: undefined,
                      passwordConfigured: !!converted.obs.password,
                  }
                : null,
        };
    }
    async function apply({ token, revision, includeObs = false }, sessionId) {
        const job = pending.get(token);
        if (!job || job.sessionId !== sessionId || job.expires < Date.now())
            throw fail(
                'Prévia de importação expirada. Valide os arquivos novamente.',
                409,
            );
        if (typeof includeObs !== 'boolean')
            throw fail('Opção de OBS inválida.');
        const obsBefore = includeObs && job.converted.obs ? obs.backup() : null;
        const result = store.importData(job.converted, revision);
        try {
            if (obsBefore) {
                const dir = path.join(directory, 'overlay-obs-backups');
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                const target = path.join(dir, result.backup);
                writeFileAtomic(target, JSON.stringify(obsBefore));
                try {
                    fs.chmodSync(target, 0o600);
                } catch {}
                await obs.configure(job.converted.obs);
            }
            pending.delete(token);
            return result;
        } catch (error) {
            store.restore(result.backup, store.admin().revision);
            if (obsBefore) await obs.restoreBackup(obsBefore);
            throw error;
        }
    }
    async function restore({ backup, revision, restoreObs = false }) {
        if (!store.backups().includes(backup))
            throw fail('Backup não encontrado.', 404);
        const file = path.join(directory, 'overlay-obs-backups', backup);
        const previousObs =
            restoreObs && fs.existsSync(file)
                ? JSON.parse(fs.readFileSync(file, 'utf8'))
                : null;
        const result = store.restore(backup, revision);
        if (previousObs) await obs.restoreBackup(previousObs);
        else
            try {
                await obs.syncCamera();
            } catch (error) {
                result.warning = `Apresentação restaurada; webcam não sincronizada: ${error.message}`;
            }
        return result;
    }
    return { preview, apply, restore };
}
module.exports = { convertLegacy, createMigrationService };
