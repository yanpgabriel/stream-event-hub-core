'use strict';

const fs = require('fs');
const path = require('path');
const ctx = require('./ctx');
const { DATA_DIR, writeFileAtomic } = require('./config');

const SESSION_METRICS_PATH = path.join(DATA_DIR, 'session-metrics.json');
const SESSION_METRICS_VERSION = 1;
const MAX_SESSIONS = 120;
const MAX_EVENTS_PER_SESSION = 12000;
const SEED_LOOKBACK_MS = 18 * 60 * 60 * 1000;
const SESSION_IDLE_GAP_MS = 3 * 60 * 60 * 1000;
const YOUTUBE_GIFT_COVERAGE_MS = 3 * 60 * 1000;
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'CLP', 'PYG', 'VND']);
const DEFAULT_FX_TO_BRL = {
    BRL: 1,
    USD: 5.0,
    EUR: 5.4,
    GBP: 6.3,
    CAD: 3.7,
    AUD: 3.4,
    CHF: 5.6,
    JPY: 0.034,
    MXN: 0.29,
    ARS: 0.005,
    CLP: 0.0058,
    PEN: 1.35,
    UYU: 0.13
};
const ANALYTICS_PERIODS = new Set(['last_session', 'day', 'week', 'month', 'year', 'lifetime', 'custom']);
const ANALYTICS_PLATFORMS = new Set(['all', 'youtube', 'twitch', 'livepix']);
const ANALYTICS_BUCKET_UNITS = new Set(['hour', 'day', 'week', 'month']);

let store = createDefaultStore();
let currentSessionEventIds = new Set();
let recentTwitchGiftBombs = [];
let recentYouTubeGiftSummaries = [];
let recentYouTubeGiftRecipients = [];

function resetTransientCoverageCaches() {
    recentTwitchGiftBombs = [];
    recentYouTubeGiftSummaries = [];
    recentYouTubeGiftRecipients = [];
}

function nowIso() {
    return new Date().toISOString();
}

function parseTimestampMs(value) {
    if (!value) return 0;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
}

function toPositiveInt(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(0, Math.round(Number(fallback) || 0));
    return Math.max(0, Math.round(n));
}

function safeCurrency(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    if (raw === 'R$') return 'BRL';
    if (raw === 'US$') return 'USD';
    if (raw.length === 3 && /^[A-Z]{3}$/.test(raw)) return raw;
    return '';
}

function minorFactor(currency) {
    return ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
}

function normalizePlatform(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'yt') return 'youtube';
    if (raw === 'tw') return 'twitch';
    if (raw === 'lp' || raw === 'live_pix') return 'livepix';
    if (raw === 'youtube' || raw === 'twitch' || raw === 'livepix' || raw === 'replay') return raw;
    return '';
}

function normalizePersonKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 80);
}

function cleanupRecentTwitchGiftBombs(nowMs = Date.now()) {
    recentTwitchGiftBombs = recentTwitchGiftBombs.filter((entry) => entry && entry.expiresAt > nowMs);
}

function parseGiftGiverFromMessage(message = '') {
    const text = String(message || '').trim();
    if (!text) return '';
    if (/gifted anonymously/i.test(text)) return 'anonymous';
    const byMatch = text.match(/gifted by\s+(.+)$/i);
    if (!byMatch) return '';
    return normalizePersonKey(byMatch[1]);
}

function registerTwitchGiftBomb(event, eventTsMs) {
    const tier = String(event?.details?.tier || 'other');
    const giver = normalizePersonKey(event?.actorName || '');
    if (!giver) return;
    cleanupRecentTwitchGiftBombs(eventTsMs);
    recentTwitchGiftBombs.push({
        giver,
        tier,
        expiresAt: eventTsMs + (2 * 60 * 1000)
    });
}

function isTwitchGiftSingleCoveredByBomb(event, eventTsMs) {
    cleanupRecentTwitchGiftBombs(eventTsMs);
    const tier = String(event?.details?.tier || 'other');
    const message = String(event?.message || '');
    const parsedGiver = parseGiftGiverFromMessage(message);
    const fallbackGiver = normalizePersonKey(event?.actorName || '');
    const giver = parsedGiver || fallbackGiver;
    if (!giver) return false;
    return recentTwitchGiftBombs.some((entry) => entry.giver === giver && entry.tier === tier && entry.expiresAt >= eventTsMs);
}

function normalizeYouTubeGiftSourceType(value, message = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.includes('giftmembershipreceived') || raw === 'gift_received' || raw === 'gift-received') return 'gift_received';
    if (raw.includes('membershipgifting') || raw === 'gift_summary' || raw === 'gift-summary') return 'gift_summary';

    const text = String(message || '').toLowerCase();
    if (/(gifted by|presentead[oa] por)/.test(text)) return 'gift_received';
    if (/(gift(ed|ing)?\s+\d+|presenteou\s+\d+)/.test(text)) return 'gift_summary';
    return 'gift_unknown';
}

function parseYouTubeGiftSenderFromMessage(message = '') {
    const text = String(message || '').trim();
    if (!text) return '';
    if (/(anonymous|anonimamente|an[oô]nim)/i.test(text)) return 'anonymous';

    const patterns = [
        /gifted by\s+(.+)$/i,
        /presentead[oa] por\s+(.+)$/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const sender = normalizePersonKey(String(match[1] || '').replace(/[.!,:;]+$/g, ''));
        if (sender) return sender;
    }
    return '';
}

function cleanupRecentYouTubeGiftCoverage(nowMs = Date.now()) {
    recentYouTubeGiftSummaries = recentYouTubeGiftSummaries.filter((entry) => (
        entry
        && entry.expiresAt > nowMs
        && toPositiveInt(entry.remaining, 0) > 0
    ));
    recentYouTubeGiftRecipients = recentYouTubeGiftRecipients.filter((entry) => (
        entry
        && entry.expiresAt > nowMs
        && toPositiveInt(entry.remaining, 0) > 0
    ));
}

function consumeCoverageEntries(entries, requestedCount, matcher, minTsMs = 0) {
    let remaining = Math.max(0, toPositiveInt(requestedCount, 0));
    if (!remaining) return 0;

    let consumed = 0;
    for (const entry of entries) {
        if (!entry || remaining <= 0) break;
        if (toPositiveInt(entry.remaining, 0) <= 0) continue;
        if (entry.expiresAt < minTsMs) continue;
        if (typeof matcher === 'function' && !matcher(entry)) continue;
        const take = Math.min(toPositiveInt(entry.remaining, 0), remaining);
        if (take <= 0) continue;
        entry.remaining = toPositiveInt(entry.remaining, 0) - take;
        remaining -= take;
        consumed += take;
    }
    return consumed;
}

function registerYouTubeGiftSummary(event, eventTsMs, giftedCount) {
    const count = Math.max(1, toPositiveInt(giftedCount, 1));
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    const senderFromActor = normalizePersonKey(event?.actorName || '');
    const senderFromMessage = parseYouTubeGiftSenderFromMessage(event?.message || '');
    const sender = senderFromActor || senderFromMessage;
    recentYouTubeGiftSummaries.push({
        sender,
        remaining: count,
        expiresAt: eventTsMs + YOUTUBE_GIFT_COVERAGE_MS
    });
}

function rememberYouTubeGiftRecipient(event, eventTsMs, giftedCount) {
    const count = Math.max(1, toPositiveInt(giftedCount, 1));
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    const senderFromMessage = parseYouTubeGiftSenderFromMessage(event?.message || '');
    recentYouTubeGiftRecipients.push({
        sender: senderFromMessage,
        remaining: count,
        expiresAt: eventTsMs + YOUTUBE_GIFT_COVERAGE_MS
    });
}

function consumeRecentRecipientCoverageForSummary(event, eventTsMs, giftedCount) {
    const requested = Math.max(1, toPositiveInt(giftedCount, 1));
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    const sender = normalizePersonKey(event?.actorName || '') || parseYouTubeGiftSenderFromMessage(event?.message || '');

    let consumed = 0;
    if (sender) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftRecipients,
            requested - consumed,
            (entry) => entry.sender && entry.sender === sender,
            eventTsMs - YOUTUBE_GIFT_COVERAGE_MS
        );
    }
    if (requested > consumed) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftRecipients,
            requested - consumed,
            (entry) => !entry.sender,
            eventTsMs - YOUTUBE_GIFT_COVERAGE_MS
        );
    }
    if (requested > consumed && !sender) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftRecipients,
            requested - consumed,
            () => true,
            eventTsMs - YOUTUBE_GIFT_COVERAGE_MS
        );
    }
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    return consumed;
}

