'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const ctx = require('./ctx');

const DATA_DIR = path.resolve(process.env.STREAM_HUB_DATA_DIR || path.join(__dirname, '..', 'data'));
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');
const ALERT_HISTORY_PATH = path.join(DATA_DIR, 'alert-history.ndjson');
const SECRET_FIELDS = [
    'googleClientSecret',
    'youtubeAccessToken',
    'youtubeRefreshToken',
    'twitchClientSecret',
    'twitchAccessToken',
    'twitchRefreshToken',
    'livePixClientSecret',
    'livePixAccessToken',
    'obsPassword'
];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
if (!fs.existsSync(ALERT_HISTORY_PATH)) fs.writeFileSync(ALERT_HISTORY_PATH, '');

const CONFIG_VERSION = 11;
const MAX_HISTORY = 2000;
const MAX_QUEUE_ITEMS = 500;
const CHAT_TEXT_MIN_PT = 8;
const CHAT_TEXT_MAX_PT = 128;
const CHAT_TEXT_STEP_PT = 2;
const DEFAULT_CHAT_MESSAGE_TEXT_SIZE = 20;
const DEFAULT_CLICKABLE_CHAT_MESSAGE_TEXT_SIZE = 12;
const DEFAULT_FEATURE_MESSAGE_TEXT_SIZE = 48;
const DEFAULT_ALERT_MESSAGE_TEXT_SIZE = 32;
const RESTART_FREE_FIELDS = new Set([
    'obsPassword',
    'featureChatAutoHideSeconds',
    'chatMessageTextSize',
    'clickableChatMessageTextSize',
    'featureMessageTextSize',
    'alertMessageTextSize',
    'chatTextSizeOffset',
    'alertToggles',
    'alertSounds',
    'ttsConfig',
    'alertDuration',
    'lastFollower',
    'lastSub',
    'livePixLastSeenAt'
]);

function normalizeTextSizePt(value, fallback) {
    const base = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_CHAT_MESSAGE_TEXT_SIZE;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return base;
    const clamped = Math.max(CHAT_TEXT_MIN_PT, Math.min(CHAT_TEXT_MAX_PT, Math.round(raw)));
    const snapped = CHAT_TEXT_MIN_PT + Math.round((clamped - CHAT_TEXT_MIN_PT) / CHAT_TEXT_STEP_PT) * CHAT_TEXT_STEP_PT;
    return Math.max(CHAT_TEXT_MIN_PT, Math.min(CHAT_TEXT_MAX_PT, snapped));
}

const DEFAULT_CONFIG = {
    obsPassword: '',
    version: CONFIG_VERSION,
    lastSavedAt: null,
    youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || '',
    youtubeLiveId: process.env.YOUTUBE_LIVE_ID || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    youtubeOAuthRedirectUri: process.env.YOUTUBE_OAUTH_REDIRECT_URI || '',
    youtubeAccessToken: process.env.YOUTUBE_ACCESS_TOKEN || '',
    youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
    youtubeTokenExpiresAt: process.env.YOUTUBE_TOKEN_EXPIRES_AT || '',
    featureChatAutoHideSeconds: Number(process.env.FEATURE_CHAT_AUTOHIDE_SECONDS || 0),
    chatMessageTextSize: normalizeTextSizePt(
        process.env.CHAT_MESSAGE_TEXT_SIZE || (
            Number.isFinite(Number(process.env.CHAT_TEXT_SIZE_OFFSET || ''))
                ? String(19 + Number(process.env.CHAT_TEXT_SIZE_OFFSET || 0))
                : ''
        ),
        DEFAULT_CHAT_MESSAGE_TEXT_SIZE
    ),
    clickableChatMessageTextSize: normalizeTextSizePt(
        process.env.CLICKABLE_CHAT_MESSAGE_TEXT_SIZE || '',
        DEFAULT_CLICKABLE_CHAT_MESSAGE_TEXT_SIZE
    ),
    featureMessageTextSize: normalizeTextSizePt(
        process.env.FEATURE_MESSAGE_TEXT_SIZE || '',
        DEFAULT_FEATURE_MESSAGE_TEXT_SIZE
    ),
    alertMessageTextSize: normalizeTextSizePt(
        process.env.ALERT_MESSAGE_TEXT_SIZE || '',
        DEFAULT_ALERT_MESSAGE_TEXT_SIZE
    ),
    twitchClientId: process.env.TWITCH_CLIENT_ID || '',
    twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || '',
    twitchAccessToken: process.env.TWITCH_ACCESS_TOKEN || '',
    twitchRefreshToken: process.env.TWITCH_REFRESH_TOKEN || '',
    twitchChatChannel: process.env.TWITCH_CHAT_CHANNEL || '',
    livePixClientId: process.env.LIVEPIX_CLIENT_ID || '',
    livePixClientSecret: process.env.LIVEPIX_CLIENT_SECRET || '',
    livePixAccessToken: process.env.LIVEPIX_ACCESS_TOKEN || '',
    livePixTokenExpiresAt: process.env.LIVEPIX_TOKEN_EXPIRES_AT || '',
    livePixWebhookId: process.env.LIVEPIX_WEBHOOK_ID || '',
    livePixWebhookUrl: process.env.LIVEPIX_WEBHOOK_URL || '',
    livePixNotificationUrl: process.env.LIVEPIX_NOTIFICATION_URL || '',
    livePixLastSeenAt: '',
    alertToggles: { follow: true, sub: true, tip: true, cheer: true, raid: true },
    alertSounds: {
        follow: { url: '', volume: 80 },
        sub: { url: '', volume: 80 },
        tip: { url: '', volume: 80 },
        cheer: { url: '', volume: 80 },
        raid: { url: '', volume: 80 }
    },
    ttsConfig: {
        enabled: { sub: false, tip: false, cheer: false },
        voice: 'default',
        rate: 1,
        volume: 0.8
    },
    alertDuration: 6,
    lastFollower: '',
    lastSub: ''
};

