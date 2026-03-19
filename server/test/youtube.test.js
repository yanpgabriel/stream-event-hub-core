'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseGiftMembershipCountFromText,
    detectMembershipKindFromText,
} = require('../src/services/youtube');

test('parseGiftMembershipCountFromText supports public gift purchase phrasing', () => {
    assert.equal(parseGiftMembershipCountFromText('Sent 5 RaidAway+ gift memberships'), 5);
    assert.equal(parseGiftMembershipCountFromText('Jana presenteou 3 membros'), 3);
    assert.equal(parseGiftMembershipCountFromText('Sent a RaidAway+ gift membership'), 1);
});

test('detectMembershipKindFromText recognizes gift and milestone variants', () => {
    assert.equal(detectMembershipKindFromText('received a gift membership by Jana Beh'), 'gift');
    assert.equal(detectMembershipKindFromText('Member for 6 months!'), 'milestone');
    assert.equal(detectMembershipKindFromText('Novo membro no canal'), 'new');
});