function consumeRecentSummaryCoverageForRecipient(event, eventTsMs, giftedCount) {
    const requested = Math.max(1, toPositiveInt(giftedCount, 1));
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    const sender = parseYouTubeGiftSenderFromMessage(event?.message || '')
        || normalizePersonKey(event?.actorName || '');

    let consumed = 0;
    if (sender) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftSummaries,
            requested - consumed,
            (entry) => entry.sender && entry.sender === sender,
            eventTsMs
        );
    }
    if (requested > consumed) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftSummaries,
            requested - consumed,
            (entry) => !entry.sender,
            eventTsMs
        );
    }
    if (requested > consumed) {
        consumed += consumeCoverageEntries(
            recentYouTubeGiftSummaries,
            requested - consumed,
            () => true,
            eventTsMs
        );
    }
    cleanupRecentYouTubeGiftCoverage(eventTsMs);
    return consumed;
}

function normalizeTwitchTier(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'other';
    if (raw === 'prime') return 'prime';
    if (raw === '1000' || raw === 'tier 1' || raw === 'tier1') return 'tier1';
    if (raw === '2000' || raw === 'tier 2' || raw === 'tier2') return 'tier2';
    if (raw === '3000' || raw === 'tier 3' || raw === 'tier3') return 'tier3';
    return 'other';
}

function normalizeMembershipKind(kind, message = '') {
    const raw = String(kind || '').trim().toLowerCase();
    if (raw === 'new' || raw === 'milestone' || raw === 'gift' || raw === 'membership') return raw;

    const text = String(message || '').toLowerCase();
    if (/(giftmembership|membershipgifting|gift(ed)? membership|presenteou|gifted)/.test(text)) return 'gift';
    if (/(milestone|anniversary|renew|renovou|membro h[aá] \d+)/.test(text)) return 'milestone';
    if (/(new member|joined|became a member|novo membro|tornou-se membro)/.test(text)) return 'new';
    return 'membership';
}

function detectCurrencyFromText(text, hint = '') {
    const hinted = safeCurrency(hint);
    if (hinted) return hinted;

    const raw = String(text || '').trim();
    const upper = raw.toUpperCase();
    if (!upper) return '';
    if (/R\$\s?/.test(upper) || /\bBRL\b/.test(upper)) return 'BRL';
    if (/US\$\s?/.test(upper) || /\bUSD\b/.test(upper)) return 'USD';
    if (/CA\$\s?/.test(upper) || /\bCAD\b/.test(upper)) return 'CAD';
    if (/AU\$\s?/.test(upper) || /\bAUD\b/.test(upper)) return 'AUD';
    if (/€/.test(upper) || /\bEUR\b/.test(upper)) return 'EUR';
    if (/£/.test(upper) || /\bGBP\b/.test(upper)) return 'GBP';
    if (/[¥￥]/.test(upper) || /\bJPY\b/.test(upper)) return 'JPY';
    if (/\bMXN\b/.test(upper)) return 'MXN';
    if (/\bPEN\b/.test(upper)) return 'PEN';
    if (/\bARS\b/.test(upper)) return 'ARS';
    if (/\bCLP\b/.test(upper)) return 'CLP';
    if (/\$/.test(upper)) return 'USD';
    return '';
}

function parseLocalizedNumber(text) {
    const cleaned = String(text || '').replace(/[^\d.,-]/g, '').trim();
    if (!cleaned) return null;

    const negative = cleaned.startsWith('-');
    const abs = negative ? cleaned.slice(1) : cleaned;
    const lastComma = abs.lastIndexOf(',');
    const lastDot = abs.lastIndexOf('.');

    let decimalSep = '';
    if (lastComma >= 0 && lastDot >= 0) {
        decimalSep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma >= 0) {
        const digitsAfter = abs.length - lastComma - 1;
        decimalSep = digitsAfter <= 2 ? ',' : '';
    } else if (lastDot >= 0) {
        const digitsAfter = abs.length - lastDot - 1;
        decimalSep = digitsAfter <= 2 ? '.' : '';
    }

    let normalized = abs;
    if (decimalSep) {
        const thousandsSep = decimalSep === ',' ? '.' : ',';
        normalized = normalized.split(thousandsSep).join('');
        if (decimalSep === ',') normalized = normalized.replace(',', '.');
    } else {
        normalized = normalized.replace(/[.,]/g, '');
    }

    if (!normalized || normalized === '.') return null;
    const n = Number(`${negative ? '-' : ''}${normalized}`);
    if (!Number.isFinite(n)) return null;
    return n;
}

function parseMoneyStringToMinor(text, currencyHint = '') {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const currency = detectCurrencyFromText(raw, currencyHint) || 'BRL';
    const parsed = parseLocalizedNumber(raw);
    if (parsed === null) return null;
    const factor = minorFactor(currency);
    const minor = Math.round(parsed * factor);
    if (!Number.isFinite(minor) || minor <= 0) return null;
    return { currency, minor, rawText: raw };
}

function convertMinorToBrl(minor, currency) {
    const src = safeCurrency(currency) || 'BRL';
    const normalizedMinor = toPositiveInt(minor, 0);
    if (normalizedMinor <= 0) return null;
    if (src === 'BRL') {
        return { minor: normalizedMinor, rate: 1, exact: true };
    }
    const rate = Number(store?.fxRatesToBrl?.[src] ?? NaN);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const major = normalizedMinor / minorFactor(src);
    const brlMinor = Math.round(major * rate * 100);
    if (!Number.isFinite(brlMinor) || brlMinor <= 0) return null;
    return { minor: brlMinor, rate, exact: false };
}

function formatMinorAsCurrency(minor, currency = 'BRL') {
    const safe = safeCurrency(currency) || 'BRL';
    const n = toPositiveInt(minor, 0);
    const factor = minorFactor(safe);
    try {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: safe }).format(n / factor);
    } catch {
        return `${safe} ${(n / factor).toFixed(2)}`;
    }
}

function formatMinorWithCode(minor, currency = 'BRL') {
    const safe = safeCurrency(currency) || 'BRL';
    const n = toPositiveInt(minor, 0);
    const factor = minorFactor(safe);
    if (safe === 'BRL') return formatMinorAsCurrency(n, 'BRL');
    return `${(n / factor).toFixed(factor === 1 ? 0 : 2)} ${safe}`;
}

function createDonationCounter() {
    return {
        count: 0,
        totalBrlMinor: 0,
        exactBrlMinor: 0,
        convertedBrlMinor: 0,
        byCurrencyMinor: {},
        unconvertedByCurrencyMinor: {}
    };
}

function createDefaultCounters() {
    return {
        twitchSubs: {
            total: 0,
            prime: 0,
            tier1: 0,
            tier2: 0,
            tier3: 0,
            other: 0,
            gifted: 0
        },
        youtubeMembers: {
            total: 0,
            new: 0,
            milestone: 0,
            membership: 0,
            gifted: 0
        },
        youtubeTips: createDonationCounter(),
        livepixTips: createDonationCounter(),
        twitchBits: {
            total: 0
        }
    };
}