let config = {};

function replaceConfig(next) {
    const source = next && typeof next === 'object' ? next : {};
    for (const key of Object.keys(config)) {
        delete config[key];
    }
    Object.assign(config, source);
}

function migrateConfig(raw) {
    const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
    cfg.alertToggles = { ...DEFAULT_CONFIG.alertToggles, ...(raw?.alertToggles || {}) };
    cfg.ttsConfig = {
        ...DEFAULT_CONFIG.ttsConfig,
        ...(raw?.ttsConfig || {}),
        enabled: {
            ...DEFAULT_CONFIG.ttsConfig.enabled,
            ...(raw?.ttsConfig?.enabled || {})
        }
    };
    const inputSounds = raw?.alertSounds || {};
    cfg.alertSounds = { ...DEFAULT_CONFIG.alertSounds };
    for (const type of Object.keys(DEFAULT_CONFIG.alertSounds)) {
        cfg.alertSounds[type] = {
            ...DEFAULT_CONFIG.alertSounds[type],
            ...(inputSounds[type] || {})
        };
    }
    const hideSeconds = Number(cfg.featureChatAutoHideSeconds);
    cfg.featureChatAutoHideSeconds = Number.isInteger(hideSeconds)
        ? Math.max(0, Math.min(30, hideSeconds))
        : 0;
    const legacyOffset = Number(raw?.chatTextSizeOffset ?? NaN);
    const mainRaw = raw?.chatMessageTextSize ?? (Number.isFinite(legacyOffset) ? 19 + legacyOffset : undefined);
    cfg.chatMessageTextSize = normalizeTextSizePt(mainRaw, DEFAULT_CHAT_MESSAGE_TEXT_SIZE);
    cfg.clickableChatMessageTextSize = normalizeTextSizePt(
        raw?.clickableChatMessageTextSize,
        DEFAULT_CLICKABLE_CHAT_MESSAGE_TEXT_SIZE
    );
    cfg.featureMessageTextSize = normalizeTextSizePt(raw?.featureMessageTextSize, DEFAULT_FEATURE_MESSAGE_TEXT_SIZE);
    cfg.alertMessageTextSize = normalizeTextSizePt(raw?.alertMessageTextSize, DEFAULT_ALERT_MESSAGE_TEXT_SIZE);
    delete cfg.chatTextSizeOffset;
    cfg.version = CONFIG_VERSION;
    return cfg;
}

function writeFileAtomic(filePath, content) {
    const tempPath = `${filePath}.tmp-${Date.now()}`;
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
}

