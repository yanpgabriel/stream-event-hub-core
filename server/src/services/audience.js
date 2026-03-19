'use strict';

const axios = require('axios');
const { StaticAuthProvider } = require('@twurple/auth');
const { ApiClient } = require('@twurple/api');
const { config, validateConfigPatch, applyConfigPatch } = require('../config');

const CACHE_TTL_MS = 25000;
const REQUEST_TIMEOUT_MS = 10000;

let cachedAudience = null;
let cachedAtMs = 0;
let inFlightPromise = null;

function normalizeCount(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/[^\d]/g, '');
    if (!digits) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
}

function parseYouTubeLiveId(html) {
    if (!html) return '';
    const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"&]+)"/i);
    if (canonical?.[1]) return canonical[1];
    const fallback = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return fallback?.[1] || '';
}

function parseYouTubeViewerCount(html) {
    if (!html) return null;

    const patterns = [
        /"concurrentViewCount":"(\d+)"/i,
        /"concurrentViewers":"(\d+)"/i,
        /"liveChatRenderer"[\s\S]{0,300}"viewCount":"(\d+)"/i
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match?.[1]) continue;
        const count = normalizeCount(match[1]);
        if (count != null) return count;
    }

    return null;
}

function parseYouTubeLiveState(html) {
    if (!html) return false;
    return /"isLiveNow"\s*:\s*true/i.test(html)
        || /"isLive"\s*:\s*true/i.test(html)
        || /"isLiveContent"\s*:\s*true/i.test(html)
        || /BADGE_STYLE_TYPE_LIVE_NOW/i.test(html)
        || /"LIVE_NOW"/i.test(html);
}

function defaultChannelState(configured = false) {
    return {
        configured,
        live: false,
        viewers: null,
        fetchedAt: new Date().toISOString(),
        error: ''
    };
}

async function fetchTwitchAudience() {
    const configured = !!config.twitchClientId && !!config.twitchAccessToken;
    if (!configured) return defaultChannelState(false);

    try {
        const authProvider = new StaticAuthProvider(config.twitchClientId, config.twitchAccessToken);
        const apiClient = new ApiClient({ authProvider });
        const user = await apiClient.users.getAuthenticatedUser(config.twitchAccessToken);
        if (!user) {
            return {
                ...defaultChannelState(true),
                error: 'Could not resolve authenticated Twitch user'
            };
        }

        const stream = await apiClient.streams.getStreamByUserId(user.id);
        return {
            configured: true,
            live: !!stream,
            viewers: stream ? Number(stream.viewerCount || 0) : 0,
            fetchedAt: new Date().toISOString(),
            error: '',
            username: user.displayName || user.name || ''
        };
    } catch (err) {
        return {
            ...defaultChannelState(true),
            error: err?.message || String(err)
        };
    }
}

async function fetchYouTubeAudience() {
    const configured = !!config.youtubeChannelId || !!config.youtubeLiveId;
    if (!configured) return defaultChannelState(false);

    const reqConfig = {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    };

    try {
        const official = await fetchYouTubeAudienceOfficialApi();
        if (official) return official;

        if (!config.youtubeChannelId) {
            return {
                configured: true,
                live: false,
                viewers: 0,
                fetchedAt: new Date().toISOString(),
                error: ''
            };
        }

        const liveUrl = `https://www.youtube.com/channel/${encodeURIComponent(config.youtubeChannelId)}/live`;
        const liveResp = await axios.get(liveUrl, reqConfig);
        const liveHtml = String(liveResp?.data || '');
        const liveId = parseYouTubeLiveId(liveHtml);
        const liveFromLivePage = parseYouTubeLiveState(liveHtml);

        if (!liveId && !liveFromLivePage) {
            return {
                configured: true,
                live: false,
                viewers: 0,
                fetchedAt: new Date().toISOString(),
                error: ''
            };
        }

        let viewers = liveFromLivePage ? parseYouTubeViewerCount(liveHtml) : null;
        let isLive = liveFromLivePage;

        if (liveId) {
            const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(liveId)}&hl=en`;
            const watchResp = await axios.get(watchUrl, reqConfig);
            const watchHtml = String(watchResp?.data || '');
            const watchLive = parseYouTubeLiveState(watchHtml);

            if (watchLive) {
                const watchCount = parseYouTubeViewerCount(watchHtml);
                if (watchCount != null) viewers = watchCount;
            }
            isLive = isLive || watchLive;
        }

        return {
            configured: true,
            live: isLive,
            viewers: isLive ? viewers : 0,
            fetchedAt: new Date().toISOString(),
            error: '',
            liveId: liveId || '',
            source: 'scrape'
        };
    } catch (err) {
        return {
            ...defaultChannelState(true),
            error: err?.message || String(err)
        };
    }
}

function hasYouTubeAudienceOAuth() {
    return !!(config.googleClientId && config.googleClientSecret && config.youtubeAccessToken);
}

async function refreshYouTubeAudienceTokenIfNeeded(options = {}) {
    const force = options.force === true;
    if (!config.googleClientId || !config.googleClientSecret || !config.youtubeRefreshToken) return false;

    const expiresAtMs = Date.parse(String(config.youtubeTokenExpiresAt || ''));
    const now = Date.now();
    if (!force && Number.isFinite(expiresAtMs) && expiresAtMs - now > 2 * 60 * 1000) {
        return false;
    }

    try {
        const tokenRes = await axios.post(
            'https://oauth2.googleapis.com/token',
            new URLSearchParams({
                client_id: config.googleClientId,
                client_secret: config.googleClientSecret,
                refresh_token: config.youtubeRefreshToken,
                grant_type: 'refresh_token'
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true
            }
        );

        if (tokenRes.status < 200 || tokenRes.status >= 300) {
            return false;
        }

        const nextAccessToken = String(tokenRes.data?.access_token || '').trim();
        const nextRefreshToken = String(tokenRes.data?.refresh_token || '').trim();
        const expiresInSec = Number(tokenRes.data?.expires_in || 0);
        const expiresAt = Number.isFinite(expiresInSec) && expiresInSec > 0
            ? new Date(Date.now() + expiresInSec * 1000).toISOString()
            : config.youtubeTokenExpiresAt || '';
        if (!nextAccessToken) return false;

        const patchInput = {
            youtubeAccessToken: nextAccessToken,
            youtubeTokenExpiresAt: expiresAt
        };
        if (nextRefreshToken) patchInput.youtubeRefreshToken = nextRefreshToken;

        const validation = validateConfigPatch(patchInput);
        if (!validation.ok) return false;
        applyConfigPatch(validation.patch, { triggerRestart: false });
        return true;
    } catch {
        return false;
    }
}

async function youtubeAudienceApiGet(path, params = {}, options = {}) {
    if (!config.youtubeAccessToken) return null;
    const retryAuth = options.retryAuth !== false;

    const execute = async () => axios.get(`https://www.googleapis.com/youtube/v3/${path}`, {
        params,
        headers: {
            Authorization: `Bearer ${config.youtubeAccessToken}`
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true
    });

    let res = await execute();
    if (retryAuth && (res.status === 401 || res.status === 403)) {
        const refreshed = await refreshYouTubeAudienceTokenIfNeeded({ force: true });
        if (refreshed) {
            res = await execute();
        }
    }
    return res;
}