function buildSessionId() {
    return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptySession(startedAt = nowIso()) {
    return {
        id: buildSessionId(),
        startedAt,
        endedAt: '',
        updatedAt: startedAt,
        eventCount: 0,
        droppedEvents: 0,
        counters: createDefaultCounters(),
        events: []
    };
}

function createDefaultStore() {
    return {
        version: SESSION_METRICS_VERSION,
        updatedAt: nowIso(),
        currentSessionId: '',
        sessionCapturePaused: false,
        fxRatesToBrl: { ...DEFAULT_FX_TO_BRL },
        sessions: []
    };
}

function normalizeFxRates(mapLike) {
    const out = { ...DEFAULT_FX_TO_BRL };
    if (!mapLike || typeof mapLike !== 'object') return out;
    for (const [key, value] of Object.entries(mapLike)) {
        const currency = safeCurrency(key);
        const n = Number(value);
        if (!currency || !Number.isFinite(n) || n <= 0) continue;
        out[currency] = n;
    }
    return out;
}

function normalizeDonationCounter(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const byCurrencyMinor = {};
    const unconvertedByCurrencyMinor = {};

    for (const [key, value] of Object.entries(src.byCurrencyMinor || {})) {
        const currency = safeCurrency(key);
        if (!currency) continue;
        byCurrencyMinor[currency] = toPositiveInt(value, 0);
    }
    for (const [key, value] of Object.entries(src.unconvertedByCurrencyMinor || {})) {
        const currency = safeCurrency(key);
        if (!currency) continue;
        unconvertedByCurrencyMinor[currency] = toPositiveInt(value, 0);
    }

    return {
        count: toPositiveInt(src.count, 0),
        totalBrlMinor: toPositiveInt(src.totalBrlMinor, 0),
        exactBrlMinor: toPositiveInt(src.exactBrlMinor, 0),
        convertedBrlMinor: toPositiveInt(src.convertedBrlMinor, 0),
        byCurrencyMinor,
        unconvertedByCurrencyMinor
    };
}

function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const startedAt = String(raw.startedAt || '').trim() || nowIso();
    const id = String(raw.id || '').trim() || buildSessionId();

    const countersRaw = raw.counters || {};
    const counters = createDefaultCounters();
    counters.twitchSubs = {
        total: toPositiveInt(countersRaw?.twitchSubs?.total, 0),
        prime: toPositiveInt(countersRaw?.twitchSubs?.prime, 0),
        tier1: toPositiveInt(countersRaw?.twitchSubs?.tier1, 0),
        tier2: toPositiveInt(countersRaw?.twitchSubs?.tier2, 0),
        tier3: toPositiveInt(countersRaw?.twitchSubs?.tier3, 0),
        other: toPositiveInt(countersRaw?.twitchSubs?.other, 0),
        gifted: toPositiveInt(countersRaw?.twitchSubs?.gifted, 0)
    };
    counters.youtubeMembers = {
        total: toPositiveInt(countersRaw?.youtubeMembers?.total, 0),
        new: toPositiveInt(countersRaw?.youtubeMembers?.new, 0),
        milestone: toPositiveInt(countersRaw?.youtubeMembers?.milestone, 0),
        membership: toPositiveInt(countersRaw?.youtubeMembers?.membership, 0),
        gifted: toPositiveInt(countersRaw?.youtubeMembers?.gifted, 0)
    };
    counters.youtubeTips = normalizeDonationCounter(countersRaw.youtubeTips);
    counters.livepixTips = normalizeDonationCounter(countersRaw.livepixTips);
    counters.twitchBits = {
        total: toPositiveInt(countersRaw?.twitchBits?.total, 0)
    };

    const events = Array.isArray(raw.events)
        ? raw.events
            .filter((entry) => entry && typeof entry === 'object')
            .slice(-MAX_EVENTS_PER_SESSION)
            .map((entry) => ({ ...entry }))
        : [];

    return {
        id,
        startedAt,
        endedAt: String(raw.endedAt || ''),
        updatedAt: String(raw.updatedAt || startedAt),
        eventCount: toPositiveInt(raw.eventCount, events.length),
        droppedEvents: toPositiveInt(raw.droppedEvents, 0),
        counters,
        events
    };
}

function normalizeStore(raw) {
    const base = createDefaultStore();
    if (!raw || typeof raw !== 'object') return base;
    const sessions = Array.isArray(raw.sessions)
        ? raw.sessions.map(normalizeSession).filter(Boolean).slice(-MAX_SESSIONS)
        : [];
    return {
        version: SESSION_METRICS_VERSION,
        updatedAt: String(raw.updatedAt || nowIso()),
        currentSessionId: String(raw.currentSessionId || ''),
        sessionCapturePaused: raw.sessionCapturePaused === true,
        fxRatesToBrl: normalizeFxRates(raw.fxRatesToBrl),
        sessions
    };
}

function saveStore() {
    try {
        store.updatedAt = nowIso();
        writeFileAtomic(SESSION_METRICS_PATH, JSON.stringify(store, null, 2));
    } catch (err) {
        console.error('[SessionMetrics] Failed to save store:', err?.message || String(err));
    }
}

function isReplayHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.replay === true || entry?.event?.replay === true) return true;
    const platform = normalizePlatform(entry.platform || entry?.event?.platform || entry?.event?.source || '');
    if (platform === 'replay') return true;
    const source = String(entry.source || entry?.event?.source || '').toLowerCase();
    if (source === 'replay') return true;
    return false;
}

function inferPlatform(entry) {
    const explicit = normalizePlatform(entry?.platform || entry?.event?.platform || entry?.event?.source || '');
    if (explicit) return explicit;
    const listener = String(entry?.listener || '').toLowerCase();
    if (listener.startsWith('youtube')) return 'youtube';
    if (listener.startsWith('twitch')) return 'twitch';
    if (listener.startsWith('livepix') || listener === 'tip-latest') return 'livepix';
    return '';
}

function fallbackAlertId(entry) {
    const stamp = parseTimestampMs(entry?.timestamp || nowIso());
    const listener = String(entry?.listener || 'unknown');
    const name = String(entry?.event?.name || '');
    const amount = String(entry?.event?.amount || '');
    return `auto-${stamp}-${listener}-${name}-${amount}`.slice(0, 180);
}

function extractMoneyFromEvent(eventData, defaultCurrency = 'BRL') {
    const event = eventData && typeof eventData === 'object' ? eventData : {};
    const currencyHint = safeCurrency(event.currency || event.currencyCode || defaultCurrency) || safeCurrency(defaultCurrency) || 'BRL';

    const amountMicros = Number(event.amountMicros);
    if (Number.isFinite(amountMicros) && amountMicros > 0) {
        const factor = minorFactor(currencyHint);
        const major = amountMicros / 1000000;
        const minor = Math.round(major * factor);
        if (minor > 0) {
            return { currency: currencyHint, minor, rawText: String(event.amount || '') };
        }
    }

    const amountCents = Number(event.amountCents);
    if (Number.isFinite(amountCents) && amountCents > 0) {
        return { currency: currencyHint, minor: Math.round(amountCents), rawText: String(event.amount || '') };
    }

    const amountRaw = event.amount;
    if (typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0) {
        const factor = minorFactor(currencyHint);
        const minor = Math.round(amountRaw * factor);
        if (minor > 0) {
            return { currency: currencyHint, minor, rawText: String(amountRaw) };
        }
    }

    if (typeof amountRaw === 'string') {
        const parsed = parseMoneyStringToMinor(amountRaw, currencyHint);
        if (parsed) return parsed;
    }

    return null;
}

function applyDonationCounter(counter, donation) {
    if (!counter || !donation) return;
    const currency = safeCurrency(donation.currency) || 'BRL';
    const minor = toPositiveInt(donation.minor, 0);
    if (minor <= 0) return;

    counter.count += 1;
    counter.byCurrencyMinor[currency] = toPositiveInt(counter.byCurrencyMinor[currency], 0) + minor;

    const converted = convertMinorToBrl(minor, currency);
    if (currency === 'BRL') {
        counter.exactBrlMinor += minor;
        counter.totalBrlMinor += minor;
    } else if (converted && converted.minor > 0) {
        counter.convertedBrlMinor += converted.minor;
        counter.totalBrlMinor += converted.minor;
    } else {
        counter.unconvertedByCurrencyMinor[currency] = toPositiveInt(counter.unconvertedByCurrencyMinor[currency], 0) + minor;
    }
}

function buildAnalyticsEventFromHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.origin === 'test') return null;
    if (isReplayHistoryEntry(entry)) return null;

    const platform = inferPlatform(entry);
    const type = String(entry.type || '').toLowerCase();
    const eventData = entry.event && typeof entry.event === 'object' ? entry.event : {};
    const timestamp = String(entry.timestamp || nowIso());
    const alertId = String(entry.id || '').trim() || fallbackAlertId(entry);

    if (platform === 'twitch' && type === 'sub') {
        const tier = normalizeTwitchTier(eventData.tier);
        const fallbackCount = eventData.isGift === true ? Math.max(1, toPositiveInt(eventData.amount, 1)) : 1;
        const subscriptionCount = Math.max(1, toPositiveInt(eventData.subscriptionCount, fallbackCount));
        const message = String(eventData.message || '').trim();
        const isGift = eventData.isGift === true || /gift/i.test(message) || /gift/i.test(String(eventData.giftKind || ''));
        return {
            id: `evt-${alertId}`,
            alertId,
            timestamp,
            platform,
            category: 'twitch_sub',
            actorName: String(eventData.name || ''),
            message,
            details: {
                tier,
                subscriptionCount,
                isGift,
                giftKind: String(eventData.giftKind || '').trim().toLowerCase()
            }
        };
    }

    if (platform === 'youtube' && type === 'sub') {
        const message = String(eventData.message || '').trim();
        const membershipKind = normalizeMembershipKind(eventData.membershipKind, message);
        const membershipSourceType = normalizeYouTubeGiftSourceType(
            eventData.membershipSourceType || eventData.membershipEventType || '',
            message
        );
        const memberCount = membershipKind === 'gift'
            ? 0
            : Math.max(1, toPositiveInt(eventData.memberCount, 1));
        const giftedCount = membershipKind === 'gift'
            ? Math.max(1, toPositiveInt(eventData.giftedCount, toPositiveInt(eventData.amount, 1)))
            : 0;
        return {
            id: `evt-${alertId}`,
            alertId,
            timestamp,
            platform,
            category: 'youtube_member',
            actorName: String(eventData.name || ''),
            message,
            details: {
                membershipKind,
                membershipSourceType,
                memberCount,
                giftedCount
            }
        };
    }

    if (platform === 'youtube' && type === 'tip') {
        const donation = extractMoneyFromEvent(eventData, 'BRL');
        return {
            id: `evt-${alertId}`,
            alertId,
            timestamp,
            platform,
            category: 'youtube_tip',
            actorName: String(eventData.name || ''),
            message: String(eventData.message || '').trim(),
            details: {
                donation,
                amountText: String(eventData.amount || '').trim()
            }
        };
    }

    if (platform === 'livepix' && type === 'tip') {
        const donation = extractMoneyFromEvent(eventData, 'BRL');
        return {
            id: `evt-${alertId}`,
            alertId,
            timestamp,
            platform,
            category: 'livepix_tip',
            actorName: String(eventData.name || ''),
            message: String(eventData.message || '').trim(),
            details: {
                donation,
                amountText: String(eventData.amount || '').trim()
            }
        };
    }

    if (platform === 'twitch' && type === 'cheer') {
        const bits = toPositiveInt(eventData.amount, 0);
        if (bits <= 0) return null;
        return {
            id: `evt-${alertId}`,
            alertId,
            timestamp,
            platform,
            category: 'twitch_bits',
            actorName: String(eventData.name || ''),
            message: String(eventData.message || '').trim(),
            details: { bits }
        };
    }

    return null;
}

function getCurrentSession() {
    const currentId = String(store.currentSessionId || '').trim();
    if (currentId) {
        const found = store.sessions.find((session) => session.id === currentId);
        if (found) return found;
    }
    if (store.sessions.length) {
        const latest = store.sessions[store.sessions.length - 1];
        store.currentSessionId = latest.id;
        return latest;
    }
    return null;
}

function rebuildCurrentSessionEventIds() {
    currentSessionEventIds = new Set();
    const session = getCurrentSession();
    if (!session) return;
    for (const evt of session.events || []) {
        const id = String(evt?.alertId || '').trim();
        if (id) currentSessionEventIds.add(id);
    }
}

function emitSummaryUpdate() {
    try {
        if (!ctx.io) return;
        const nsp = ctx.io.of('/admin');
        if (!nsp) return;
        nsp.emit('session-summary-update', getCurrentSessionSummary());
        require('./services/overlay').emitState();
    } catch (err) {
        console.error('[SessionMetrics] Failed to emit summary update:', err?.message || String(err));
    }
}

function ensureCurrentSession({ persist = false } = {}) {
    let session = getCurrentSession();
    if (session) {
        rebuildCurrentSessionEventIds();
        return session;
    }
    session = createEmptySession(nowIso());
    store.sessions.push(session);
    store.currentSessionId = session.id;
    if (store.sessions.length > MAX_SESSIONS) {
        store.sessions.splice(0, store.sessions.length - MAX_SESSIONS);
    }
    rebuildCurrentSessionEventIds();
    if (persist) saveStore();
    return session;
}

function maybeRotateSessionOnIdleGap(session, analyticsEvent, { persist = false } = {}) {
    if (!session) return ensureCurrentSession({ persist });
    if (toPositiveInt(session.eventCount, 0) <= 0) return session;

    const lastActivityTs = parseTimestampMs(session.updatedAt || session.startedAt);
    const incomingEventTs = parseTimestampMs(analyticsEvent?.timestamp || '');
    if (!lastActivityTs || !incomingEventTs) return session;
    if (incomingEventTs <= lastActivityTs) return session;
    if ((incomingEventTs - lastActivityTs) < SESSION_IDLE_GAP_MS) return session;

    return startNewSession({
        reason: 'idle-gap',
        persist,
        startedAt: analyticsEvent?.timestamp || ''
    });
}

function startNewSession({ reason = 'manual', persist = true, startedAt = '' } = {}) {
    const previous = getCurrentSession();
    const startMs = parseTimestampMs(startedAt);
    const sessionStartAt = startMs ? new Date(startMs).toISOString() : nowIso();
    if (previous && !previous.endedAt) {
        previous.endedAt = sessionStartAt;
        previous.updatedAt = sessionStartAt;
    }

    const next = createEmptySession(sessionStartAt);
    next.reason = String(reason || 'manual');
    store.sessions.push(next);
    if (store.sessions.length > MAX_SESSIONS) {
        store.sessions.splice(0, store.sessions.length - MAX_SESSIONS);
    }
    store.currentSessionId = next.id;
    store.sessionCapturePaused = false;
    rebuildCurrentSessionEventIds();
    resetTransientCoverageCaches();
    if (persist) {
        saveStore();
        emitSummaryUpdate();
    }
    return next;
}

function endCurrentSession({ reason = 'manual', persist = true, endedAt = '' } = {}) {
    const session = ensureCurrentSession({ persist: false });
    if (!session) return null;

    const endMs = parseTimestampMs(endedAt);
    const sessionEndAt = endMs ? new Date(endMs).toISOString() : nowIso();
    session.endedAt = sessionEndAt;
    session.updatedAt = sessionEndAt;
    session.endReason = String(reason || 'manual');
    store.sessionCapturePaused = true;
    resetTransientCoverageCaches();

    if (persist) {
        saveStore();
        emitSummaryUpdate();
    }
    return session;
}

function recordAlertHistoryEntry(entry, options = {}) {
    const persist = options.persist !== false;
    const emit = options.emit !== false;
    const analyticsEvent = buildAnalyticsEventFromHistoryEntry(entry);
    if (!analyticsEvent) return false;
    if (store.sessionCapturePaused === true) return false;

    let session = ensureCurrentSession({ persist: false });
    if (!session) return false;
    session = maybeRotateSessionOnIdleGap(session, analyticsEvent, { persist: false });
    if (!session) return false;

    const alertId = String(analyticsEvent.alertId || '').trim();
    if (alertId && currentSessionEventIds.has(alertId)) return false;
    if (alertId) currentSessionEventIds.add(alertId);

    const category = analyticsEvent.category;
    if (category === 'twitch_sub') {
        const eventTsMs = parseTimestampMs(analyticsEvent.timestamp) || Date.now();
        const count = Math.max(1, toPositiveInt(analyticsEvent.details?.subscriptionCount, 1));
        const tier = String(analyticsEvent.details?.tier || 'other');
        const isGift = analyticsEvent.details?.isGift === true;
        const giftKind = String(analyticsEvent.details?.giftKind || '').toLowerCase();

        if (isGift && giftKind.includes('bomb')) {
            registerTwitchGiftBomb(analyticsEvent, eventTsMs);
        } else if (isGift && isTwitchGiftSingleCoveredByBomb(analyticsEvent, eventTsMs)) {
            return false;
        }

        session.counters.twitchSubs.total += count;
        if (tier === 'prime') session.counters.twitchSubs.prime += count;
        else if (tier === 'tier1') session.counters.twitchSubs.tier1 += count;
        else if (tier === 'tier2') session.counters.twitchSubs.tier2 += count;
        else if (tier === 'tier3') session.counters.twitchSubs.tier3 += count;
        else session.counters.twitchSubs.other += count;
        if (isGift) session.counters.twitchSubs.gifted += count;
    } else if (category === 'youtube_member') {
        const kind = String(analyticsEvent.details?.membershipKind || 'membership');
        const memberCount = toPositiveInt(analyticsEvent.details?.memberCount, 0);
        const giftedCount = toPositiveInt(analyticsEvent.details?.giftedCount, 0);
        if (kind === 'gift') {
            const eventTsMs = parseTimestampMs(analyticsEvent.timestamp) || Date.now();
            const sourceType = normalizeYouTubeGiftSourceType(
                analyticsEvent.details?.membershipSourceType || '',
                analyticsEvent.message || ''
            );
            const requestedGifted = giftedCount || 1;

            if (sourceType === 'gift_received') {
                const covered = consumeRecentSummaryCoverageForRecipient(analyticsEvent, eventTsMs, requestedGifted);
                const remainingToCount = Math.max(0, requestedGifted - covered);
                if (remainingToCount <= 0) return false;
                session.counters.youtubeMembers.gifted += remainingToCount;
                rememberYouTubeGiftRecipient(analyticsEvent, eventTsMs, remainingToCount);
            } else {
                const coveredByPriorRecipients = consumeRecentRecipientCoverageForSummary(analyticsEvent, eventTsMs, requestedGifted);
                const summaryCountToAdd = Math.max(0, requestedGifted - coveredByPriorRecipients);
                if (summaryCountToAdd <= 0) return false;
                session.counters.youtubeMembers.gifted += summaryCountToAdd;
                registerYouTubeGiftSummary(analyticsEvent, eventTsMs, summaryCountToAdd);
            }
        } else {
            const count = memberCount || 1;
            session.counters.youtubeMembers.total += count;
            if (kind === 'new') session.counters.youtubeMembers.new += count;
            else if (kind === 'milestone') session.counters.youtubeMembers.milestone += count;
            else session.counters.youtubeMembers.membership += count;
        }
    } else if (category === 'youtube_tip') {
        applyDonationCounter(session.counters.youtubeTips, analyticsEvent.details?.donation);
    } else if (category === 'livepix_tip') {
        applyDonationCounter(session.counters.livepixTips, analyticsEvent.details?.donation);
    } else if (category === 'twitch_bits') {
        const bits = toPositiveInt(analyticsEvent.details?.bits, 0);
        session.counters.twitchBits.total += bits;
    }

    session.events.push(analyticsEvent);
    if (session.events.length > MAX_EVENTS_PER_SESSION) {
        session.events.shift();
        session.droppedEvents += 1;
    }
    session.eventCount += 1;
    const eventMs = parseTimestampMs(analyticsEvent.timestamp);
    session.updatedAt = eventMs ? new Date(eventMs).toISOString() : nowIso();

    if (persist) saveStore();
    if (emit) emitSummaryUpdate();
    return true;
}

