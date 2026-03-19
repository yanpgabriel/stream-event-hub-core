'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    sessions,
    createSession,
    getSessionById,
    SESSION_TTL_MS,
} = require('../src/auth');

test('getSessionById refreshes active sessions and removes expired ones', () => {
    sessions.clear();

    const session = createSession('admin');
    const createdAt = session.lastSeenAt;

    const touched = getSessionById(session.sid, { nowMs: createdAt + 1000 });
    assert.equal(touched?.sid, session.sid);
    assert.equal(touched?.lastSeenAt, createdAt + 1000);

    touched.lastSeenAt = createdAt - SESSION_TTL_MS - 1;
    const expired = getSessionById(session.sid, { nowMs: createdAt });
    assert.equal(expired, null);
    assert.equal(sessions.has(session.sid), false);
});
