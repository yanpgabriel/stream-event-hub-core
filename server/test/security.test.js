'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadSecurityWithEnv(envPatch = {}) {
    const original = {
        TRUST_PROXY: process.env.TRUST_PROXY,
        SOCKET_ALLOWED_ORIGINS: process.env.SOCKET_ALLOWED_ORIGINS,
    };
    for (const [key, value] of Object.entries(envPatch)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    const modulePath = require.resolve('../src/security');
    delete require.cache[modulePath];
    const security = require('../src/security');
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    delete require.cache[modulePath];
    return security;
}

const {
    isPrivateNetworkIp,
    getRequestIp,
    isAllowedSocketOrigin,
} = loadSecurityWithEnv();

test('isPrivateNetworkIp identifies common LAN and localhost ranges', () => {
    assert.equal(isPrivateNetworkIp('127.0.0.1'), true);
    assert.equal(isPrivateNetworkIp('192.168.1.44'), true);
    assert.equal(isPrivateNetworkIp('10.0.0.8'), true);
    assert.equal(isPrivateNetworkIp('172.20.4.9'), true);
    assert.equal(isPrivateNetworkIp('8.8.8.8'), false);
});

test('getRequestIp prefers socket remote address when trust proxy is disabled', () => {
    const req = {
        headers: { 'x-forwarded-for': '203.0.113.40' },
        socket: { remoteAddress: '::ffff:192.168.1.10' }
    };
    assert.equal(getRequestIp(req), '192.168.1.10');
});

test('getRequestIp only trusts forwarded headers when the direct peer is local', () => {
    const { getRequestIp: getProxiedRequestIp } = loadSecurityWithEnv({ TRUST_PROXY: 'true' });

    const publicPeerReq = {
        headers: { 'x-forwarded-for': '192.168.1.44' },
        socket: { remoteAddress: '198.51.100.12' }
    };
    assert.equal(getProxiedRequestIp(publicPeerReq), '198.51.100.12');

    const localProxyReq = {
        headers: { 'x-forwarded-for': '203.0.113.40, 192.168.1.2' },
        socket: { remoteAddress: '::ffff:127.0.0.1' }
    };
    assert.equal(getProxiedRequestIp(localProxyReq), '203.0.113.40');
});

test('isAllowedSocketOrigin accepts LAN origins and rejects unrelated public origins by default', () => {
    assert.equal(isAllowedSocketOrigin('http://192.168.1.50:3232'), true);
    assert.equal(isAllowedSocketOrigin('http://localhost:3232'), true);
    assert.equal(isAllowedSocketOrigin('https://example.com'), false);
});