function sortedCurrencyRows(mapLike = {}) {
    return Object.entries(mapLike)
        .map(([currency, minor]) => ({
            currency: safeCurrency(currency),
            minor: toPositiveInt(minor, 0)
        }))
        .filter((row) => row.currency && row.minor > 0)
        .sort((a, b) => b.minor - a.minor)
        .map((row) => ({
            ...row,
            display: formatMinorWithCode(row.minor, row.currency)
        }));
}

function buildDonationSummary(counter) {
    const byCurrency = sortedCurrencyRows(counter.byCurrencyMinor || {});
    const unconverted = sortedCurrencyRows(counter.unconvertedByCurrencyMinor || {});
    return {
        count: toPositiveInt(counter.count, 0),
        totalBrlMinor: toPositiveInt(counter.totalBrlMinor, 0),
        totalBrlDisplay: formatMinorAsCurrency(counter.totalBrlMinor, 'BRL'),
        exactBrlMinor: toPositiveInt(counter.exactBrlMinor, 0),
        convertedBrlMinor: toPositiveInt(counter.convertedBrlMinor, 0),
        byCurrency,
        unconverted,
        hasConversionEstimate: toPositiveInt(counter.convertedBrlMinor, 0) > 0,
        hasUnconverted: unconverted.length > 0
    };
}

function getCurrentSessionSummary() {
    const session = ensureCurrentSession({ persist: false });
    const isActive = store.sessionCapturePaused !== true && !String(session.endedAt || '').trim();
    const twitchSubs = session.counters.twitchSubs;
    const youtubeMembers = session.counters.youtubeMembers;
    const youtubeTips = buildDonationSummary(session.counters.youtubeTips);
    const livepixTips = buildDonationSummary(session.counters.livepixTips);
    const twitchBits = {
        total: toPositiveInt(session.counters?.twitchBits?.total, 0),
        display: `${toPositiveInt(session.counters?.twitchBits?.total, 0).toLocaleString('pt-BR')} bits`
    };

    return {
        session: {
            id: session.id,
            startedAt: session.startedAt,
            endedAt: session.endedAt || '',
            updatedAt: session.updatedAt,
            eventCount: toPositiveInt(session.eventCount, 0),
            droppedEvents: toPositiveInt(session.droppedEvents, 0),
            isActive
        },
        metrics: {
            twitchSubs: {
                ...twitchSubs,
                breakdownLabel: `Prime ${twitchSubs.prime} · T1 ${twitchSubs.tier1} · T2 ${twitchSubs.tier2} · T3 ${twitchSubs.tier3}`
            },
            youtubeMembers: {
                ...youtubeMembers,
                breakdownLabel: `Novos ${youtubeMembers.new} · Marco ${youtubeMembers.milestone} · Recorrentes ${youtubeMembers.membership} · Presentes ${youtubeMembers.gifted}`
            },
            youtubeTips,
            livepixTips,
            twitchBits
        },
        fxRatesToBrl: { ...store.fxRatesToBrl },
        generatedAt: nowIso()
    };
}

function toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const f = Number(fallback);
    return Number.isFinite(f) ? f : 0;
}

function clampNumber(value, min, max) {
    const n = toFiniteNumber(value, min);
    return Math.max(min, Math.min(max, n));
}

function normalizeAnalyticsPeriod(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (ANALYTICS_PERIODS.has(raw)) return raw;
    return 'last_session';
}

function normalizeAnalyticsPlatform(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (ANALYTICS_PLATFORMS.has(raw)) return raw;
    return 'all';
}

function normalizeAnalyticsBucketUnit(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (ANALYTICS_BUCKET_UNITS.has(raw)) return raw;
    return '';
}

function normalizeTimezoneOffsetMin(value) {
    const n = Math.round(toFiniteNumber(value, 0));
    return clampNumber(n, -14 * 60, 14 * 60);
}

function shiftMsByOffset(ms, tzOffsetMin) {
    return ms + (tzOffsetMin * 60 * 1000);
}

function unshiftMsByOffset(ms, tzOffsetMin) {
    return ms - (tzOffsetMin * 60 * 1000);
}

function toOffsetDate(ms, tzOffsetMin) {
    return new Date(shiftMsByOffset(ms, tzOffsetMin));
}