function writeSecretFileAtomic(filePath, content) {
    const tempPath = `${filePath}.tmp-${Date.now()}`;
    fs.writeFileSync(tempPath, content, { mode: 0o600 });
    try {
        fs.chmodSync(tempPath, 0o600);
    } catch { }
    fs.renameSync(tempPath, filePath);
    try {
        fs.chmodSync(filePath, 0o600);
    } catch { }
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function splitConfigForPersistence(cfg) {
    const source = cfg && typeof cfg === 'object' ? cfg : {};
    const publicConfig = { ...source };
    const secretConfig = {};
    for (const field of SECRET_FIELDS) {
        if (!(field in publicConfig)) continue;
        secretConfig[field] = publicConfig[field];
        delete publicConfig[field];
    }
    return { publicConfig, secretConfig };
}

function shouldTriggerRestartForPatch(patch) {
    const keys = Object.keys(patch || {});
    return keys.some((key) => !RESTART_FREE_FIELDS.has(key));
}

function saveConfig({ triggerRestart = true } = {}) {
    config.version = CONFIG_VERSION;
    config.lastSavedAt = new Date().toISOString();
    const { publicConfig, secretConfig } = splitConfigForPersistence(config);
    writeFileAtomic(CONFIG_PATH, JSON.stringify(publicConfig, null, 2));
    writeSecretFileAtomic(SECRETS_PATH, JSON.stringify(secretConfig, null, 2));
    if (ctx.serverReady && triggerRestart) {
        if (ctx.restartTimer) clearTimeout(ctx.restartTimer);
        ctx.restartTimer = setTimeout(() => {
            if (typeof ctx.restartListeners === 'function') ctx.restartListeners();
        }, 1500);
    }
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH) && !fs.existsSync(SECRETS_PATH)) {
            replaceConfig(migrateConfig({}));
            saveConfig({ triggerRestart: false });
            return;
        }
        const parsedConfig = readJsonFile(CONFIG_PATH);
        const parsedSecrets = readJsonFile(SECRETS_PATH);
        replaceConfig(migrateConfig({ ...parsedConfig, ...parsedSecrets }));
        const hasLegacySecretsInConfig = SECRET_FIELDS.some((field) => field in parsedConfig);
        if ((parsedConfig.version || 0) < CONFIG_VERSION || hasLegacySecretsInConfig) {
            saveConfig({ triggerRestart: false });
        }
    } catch (e) {
        console.error('Error loading config:', e.message);
        replaceConfig(migrateConfig({}));
        saveConfig({ triggerRestart: false });
    }
}

function redactConfig(cfg) {
    return {
        ...cfg,
        googleClientSecret: '',
        youtubeAccessToken: '',
        youtubeRefreshToken: '',
        twitchClientSecret: '',
        twitchAccessToken: '',
        twitchRefreshToken: '',
        livePixClientSecret: '',
        livePixAccessToken: '',
        obsPassword: '',
        hasSecrets: {
            googleClientSecret: !!cfg.googleClientSecret,
            youtubeAccessToken: !!cfg.youtubeAccessToken,
            youtubeRefreshToken: !!cfg.youtubeRefreshToken,
            twitchClientSecret: !!cfg.twitchClientSecret,
            twitchAccessToken: !!cfg.twitchAccessToken,
            twitchRefreshToken: !!cfg.twitchRefreshToken,
            livePixClientSecret: !!cfg.livePixClientSecret,
            livePixAccessToken: !!cfg.livePixAccessToken,
            obsPassword: !!cfg.obsPassword
        }
    };
}

function coerceBoolean(v) {
    return typeof v === 'boolean' ? v : null;
}

function normalizeLivePixNotificationUrl(value) {
    if (typeof value !== 'string') return { ok: false, error: 'Must be string' };
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, value: '' };

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: 'Must be a valid URL' };
    }

    if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'Must use https://' };
    }
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'widget.livepix.gg' || host.endsWith('.livepix.gg'))) {
        return { ok: false, error: 'Use a widget.livepix.gg URL' };
    }
    if (!/\/embed\//.test(parsed.pathname)) {
        return { ok: false, error: 'LivePix URL must contain /embed/' };
    }
    parsed.hash = '';
    return { ok: true, value: parsed.toString() };
}

function normalizeTtsLang(value) {
    const raw = String(value || 'en').trim().toLowerCase();
    if (!raw) return 'en';
    if (/^[a-z]{2}$/.test(raw)) return raw;
    if (/^[a-z]{2}[-_][a-z]{2}$/.test(raw)) return raw.replace('_', '-');
    return 'en';
}

function normalizeTtsText(value) {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 250);
    return text;
}

