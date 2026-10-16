'use strict';

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const { SOUNDS_DIR, config } = require('../config');

function resolveSound(filename) {
    if (!filename || filename !== path.basename(filename) || filename.includes('\\') || filename === '.' || filename === '..') return null;
    const resolved = path.resolve(SOUNDS_DIR, filename);
    return path.dirname(resolved) === path.resolve(SOUNDS_DIR) ? resolved : null;
}

function isSoundInUse(filename) {
    return Object.values(config.alertSounds || {}).some((sound) => sound?.url === `/sounds/${filename}`);
}

const soundUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, SOUNDS_DIR),
        filename: (req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1e4);
            const ext = path.extname(file.originalname);
            cb(null, unique + ext);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/') && /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus|aiff?|wma)$/i.test(file.originalname)) cb(null, true);
        else cb(new Error('Only audio files allowed'));
    }
});

router.post('/api/sounds/upload', soundUpload.single('sound'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/sounds/${req.file.filename}`;
    console.log(`[Sound] Uploaded: ${req.file.originalname} -> ${url}`);
    res.json({ filename: req.file.filename, originalName: req.file.originalname, url });
});

router.get('/api/sounds', (req, res) => {
    try {
        const files = fs.readdirSync(SOUNDS_DIR).filter((f) => !f.startsWith('.'));
        const sounds = files.map((f) => ({
            filename: f,
            url: `/sounds/${f}`,
            size: fs.statSync(path.join(SOUNDS_DIR, f)).size
        }));
        res.json(sounds);
    } catch {
        res.json([]);
    }
});

router.delete('/api/sounds/:filename', (req, res) => {
    const filePath = resolveSound(req.params.filename);
    if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
    if (isSoundInUse(req.params.filename)) return res.status(409).json({ error: 'Unlink this sound from alerts before deleting it' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    try {
        fs.unlinkSync(filePath);
        console.log(`[Sound] Deleted: ${req.params.filename}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.patch('/api/sounds/:filename', (req, res) => {
    const oldPath = resolveSound(req.params.filename);
    if (!oldPath) return res.status(400).json({ error: 'Invalid filename' });
    if (isSoundInUse(req.params.filename)) return res.status(409).json({ error: 'Unlink this sound from alerts before renaming it' });
    const newName = req.body.newName;
    if (typeof newName !== 'string' || !newName.trim() || newName.length > 150) return res.status(400).json({ error: 'A filename of 1–150 characters is required' });
    const ext = path.extname(req.params.filename);
    const safeName = newName.replace(/[^a-zA-Z0-9_\-.]/g, '_') + ext;
    const newPath = path.join(SOUNDS_DIR, safeName);
    if (newPath !== oldPath && fs.existsSync(newPath)) return res.status(409).json({ error: 'A sound with this name already exists' });
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
    try {
        fs.renameSync(oldPath, newPath);
        console.log(`[Sound] Renamed: ${req.params.filename} -> ${safeName}`);
        res.json({ oldName: req.params.filename, newName: safeName, url: `/sounds/${safeName}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