function startOfOffsetHour(ms, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    d.setUTCMinutes(0, 0, 0);
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function startOfOffsetDay(ms, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    d.setUTCHours(0, 0, 0, 0);
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function startOfOffsetWeek(ms, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    const day = d.getUTCDay(); // 0=Sun
    const daysSinceMonday = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - daysSinceMonday);
    d.setUTCHours(0, 0, 0, 0);
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function startOfOffsetMonth(ms, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function startOfOffsetYear(ms, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    d.setUTCMonth(0, 1);
    d.setUTCHours(0, 0, 0, 0);
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function addOffsetBucketUnit(ms, bucketUnit, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    if (bucketUnit === 'hour') {
        d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
    } else if (bucketUnit === 'day') {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(0, 0, 0, 0);
    } else if (bucketUnit === 'week') {
        d.setUTCDate(d.getUTCDate() + 7);
        d.setUTCHours(0, 0, 0, 0);
    } else {
        d.setUTCMonth(d.getUTCMonth() + 1, 1);
        d.setUTCHours(0, 0, 0, 0);
    }
    return unshiftMsByOffset(d.getTime(), tzOffsetMin);
}

function startOfBucketByUnit(ms, bucketUnit, tzOffsetMin) {
    if (bucketUnit === 'hour') return startOfOffsetHour(ms, tzOffsetMin);
    if (bucketUnit === 'day') return startOfOffsetDay(ms, tzOffsetMin);
    if (bucketUnit === 'week') return startOfOffsetWeek(ms, tzOffsetMin);
    return startOfOffsetMonth(ms, tzOffsetMin);
}

function chooseBucketUnit(spanMs, period = '') {
    const rawSpan = Math.max(0, toFiniteNumber(spanMs, 0));
    if (period === 'day') return 'hour';
    if (period === 'week') return 'day';
    if (period === 'month') return 'day';
    if (period === 'year') return 'month';
    if (rawSpan <= 2 * 24 * 60 * 60 * 1000) return 'hour';
    if (rawSpan <= 80 * 24 * 60 * 60 * 1000) return 'day';
    if (rawSpan <= 450 * 24 * 60 * 60 * 1000) return 'week';
    return 'month';
}

function parseCustomDateInputToMs(value, tzOffsetMin, endOfDay = false) {
    const raw = String(value || '').trim();
    if (!raw) return 0;

    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
        const utcMs = Date.UTC(
            year,
            Math.max(0, Math.min(11, month - 1)),
            Math.max(1, Math.min(31, day)),
            endOfDay ? 23 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 59 : 0,
            endOfDay ? 999 : 0
        );
        return unshiftMsByOffset(utcMs, tzOffsetMin);
    }

    return parseTimestampMs(raw);
}

function formatBucketLabel(ms, bucketUnit, tzOffsetMin) {
    const d = toOffsetDate(ms, tzOffsetMin);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const monthShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][d.getUTCMonth()];

    if (bucketUnit === 'hour') return `${hh}h`;
    if (bucketUnit === 'day') return `${dd}/${mm}`;
    if (bucketUnit === 'week') return `Sem ${dd}/${mm}`;
    return `${monthShort}/${yy}`;
}

function buildBucketSeriesSkeleton(startMs, endMs, bucketUnit, tzOffsetMin) {
    const out = [];
    let cursor = startOfBucketByUnit(startMs, bucketUnit, tzOffsetMin);
    let guard = 0;
    while (cursor <= endMs && guard < 2200) {
        guard += 1;
        const next = addOffsetBucketUnit(cursor, bucketUnit, tzOffsetMin);
        out.push({
            key: String(cursor),
            label: formatBucketLabel(cursor, bucketUnit, tzOffsetMin),
            startAt: new Date(cursor).toISOString(),
            endAt: new Date(Math.min(endMs, next - 1)).toISOString(),
            revenueBrlMinor: 0,
            tipCount: 0,
            twitchSubs: 0,
            youtubeMembers: 0,
            twitchBits: 0,
            byPlatformRevenueMinor: {
                youtube: 0,
                twitch: 0,
                livepix: 0
            }
        });
        cursor = next;
    }
    if (!out.length) {
        out.push({
            key: String(startMs),
            label: formatBucketLabel(startMs, bucketUnit, tzOffsetMin),
            startAt: new Date(startMs).toISOString(),
            endAt: new Date(endMs).toISOString(),
            revenueBrlMinor: 0,
            tipCount: 0,
            twitchSubs: 0,
            youtubeMembers: 0,
            twitchBits: 0,
            byPlatformRevenueMinor: {
                youtube: 0,
                twitch: 0,
                livepix: 0
            }
        });
    }
    return out;
}

function platformMatchesFilter(platform, platformFilter) {
    if (platformFilter === 'all') return true;
    return platform === platformFilter;
}

function extractDonationFromAnalyticsEvent(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.category !== 'youtube_tip' && event.category !== 'livepix_tip') return null;

    const details = event.details && typeof event.details === 'object' ? event.details : {};
    const direct = details.donation && typeof details.donation === 'object' ? details.donation : null;
    if (direct) {
        const currency = safeCurrency(direct.currency) || 'BRL';
        const minor = toPositiveInt(direct.minor, 0);
        if (minor > 0) {
            const converted = convertMinorToBrl(minor, currency);
            return {
                currency,
                sourceMinor: minor,
                brlMinor: converted?.minor ? toPositiveInt(converted.minor, 0) : 0,
                converted: !!(converted && currency !== 'BRL'),
                hasConversionRate: !!converted
            };
        }
    }

    const amountText = String(details.amountText || '').trim();
    if (!amountText) return null;
    const parsed = parseMoneyStringToMinor(amountText, 'BRL');
    if (!parsed) return null;
    const converted = convertMinorToBrl(parsed.minor, parsed.currency);
    return {
        currency: safeCurrency(parsed.currency) || 'BRL',
        sourceMinor: toPositiveInt(parsed.minor, 0),
        brlMinor: converted?.minor ? toPositiveInt(converted.minor, 0) : 0,
        converted: !!(converted && parsed.currency !== 'BRL'),
        hasConversionRate: !!converted
    };
}

function createAnalyticsAccumulator({ includeSupporters = false } = {}) {
    return {
        eventCount: 0,
        revenueBrlMinor: 0,
        tipCount: 0,
        youtubeTipCount: 0,
        livepixTipCount: 0,
        twitchSubs: 0,
        twitchSubsGifted: 0,
        youtubeMembers: 0,
        youtubeMembersGifted: 0,
        twitchBits: 0,
        byPlatformRevenueMinor: {
            youtube: 0,
            twitch: 0,
            livepix: 0
        },
        byPlatformEventCount: {
            youtube: 0,
            twitch: 0,
            livepix: 0
        },
        byCurrencyMinor: {},
        byCurrencyCount: {},
        unconvertedByCurrencyMinor: {},
        supporters: includeSupporters ? new Map() : null
    };
}

function applyAnalyticsEventToAccumulator(acc, event, eventTsMs) {
    if (!acc || !event || !eventTsMs) return;
    const platform = normalizePlatform(event.platform || '');
    if (platform && platform !== 'replay') {
        acc.byPlatformEventCount[platform] = toPositiveInt(acc.byPlatformEventCount[platform], 0) + 1;
    }
    acc.eventCount += 1;

    if (event.category === 'twitch_sub') {
        const count = Math.max(1, toPositiveInt(event.details?.subscriptionCount, 1));
        const isGift = event.details?.isGift === true;
        acc.twitchSubs += count;
        if (isGift) acc.twitchSubsGifted += count;
        return;
    }

    if (event.category === 'youtube_member') {
        const kind = String(event.details?.membershipKind || 'membership');
        const memberCount = toPositiveInt(event.details?.memberCount, 0);
        const giftedCount = toPositiveInt(event.details?.giftedCount, 0);
        if (kind === 'gift') {
            acc.youtubeMembersGifted += (giftedCount || 1);
        } else {
            acc.youtubeMembers += (memberCount || 1);
        }
        return;
    }

    if (event.category === 'twitch_bits') {
        const bits = toPositiveInt(event.details?.bits, 0);
        acc.twitchBits += bits;
        return;
    }

    if (event.category !== 'youtube_tip' && event.category !== 'livepix_tip') {
        return;
    }

    acc.tipCount += 1;
    if (event.category === 'youtube_tip') acc.youtubeTipCount += 1;
    if (event.category === 'livepix_tip') acc.livepixTipCount += 1;

    const donation = extractDonationFromAnalyticsEvent(event);
    if (!donation) return;

    const platformKey = platform || (event.category === 'youtube_tip' ? 'youtube' : 'livepix');
    const sourceCurrency = safeCurrency(donation.currency) || 'BRL';
    const sourceMinor = toPositiveInt(donation.sourceMinor, 0);
    const brlMinor = toPositiveInt(donation.brlMinor, 0);
    if (sourceMinor > 0) {
        acc.byCurrencyMinor[sourceCurrency] = toPositiveInt(acc.byCurrencyMinor[sourceCurrency], 0) + sourceMinor;
        acc.byCurrencyCount[sourceCurrency] = toPositiveInt(acc.byCurrencyCount[sourceCurrency], 0) + 1;
    }

    if (brlMinor > 0) {
        acc.revenueBrlMinor += brlMinor;
        acc.byPlatformRevenueMinor[platformKey] = toPositiveInt(acc.byPlatformRevenueMinor[platformKey], 0) + brlMinor;
    } else if (sourceMinor > 0) {
        acc.unconvertedByCurrencyMinor[sourceCurrency] = toPositiveInt(acc.unconvertedByCurrencyMinor[sourceCurrency], 0) + sourceMinor;
    }

    if (!acc.supporters || brlMinor <= 0) return;
    const actor = String(event.actorName || '').trim() || 'Anonymous';
    const supporterKey = `${platformKey}|${actor.toLowerCase()}`;
    const current = acc.supporters.get(supporterKey) || {
        name: actor,
        platform: platformKey,
        revenueBrlMinor: 0,
        donationCount: 0,
        lastAt: ''
    };
    current.revenueBrlMinor += brlMinor;
    current.donationCount += 1;
    current.lastAt = new Date(eventTsMs).toISOString();
    acc.supporters.set(supporterKey, current);
}

function sortedCurrencyAnalyticsRows(minorMap = {}, countMap = {}) {
    return Object.entries(minorMap)
        .map(([currency, minor]) => ({
            currency: safeCurrency(currency),
            sourceMinor: toPositiveInt(minor, 0),
            count: toPositiveInt(countMap[currency], 0)
        }))
        .filter((row) => row.currency && row.sourceMinor > 0)
        .sort((a, b) => b.sourceMinor - a.sourceMinor)
        .map((row) => ({
            ...row,
            sourceDisplay: formatMinorWithCode(row.sourceMinor, row.currency)
        }));
}

function finalizeAnalyticsAccumulator(acc) {
    const byCurrency = sortedCurrencyAnalyticsRows(acc.byCurrencyMinor, acc.byCurrencyCount);
    const unconverted = sortedCurrencyAnalyticsRows(acc.unconvertedByCurrencyMinor, {});
    const supporterRows = acc.supporters instanceof Map
        ? [...acc.supporters.values()]
            .sort((a, b) => b.revenueBrlMinor - a.revenueBrlMinor)
            .map((row) => ({
                ...row,
                revenueDisplay: formatMinorAsCurrency(row.revenueBrlMinor, 'BRL')
            }))
        : [];

    return {
        eventCount: toPositiveInt(acc.eventCount, 0),
        revenueBrlMinor: toPositiveInt(acc.revenueBrlMinor, 0),
        revenueDisplay: formatMinorAsCurrency(acc.revenueBrlMinor, 'BRL'),
        tipCount: toPositiveInt(acc.tipCount, 0),
        youtubeTipCount: toPositiveInt(acc.youtubeTipCount, 0),
        livepixTipCount: toPositiveInt(acc.livepixTipCount, 0),
        twitchSubs: toPositiveInt(acc.twitchSubs, 0),
        twitchSubsGifted: toPositiveInt(acc.twitchSubsGifted, 0),
        youtubeMembers: toPositiveInt(acc.youtubeMembers, 0),
        youtubeMembersGifted: toPositiveInt(acc.youtubeMembersGifted, 0),
        twitchBits: toPositiveInt(acc.twitchBits, 0),
        byPlatformRevenueMinor: {
            youtube: toPositiveInt(acc.byPlatformRevenueMinor.youtube, 0),
            twitch: toPositiveInt(acc.byPlatformRevenueMinor.twitch, 0),
            livepix: toPositiveInt(acc.byPlatformRevenueMinor.livepix, 0)
        },
        byPlatformEventCount: {
            youtube: toPositiveInt(acc.byPlatformEventCount.youtube, 0),
            twitch: toPositiveInt(acc.byPlatformEventCount.twitch, 0),
            livepix: toPositiveInt(acc.byPlatformEventCount.livepix, 0)
        },
        byCurrency,
        unconverted,
        topSupporters: supporterRows
    };
}

function buildAnalyticsEventsFlat() {
    const events = [];
    for (const session of store.sessions || []) {
        if (!session || typeof session !== 'object') continue;
        const sessionId = String(session.id || '').trim();
        for (const evt of session.events || []) {
            if (!evt || typeof evt !== 'object') continue;
            const ts = parseTimestampMs(evt.timestamp);
            if (!ts) continue;
            events.push({
                ...evt,
                _timestampMs: ts,
                _sessionId: sessionId
            });
        }
    }
    events.sort((a, b) => a._timestampMs - b._timestampMs);
    return events;
}

function resolveLastSessionRange(nowMs = Date.now()) {
    const sessions = Array.isArray(store.sessions) ? [...store.sessions] : [];
    sessions.sort((a, b) => parseTimestampMs(b?.startedAt || '') - parseTimestampMs(a?.startedAt || ''));

    for (const session of sessions) {
        if (!session || typeof session !== 'object') continue;
        const startMs = parseTimestampMs(session.startedAt);
        if (!startMs) continue;

        const isActive = (
            String(store.currentSessionId || '') === String(session.id || '')
            && store.sessionCapturePaused !== true
            && !String(session.endedAt || '').trim()
        );

        const endedMs = parseTimestampMs(session.endedAt);
        const endMs = isActive ? nowMs : (endedMs || startMs);
        return {
            startMs,
            endMs: Math.max(startMs, Math.min(endMs, nowMs))
        };
    }

    return null;
}

function resolveAnalyticsRange(query = {}, events = []) {
    const nowMs = Date.now();
    const tzOffsetMin = normalizeTimezoneOffsetMin(query.tzOffsetMin);
    const period = normalizeAnalyticsPeriod(query.period);
    const earliestEventMs = events.length
        ? events.reduce((min, evt) => Math.min(min, evt._timestampMs), Number.MAX_SAFE_INTEGER)
        : 0;
    const fallbackStart = startOfOffsetMonth(nowMs, tzOffsetMin);

    let startMs = fallbackStart;
    let endMs = nowMs;
    if (period === 'day') {
        startMs = startOfOffsetDay(nowMs, tzOffsetMin);
    } else if (period === 'week') {
        startMs = startOfOffsetWeek(nowMs, tzOffsetMin);
    } else if (period === 'month') {
        startMs = startOfOffsetMonth(nowMs, tzOffsetMin);
    } else if (period === 'year') {
        startMs = startOfOffsetYear(nowMs, tzOffsetMin);
    } else if (period === 'lifetime') {
        startMs = earliestEventMs || fallbackStart;
    } else if (period === 'last_session') {
        const lastSessionRange = resolveLastSessionRange(nowMs);
        if (lastSessionRange) {
            startMs = lastSessionRange.startMs;
            endMs = lastSessionRange.endMs;
        }
    } else if (period === 'custom') {
        const customStart = parseCustomDateInputToMs(query.from, tzOffsetMin, false);
        const customEnd = parseCustomDateInputToMs(query.to, tzOffsetMin, true);
        startMs = customStart || fallbackStart;
        endMs = customEnd || nowMs;
    }

    if (!Number.isFinite(startMs) || startMs <= 0) startMs = fallbackStart;
    if (!Number.isFinite(endMs) || endMs <= 0) endMs = nowMs;
    if (endMs < startMs) {
        const swap = endMs;
        endMs = startMs;
        startMs = swap;
    }
    if (period === 'custom' || period === 'last_session') {
        endMs = Math.min(endMs, nowMs);
    } else {
        endMs = nowMs;
    }

    const requestedBucket = normalizeAnalyticsBucketUnit(query.bucket);
    const spanMs = Math.max(1, endMs - startMs);
    const bucketUnit = requestedBucket || chooseBucketUnit(spanMs, period);
    return {
        period,
        startMs,
        endMs,
        tzOffsetMin,
        bucketUnit
    };
}

function aggregateAnalyticsRange(events, options = {}) {
    const startMs = toFiniteNumber(options.startMs, 0);
    const endMs = toFiniteNumber(options.endMs, Date.now());
    const platformFilter = normalizeAnalyticsPlatform(options.platform);
    const includeSupporters = options.includeSupporters === true;
    const acc = createAnalyticsAccumulator({ includeSupporters });

    for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        const ts = toFiniteNumber(event._timestampMs, 0);
        if (!ts || ts < startMs || ts > endMs) continue;
        const platform = normalizePlatform(event.platform || '');
        if (!platformMatchesFilter(platform, platformFilter)) continue;
        applyAnalyticsEventToAccumulator(acc, event, ts);
    }

    return finalizeAnalyticsAccumulator(acc);
}

