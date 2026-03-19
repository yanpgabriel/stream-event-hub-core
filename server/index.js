'use strict';

const { bootstrap } = require('./src/bootstrap');

bootstrap().catch((err) => {
    console.error('[Runtime] Bootstrap failed:', err?.message || String(err));
    process.exit(1);
});