function normalizeYouTubeApiLiveState(item) {
    if (!item || typeof item !== 'object') return false;
    const details = item.liveStreamingDetails || {};
    const snippet = item.snippet || {};
    const hasStart = !!details.actualStartTime || !!details.scheduledStartTime;
    const hasEnded = !!details.actualEndTime;
    if (snippet.liveBroadcastContent === 'live') return true;
    return hasStart && !hasEnded;
}

async function fetchYouTubeAudienceOfficialApi() {
    if (!hasYouTubeAudienceOAuth()) return null;

    await refreshYouTubeAudienceTokenIfNeeded({ force: false });

    const configuredLiveId = String(config.youtubeLiveId || '').trim();
    const configuredChannelId = String(config.youtubeChannelId || '').trim();
    let liveId = configuredLiveId;

    if (!liveId && configuredChannelId) {
        const searchRes = await youtubeAudienceApiGet('search', {
            part: 'id',
            channelId: configuredChannelId,
            eventType: 'live',
            type: 'video',
            maxResults: 1
        });
        if (searchRes && searchRes.status >= 200 && searchRes.status < 300) {
            liveId = String(searchRes.data?.items?.[0]?.id?.videoId || '').trim();
        }
    }

    if (!liveId) {
        return {
            configured: true,
            live: false,
            viewers: 0,
            fetchedAt: new Date().toISOString(),
            error: '',
            source: 'youtube-api'
        };
    }

    const detailsRes = await youtubeAudienceApiGet('videos', {
        part: 'liveStreamingDetails,snippet',
        id: liveId,
        maxResults: 1
    });

    if (!detailsRes || detailsRes.status < 200 || detailsRes.status >= 300) {
        return null;
    }

    const item = detailsRes.data?.items?.[0];
    if (!item) {
        return {
            configured: true,
            live: false,
            viewers: 0,
            fetchedAt: new Date().toISOString(),
            error: '',
            liveId,
            source: 'youtube-api'
        };
    }

    const isLive = normalizeYouTubeApiLiveState(item);
    const viewersRaw = Number(item?.liveStreamingDetails?.concurrentViewers);
    const viewers = Number.isFinite(viewersRaw) ? Math.max(0, Math.round(viewersRaw)) : null;

    return {
        configured: true,
        live: isLive,
        viewers: isLive ? (viewers ?? 0) : 0,
        fetchedAt: new Date().toISOString(),
        error: '',
        liveId,
        source: 'youtube-api'
    };
}

function buildAudienceSnapshot(twitch, youtube) {
    return {
        fetchedAt: new Date().toISOString(),
        twitch,
        youtube
    };
}

async function refreshAudienceSnapshot() {
    const [twitch, youtube] = await Promise.all([
        fetchTwitchAudience(),
        fetchYouTubeAudience()
    ]);
    const snapshot = buildAudienceSnapshot(twitch, youtube);
    cachedAudience = snapshot;
    cachedAtMs = Date.now();
    return snapshot;
}

async function getAudienceSnapshot(options = {}) {
    const force = options.force === true;
    const now = Date.now();

    if (!force && cachedAudience && now - cachedAtMs < CACHE_TTL_MS) {
        return cachedAudience;
    }

    if (!force && inFlightPromise) return inFlightPromise;

    inFlightPromise = refreshAudienceSnapshot().finally(() => {
        inFlightPromise = null;
    });
    return inFlightPromise;
}

module.exports = {
    getAudienceSnapshot
};