function buildAnalyticsSeries(events, range, platformFilter) {
    const buckets = buildBucketSeriesSkeleton(range.startMs, range.endMs, range.bucketUnit, range.tzOffsetMin);
    const bucketMap = new Map();
    for (const bucket of buckets) {
        bucketMap.set(bucket.key, bucket);
    }

    for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        const ts = toFiniteNumber(event._timestampMs, 0);
        if (!ts || ts < range.startMs || ts > range.endMs) continue;
        const platform = normalizePlatform(event.platform || '');
        if (!platformMatchesFilter(platform, platformFilter)) continue;

        const bucketStartMs = startOfBucketByUnit(ts, range.bucketUnit, range.tzOffsetMin);
        const bucket = bucketMap.get(String(bucketStartMs));
        if (!bucket) continue;

        if (event.category === 'twitch_sub') {
            bucket.twitchSubs += Math.max(1, toPositiveInt(event.details?.subscriptionCount, 1));
            continue;
        }
        if (event.category === 'youtube_member') {
            const kind = String(event.details?.membershipKind || 'membership');
            if (kind === 'gift') {
                bucket.youtubeMembers += Math.max(1, toPositiveInt(event.details?.giftedCount, 1));
            } else {
                bucket.youtubeMembers += Math.max(1, toPositiveInt(event.details?.memberCount, 1));
            }
            continue;
        }
        if (event.category === 'twitch_bits') {
            bucket.twitchBits += toPositiveInt(event.details?.bits, 0);
            continue;
        }
        if (event.category === 'youtube_tip' || event.category === 'livepix_tip') {
            bucket.tipCount += 1;
            const donation = extractDonationFromAnalyticsEvent(event);
            if (!donation) continue;
            const platformKey = platform || (event.category === 'youtube_tip' ? 'youtube' : 'livepix');
            const brlMinor = toPositiveInt(donation.brlMinor, 0);
            if (brlMinor <= 0) continue;
            bucket.revenueBrlMinor += brlMinor;
            bucket.byPlatformRevenueMinor[platformKey] = toPositiveInt(bucket.byPlatformRevenueMinor[platformKey], 0) + brlMinor;
        }
    }

    const revenueSeries = buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        startAt: bucket.startAt,
        endAt: bucket.endAt,
        revenueBrlMinor: toPositiveInt(bucket.revenueBrlMinor, 0),
        revenueDisplay: formatMinorAsCurrency(bucket.revenueBrlMinor, 'BRL'),
        byPlatformRevenueMinor: {
            youtube: toPositiveInt(bucket.byPlatformRevenueMinor.youtube, 0),
            twitch: toPositiveInt(bucket.byPlatformRevenueMinor.twitch, 0),
            livepix: toPositiveInt(bucket.byPlatformRevenueMinor.livepix, 0)
        }
    }));

    const monetizationSeries = buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        tipCount: toPositiveInt(bucket.tipCount, 0),
        twitchSubs: toPositiveInt(bucket.twitchSubs, 0),
        youtubeMembers: toPositiveInt(bucket.youtubeMembers, 0),
        twitchBits: toPositiveInt(bucket.twitchBits, 0)
    }));

    return {
        revenueSeries,
        monetizationSeries
    };
}

