'use strict';

const router = require('express').Router();
const { getStore, validateLayout } = require('../services/overlay');
const { getObs } = require('../services/obs');
const { createMigrationService } = require('../services/overlayMigration');
let migration;
const importer = () =>
    migration ||
    (migration = createMigrationService({ store: getStore(), obs: getObs() }));
const route = (fn) => async (req, res, next) => {
    try {
        const value = await fn(req);
        res.json(value);
    } catch (error) {
        next(error);
    }
};
router.get(
    '/api/overlay/state',
    route(() => getStore().snapshot()),
);
router.get(
    '/api/overlay/config',
    route(() => getStore().admin()),
);
router.patch(
    '/api/overlay/appearance/:kind',
    route((req) =>
        getStore().appearanceDraft(
            req.params.kind,
            req.body.patch,
            req.body.revision,
        ),
    ),
);
router.post(
    '/api/overlay/appearance/:kind/publish',
    route((req) =>
        getStore().appearancePublish(req.params.kind, req.body.revision),
    ),
);
router.post(
    '/api/overlay/config/validate',
    route((req) => ({
        ok: true,
        layout: validateLayout(req.body.patch, getStore().admin().draft),
    })),
);
router.patch(
    '/api/overlay/config',
    route((req) => getStore().draft(req.body.patch, req.body.revision)),
);
router.post(
    '/api/overlay/publish',
    route(async (req) => {
        const snapshot = getStore().publish(req.body.revision);
        let warning = '';
        try {
            await getObs().syncCamera();
        } catch (error) {
            warning = `Composição publicada; webcam não sincronizada: ${error.message}`;
        }
        return { snapshot, warning };
    }),
);
router.post(
    '/api/overlay/live',
    route(async (req) => {
        const snapshot = getStore().live(req.body.patch, req.body.revision);
        let warning = '';
        try {
            if (req.body.patch.webcam) await getObs().syncCamera();
        } catch (error) {
            warning = `Composição atualizada; webcam não sincronizada: ${error.message}`;
        }
        return { snapshot, warning };
    }),
);
router.post(
    '/api/overlay/runtime',
    route((req) => getStore().runtime(req.body)),
);
router.post(
    '/api/overlay/activity',
    route((req) => getStore().activity(req.body.name, req.body.label)),
);
router.delete(
    '/api/overlay/activity/:id',
    route((req) => getStore().removeActivity(req.params.id)),
);
router.post(
    '/api/overlay/presets',
    route((req) => getStore().savePreset(req.body.preset, req.body.revision)),
);
router.patch(
    '/api/overlay/presets/:id',
    route((req) =>
        getStore().savePreset(
            { ...req.body.preset, id: req.params.id },
            req.body.revision,
        ),
    ),
);
router.post(
    '/api/overlay/presets/:id/load',
    route((req) => getStore().loadPreset(req.params.id, req.body.revision)),
);
router.post(
    '/api/overlay/presets/:id/apply',
    route(async (req) => {
        const store = getStore();
        const preset = store.preset(req.params.id);
        store.loadPreset(preset.id, req.body.revision);
        store.publish(store.admin().revision);
        let warning = '';
        try {
            if (req.body.switchScene === true && preset.scene)
                await getObs().switchScene(preset.scene);
            await getObs().syncCamera();
        } catch (error) {
            warning = `Layout publicado; ação OBS incompleta: ${error.message}`;
        }
        return { snapshot: store.snapshot(), warning };
    }),
);
router.delete(
    '/api/overlay/presets/:id',
    route((req) => getStore().deletePreset(req.params.id, req.body.revision)),
);
router.get(
    '/api/overlay/backups',
    route(() => getStore().backups()),
);
router.post(
    '/api/migration/overlays/preview',
    route((req) => importer().preview(req.body, req.session.sid)),
);
router.post(
    '/api/migration/overlays/apply',
    route((req) => importer().apply(req.body, req.session.sid)),
);
router.post(
    '/api/migration/overlays/restore',
    route((req) => importer().restore(req.body)),
);
module.exports = router;