async function fetchFallbackTtsAudio(text, lang = 'en') {
    const requests = [
        {
            url: 'https://translate.google.com/translate_tts',
            params: { ie: 'UTF-8', client: 'tw-ob', tl: lang, q: text },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Referer': 'https://translate.google.com/'
            }
        },
        {
            url: 'https://translate.googleapis.com/translate_tts',
            params: { ie: 'UTF-8', client: 'gtx', tl: lang, q: text },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            }
        }
    ];

    let lastError = null;
    for (const req of requests) {
        try {
            const res = await axios.get(req.url, {
                params: req.params,
                headers: req.headers,
                responseType: 'arraybuffer',
                timeout: 12000,
                validateStatus: () => true
            });
            if (res.status >= 200 && res.status < 300 && res.data) {
                const out = Buffer.from(res.data);
                if (out.length > 0) return out;
            }
            lastError = new Error(`TTS upstream status ${res.status}`);
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('Failed to fetch fallback TTS audio');
}

function validateConfigPatch(input) {
    const errors = [];
    const patch = {};
    const allowedTop = new Set([
        'obsPassword',
        'youtubeChannelId',
        'youtubeLiveId',
        'googleClientId',
        'googleClientSecret',
        'youtubeOAuthRedirectUri',
        'youtubeAccessToken',
        'youtubeRefreshToken',
        'youtubeTokenExpiresAt',
        'featureChatAutoHideSeconds',
        'chatMessageTextSize',
        'clickableChatMessageTextSize',
        'featureMessageTextSize',
        'alertMessageTextSize',
        'chatTextSizeOffset',
        'twitchClientId',
        'twitchClientSecret',
        'twitchAccessToken',
        'twitchRefreshToken',
        'twitchChatChannel',
        'livePixClientId',
        'livePixClientSecret',
        'livePixAccessToken',
        'livePixTokenExpiresAt',
        'livePixWebhookId',
        'livePixWebhookUrl',
        'livePixNotificationUrl',
        'livePixLastSeenAt',
        'alertToggles',
        'alertSounds',
        'ttsConfig',
        'alertDuration',
        'lastFollower',
        'lastSub'
    ]);

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, errors: [{ field: 'body', message: 'Expected JSON object' }] };
    }

    for (const key of Object.keys(input)) {
        if (!allowedTop.has(key)) {
            errors.push({ field: key, message: 'Unknown field' });
        }
    }

    if ('youtubeChannelId' in input) {
        if (typeof input.youtubeChannelId !== 'string') errors.push({ field: 'youtubeChannelId', message: 'Must be string' });
        else patch.youtubeChannelId = input.youtubeChannelId.trim();
    }

    if ('youtubeLiveId' in input) {
        if (typeof input.youtubeLiveId !== 'string') errors.push({ field: 'youtubeLiveId', message: 'Must be string' });
        else patch.youtubeLiveId = input.youtubeLiveId.trim();
    }

    if ('googleClientId' in input) {
        if (typeof input.googleClientId !== 'string') errors.push({ field: 'googleClientId', message: 'Must be string' });
        else patch.googleClientId = input.googleClientId.trim();
    }

    if ('youtubeOAuthRedirectUri' in input) {
        if (typeof input.youtubeOAuthRedirectUri !== 'string') {
            errors.push({ field: 'youtubeOAuthRedirectUri', message: 'Must be string' });
        } else {
            const raw = input.youtubeOAuthRedirectUri.trim();
            if (!raw) {
                patch.youtubeOAuthRedirectUri = '';
            } else {
                try {
                    const parsed = new URL(raw);
                    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                        errors.push({ field: 'youtubeOAuthRedirectUri', message: 'Must start with http:// or https://' });
                    } else {
                        patch.youtubeOAuthRedirectUri = parsed.toString();
                    }
                } catch {
                    errors.push({ field: 'youtubeOAuthRedirectUri', message: 'Must be a valid URL' });
                }
            }
        }
    }

    if ('featureChatAutoHideSeconds' in input) {
        const n = Number(input.featureChatAutoHideSeconds);
        if (!Number.isInteger(n) || n < 0 || n > 30) {
            errors.push({ field: 'featureChatAutoHideSeconds', message: 'Must be integer 0..30' });
        } else {
            patch.featureChatAutoHideSeconds = n;
        }
    }

    if ('chatTextSizeOffset' in input) {
        const n = Number(input.chatTextSizeOffset);
        if (!Number.isInteger(n) || n < -10 || n > 10) {
            errors.push({ field: 'chatTextSizeOffset', message: 'Must be integer -10..10' });
        } else {
            patch.chatMessageTextSize = normalizeTextSizePt(19 + n, DEFAULT_CHAT_MESSAGE_TEXT_SIZE);
        }
    }

    if ('chatMessageTextSize' in input) {
        const n = Number(input.chatMessageTextSize);
        if (!Number.isInteger(n) || n < CHAT_TEXT_MIN_PT || n > CHAT_TEXT_MAX_PT || ((n - CHAT_TEXT_MIN_PT) % CHAT_TEXT_STEP_PT) !== 0) {
            errors.push({ field: 'chatMessageTextSize', message: 'Must be integer 8..128 in steps of 2' });
        } else {
            patch.chatMessageTextSize = n;
        }
    }

    if ('clickableChatMessageTextSize' in input) {
        const n = Number(input.clickableChatMessageTextSize);
        if (!Number.isInteger(n) || n < CHAT_TEXT_MIN_PT || n > CHAT_TEXT_MAX_PT || ((n - CHAT_TEXT_MIN_PT) % CHAT_TEXT_STEP_PT) !== 0) {
            errors.push({ field: 'clickableChatMessageTextSize', message: 'Must be integer 8..128 in steps of 2' });
        } else {
            patch.clickableChatMessageTextSize = n;
        }
    }

    if ('featureMessageTextSize' in input) {
        const n = Number(input.featureMessageTextSize);
        if (!Number.isInteger(n) || n < CHAT_TEXT_MIN_PT || n > CHAT_TEXT_MAX_PT || ((n - CHAT_TEXT_MIN_PT) % CHAT_TEXT_STEP_PT) !== 0) {
            errors.push({ field: 'featureMessageTextSize', message: 'Must be integer 8..128 in steps of 2' });
        } else {
            patch.featureMessageTextSize = n;
        }
    }

    if ('alertMessageTextSize' in input) {
        const n = Number(input.alertMessageTextSize);
        if (!Number.isInteger(n) || n < CHAT_TEXT_MIN_PT || n > CHAT_TEXT_MAX_PT || ((n - CHAT_TEXT_MIN_PT) % CHAT_TEXT_STEP_PT) !== 0) {
            errors.push({ field: 'alertMessageTextSize', message: 'Must be integer 8..128 in steps of 2' });
        } else {
            patch.alertMessageTextSize = n;
        }
    }

    if ('twitchClientId' in input) {
        if (typeof input.twitchClientId !== 'string') errors.push({ field: 'twitchClientId', message: 'Must be string' });
        else patch.twitchClientId = input.twitchClientId.trim();
    }

    if ('twitchChatChannel' in input) {
        if (typeof input.twitchChatChannel !== 'string') {
            errors.push({ field: 'twitchChatChannel', message: 'Must be string' });
        } else {
            patch.twitchChatChannel = input.twitchChatChannel.trim().replace(/^#/, '').toLowerCase();
        }
    }

    if ('livePixClientId' in input) {
        if (typeof input.livePixClientId !== 'string') errors.push({ field: 'livePixClientId', message: 'Must be string' });
        else patch.livePixClientId = input.livePixClientId.trim();
    }

    for (const secretField of SECRET_FIELDS) {
        if (secretField in input) {
            if (typeof input[secretField] !== 'string') {
                errors.push({ field: secretField, message: 'Must be string' });
            } else if (input[secretField].trim()) {
                patch[secretField] = input[secretField].trim();
            }
        }
    }

    for (const txtField of ['youtubeTokenExpiresAt', 'livePixTokenExpiresAt', 'livePixWebhookId', 'livePixWebhookUrl', 'livePixLastSeenAt']) {
        if (txtField in input) {
            if (typeof input[txtField] !== 'string') errors.push({ field: txtField, message: 'Must be string' });
            else patch[txtField] = input[txtField].trim();
        }
    }

    if ('livePixNotificationUrl' in input) {
        const normalized = normalizeLivePixNotificationUrl(input.livePixNotificationUrl);
        if (!normalized.ok) errors.push({ field: 'livePixNotificationUrl', message: normalized.error });
        else patch.livePixNotificationUrl = normalized.value;
    }

    if ('lastFollower' in input) {
        if (typeof input.lastFollower !== 'string') errors.push({ field: 'lastFollower', message: 'Must be string' });
        else patch.lastFollower = input.lastFollower;
    }

    if ('lastSub' in input) {
        if (typeof input.lastSub !== 'string') errors.push({ field: 'lastSub', message: 'Must be string' });
        else patch.lastSub = input.lastSub;
    }

    if ('alertDuration' in input) {
        const n = Number(input.alertDuration);
        if (!Number.isInteger(n) || n < 2 || n > 30) errors.push({ field: 'alertDuration', message: 'Must be integer 2..30' });
        else patch.alertDuration = n;
    }

    if ('alertToggles' in input) {
        const t = input.alertToggles;
        if (!t || typeof t !== 'object' || Array.isArray(t)) {
            errors.push({ field: 'alertToggles', message: 'Must be object' });
        } else {
            const next = {};
            for (const key of ['follow', 'sub', 'tip', 'cheer', 'raid']) {
                if (key in t) {
                    const b = coerceBoolean(t[key]);
                    if (b === null) errors.push({ field: `alertToggles.${key}`, message: 'Must be boolean' });
                    else next[key] = b;
                }
            }
            patch.alertToggles = { ...config.alertToggles, ...next };
        }
    }

    if ('alertSounds' in input) {
        const s = input.alertSounds;
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
            errors.push({ field: 'alertSounds', message: 'Must be object' });
        } else {
            const next = { ...config.alertSounds };
            for (const key of ['follow', 'sub', 'tip', 'cheer', 'raid']) {
                if (!(key in s)) continue;
                const item = s[key];
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    errors.push({ field: `alertSounds.${key}`, message: 'Must be object' });
                    continue;
                }
                const url = typeof item.url === 'string' ? item.url : '';
                const volume = Number(item.volume);
                if (!Number.isFinite(volume) || volume < 0 || volume > 100) {
                    errors.push({ field: `alertSounds.${key}.volume`, message: 'Must be 0..100' });
                }
                if (url && !url.startsWith('/sounds/')) {
                    errors.push({ field: `alertSounds.${key}.url`, message: 'Must point to /sounds/' });
                }
                next[key] = { url, volume: Number.isFinite(volume) ? Math.round(volume) : 80 };
            }
            patch.alertSounds = next;
        }
    }

    if ('ttsConfig' in input) {
        const tts = input.ttsConfig;
        if (!tts || typeof tts !== 'object' || Array.isArray(tts)) {
            errors.push({ field: 'ttsConfig', message: 'Must be object' });
        } else {
            const next = { ...config.ttsConfig, enabled: { ...config.ttsConfig.enabled } };
            if ('enabled' in tts) {
                if (!tts.enabled || typeof tts.enabled !== 'object' || Array.isArray(tts.enabled)) {
                    errors.push({ field: 'ttsConfig.enabled', message: 'Must be object' });
                } else {
                    for (const key of ['sub', 'tip', 'cheer']) {
                        if (key in tts.enabled) {
                            const b = coerceBoolean(tts.enabled[key]);
                            if (b === null) errors.push({ field: `ttsConfig.enabled.${key}`, message: 'Must be boolean' });
                            else next.enabled[key] = b;
                        }
                    }
                }
            }
            if ('voice' in tts) {
                if (typeof tts.voice !== 'string') errors.push({ field: 'ttsConfig.voice', message: 'Must be string' });
                else next.voice = tts.voice;
            }
            if ('rate' in tts) {
                const n = Number(tts.rate);
                if (!Number.isFinite(n) || n < 0.5 || n > 2) errors.push({ field: 'ttsConfig.rate', message: 'Must be 0.5..2' });
                else next.rate = n;
            }
            if ('volume' in tts) {
                const n = Number(tts.volume);
                if (!Number.isFinite(n) || n < 0 || n > 1) errors.push({ field: 'ttsConfig.volume', message: 'Must be 0..1' });
                else next.volume = n;
            }
            patch.ttsConfig = next;
        }
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, patch };
}

function applyConfigPatch(patch, options = {}) {
    const triggerRestart = options.triggerRestart === false
        ? false
        : (options.triggerRestart === true ? true : shouldTriggerRestartForPatch(patch));
    replaceConfig(migrateConfig({ ...config, ...patch }));
    saveConfig({ triggerRestart });
}

module.exports = {
    DATA_DIR, SOUNDS_DIR, CONFIG_PATH, SECRETS_PATH, ALERT_HISTORY_PATH,
    CONFIG_VERSION, MAX_HISTORY, MAX_QUEUE_ITEMS, DEFAULT_CONFIG, SECRET_FIELDS,
    get config() { return config; },
    set config(val) { replaceConfig(val); },
    migrateConfig, writeFileAtomic, saveConfig, loadConfig, splitConfigForPersistence,
    redactConfig, coerceBoolean, normalizeLivePixNotificationUrl,
    normalizeTtsLang, normalizeTtsText, fetchFallbackTtsAudio,
    validateConfigPatch, applyConfigPatch, shouldTriggerRestartForPatch,
};