function buildAnalyticsPresetWindows(events, platformFilter, tzOffsetMin) {
    const nowMs = Date.now();
    const earliestEventMs = events.length
        ? events.reduce((min, evt) => Math.min(min, evt._timestampMs), Number.MAX_SAFE_INTEGER)
        : startOfOffsetMonth(nowMs, tzOffsetMin);

    const ranges = {
        day: { startMs: startOfOffsetDay(nowMs, tzOffsetMin), endMs: nowMs },
        week: { startMs: startOfOffsetWeek(nowMs, tzOffsetMin), endMs: nowMs },
        month: { startMs: startOfOffsetMonth(nowMs, tzOffsetMin), endMs: nowMs },
        year: { startMs: startOfOffsetYear(nowMs, tzOffsetMin), endMs: nowMs },
        lifetime: { startMs: earliestEventMs || startOfOffsetMonth(nowMs, tzOffsetMin), endMs: nowMs }
    };

    const out = {};
    for (const [key, windowRange] of Object.entries(ranges)) {
        const agg = aggregateAnalyticsRange(events, {
            startMs: windowRange.startMs,
            endMs: windowRange.endMs,
            platform: platformFilter,
            includeSupporters: false
        });
        out[key] = {
            ...agg,
            startAt: new Date(windowRange.startMs).toISOString(),
            endAt: new Date(windowRange.endMs).toISOString()
        };
    }
    return out;
}

function buildAnalyticsSessionRows(platformFilter) {
    const rows = [];
    const sessions = [...(store.sessions || [])];
    sessions.sort((a, b) => parseTimestampMs(b?.startedAt || '') - parseTimestampMs(a?.startedAt || ''));

    for (const session of sessions) {
        if (!session || typeof session !== 'object') continue;
        const sessionEvents = Array.isArray(session.events)
            ? session.events
                .map((evt) => {
                    const ts = parseTimestampMs(evt?.timestamp);
                    if (!ts) return null;
                    return { ...evt, _timestampMs: ts };
                })
                .filter(Boolean)
            : [];

        const startMs = parseTimestampMs(session.startedAt) || 0;
        const endMs = parseTimestampMs(session.endedAt) || Date.now();
        const agg = aggregateAnalyticsRange(sessionEvents, {
            startMs: startMs || 0,
            endMs: endMs || Date.now(),
            platform: platformFilter,
            includeSupporters: false
        });

        if (agg.eventCount <= 0) continue;
        rows.push({
            id: String(session.id || ''),
            startedAt: String(session.startedAt || ''),
            endedAt: String(session.endedAt || ''),
            isActive: (
                String(store.currentSessionId || '') === String(session.id || '')
                && store.sessionCapturePaused !== true
                && !String(session.endedAt || '').trim()
            ),
            eventCount: agg.eventCount,
            revenueBrlMinor: agg.revenueBrlMinor,
            revenueDisplay: agg.revenueDisplay,
            tipCount: agg.tipCount,
            twitchSubs: agg.twitchSubs,
            youtubeMembers: agg.youtubeMembers,
            youtubeMembersGifted: agg.youtubeMembersGifted,
            twitchBits: agg.twitchBits
        });
        if (rows.length >= 24) break;
    }
    return rows;
}

function getAnalyticsOverview(query = {}) {
    const events = buildAnalyticsEventsFlat();
    const platformFilter = normalizeAnalyticsPlatform(query.platform);
    const range = resolveAnalyticsRange(query, events);

    const selected = aggregateAnalyticsRange(events, {
        startMs: range.startMs,
        endMs: range.endMs,
        platform: platformFilter,
        includeSupporters: true
    });
    const charts = buildAnalyticsSeries(events, range, platformFilter);
    const presets = buildAnalyticsPresetWindows(events, platformFilter, range.tzOffsetMin);

    const totalRevenue = toPositiveInt(selected.revenueBrlMinor, 0);
    const platformRows = ['youtube', 'livepix', 'twitch'].map((platform) => {
        const revenueBrlMinor = toPositiveInt(selected.byPlatformRevenueMinor?.[platform], 0);
        const pct = totalRevenue > 0 ? (revenueBrlMinor / totalRevenue) : 0;
        return {
            platform,
            revenueBrlMinor,
            revenueDisplay: formatMinorAsCurrency(revenueBrlMinor, 'BRL'),
            percentage: Number((pct * 100).toFixed(2))
        };
    });

    return {
        ok: true,
        filter: {
            period: range.period,
            platform: platformFilter,
            startAt: new Date(range.startMs).toISOString(),
            endAt: new Date(range.endMs).toISOString(),
            tzOffsetMin: range.tzOffsetMin,
            bucketUnit: range.bucketUnit
        },
        totals: {
            daily: presets.day,
            weekly: presets.week,
            monthly: presets.month,
            yearly: presets.year,
            lifetime: presets.lifetime
        },
        selected: {
            ...selected,
            platformRevenue: platformRows,
            topSupporters: (selected.topSupporters || []).slice(0, 15),
            sessions: buildAnalyticsSessionRows(platformFilter)
        },
        charts,
        generatedAt: nowIso()
    };
}

function seedCurrentSessionFromHistory(historyEntries = []) {
    if (!Array.isArray(historyEntries) || !historyEntries.length) return 0;
    if (store.sessionCapturePaused === true) return 0;
    const session = ensureCurrentSession({ persist: false });
    if (!session || toPositiveInt(session.eventCount, 0) > 0) return 0;

    const now = Date.now();
    const seedable = historyEntries
        .filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            if (isReplayHistoryEntry(entry)) return false;
            const ts = parseTimestampMs(entry.timestamp);
            if (!ts) return false;
            return ts >= (now - SEED_LOOKBACK_MS);
        })
        .sort((a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp));

    if (!seedable.length) return 0;

    session.startedAt = seedable[0].timestamp || session.startedAt;
    session.updatedAt = session.startedAt;

    let added = 0;
    for (const entry of seedable) {
        if (recordAlertHistoryEntry(entry, { persist: false, emit: false })) {
            added += 1;
        }
    }
    if (added > 0) {
        saveStore();
    }
    return added;
}

function loadSessionMetricsStore(options = {}) {
    try {
        if (fs.existsSync(SESSION_METRICS_PATH)) {
            const rawText = fs.readFileSync(SESSION_METRICS_PATH, 'utf8');
            const parsed = rawText.trim() ? JSON.parse(rawText) : createDefaultStore();
            store = normalizeStore(parsed);
        } else {
            store = createDefaultStore();
        }
    } catch (err) {
        console.error('[SessionMetrics] Failed to load store:', err?.message || String(err));
        store = createDefaultStore();
    }

    ensureCurrentSession({ persist: false });
    rebuildCurrentSessionEventIds();
    resetTransientCoverageCaches();

    if (Array.isArray(options.seedHistory) && options.seedHistory.length) {
        seedCurrentSessionFromHistory(options.seedHistory);
    }

    saveStore();
}

module.exports = {
    SESSION_METRICS_PATH,
    loadSessionMetricsStore,
    getCurrentSessionSummary,
    getAnalyticsOverview,
    startNewSession,
    endCurrentSession,
    recordAlertHistoryEntry,
    seedCurrentSessionFromHistory
};
