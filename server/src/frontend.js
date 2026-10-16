'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

function mountFrontend(
    app,
    directory = path.resolve(__dirname, '../../web/dist'),
) {
    const index = path.join(directory, 'index.html');
    app.use('/api', (_req, res) =>
        res.status(404).json({ error: 'API route not found' }),
    );
    if (!fs.existsSync(index)) {
        app.get('/', (_req, res) =>
            res
                .type('text/plain')
                .send(
                    'Stream Hub API\n\nDevelopment UI: http://127.0.0.1:5173\nBuild the UI with: bun run build',
                ),
        );
        return;
    }
    app.use(express.static(directory, { index: false }));
    app.get(
        /^\/(?:admin(?:\/.*)?|login|overlays\/(?:alertas|chat|destaque|widgets|sorteio|cena))?\/?$/,
        (_req, res) => {
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(index);
        },
    );
}

module.exports = { mountFrontend };
