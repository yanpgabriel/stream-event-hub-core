'use strict';

const router = require('express').Router();
const { getObs } = require('../services/obs');
const route = (fn) => async (req, res, next) => {
    try {
        res.json(await fn(req));
    } catch (error) {
        next(error);
    }
};
router.get(
    '/api/obs/status',
    route(() => getObs().status()),
);
router.get(
    '/api/obs/scenes',
    route(async () => {
        await getObs().refresh();
        return getObs().status().scenes;
    }),
);
router.get(
    '/api/obs/items',
    route((req) => getObs().items(req.query.scene)),
);
router.post(
    '/api/obs/config',
    route((req) => getObs().configure(req.body)),
);
router.post(
    '/api/obs/connect',
    route(() => getObs().connect()),
);
router.post(
    '/api/obs/disconnect',
    route(() => getObs().disconnect()),
);
router.post(
    '/api/obs/refresh',
    route(() => getObs().refresh()),
);
router.post(
    '/api/obs/webcam/sync',
    route(() => getObs().syncCamera()),
);
router.post(
    '/api/obs/webcam/restore',
    route(() => getObs().restoreCamera()),
);
module.exports = router;
