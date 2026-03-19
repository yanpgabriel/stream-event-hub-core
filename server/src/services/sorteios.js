'use strict';

const ctx = require('../ctx');

/**
 * Raffle State
 */
const state = {
    isActive: false,
    keyword: '!sorteio',
    participants: [], // Array of { name, platform } objects
    winners: [] // Array of { name, platform } objects drawn in current session
};

/**
 * Remove accents and normalize string to lowercase
 */
function normalizeText(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Start a new raffle with the given keyword.
 * @param {string} keyword 
 */
function startRaffle(keyword) {
    state.isActive = true;
    if (keyword && typeof keyword === 'string') {
        state.keyword = keyword.trim();
    }
    emitStateUpdate();
    return state;
}

/**
 * Stop the current raffle (does not clear participants).
 */
function stopRaffle() {
    state.isActive = false;
    emitStateUpdate();
    return state;
}

/**
 * Clear the participant list.
 */
function clearParticipants() {
    state.participants = [];
    state.winners = [];
    emitStateUpdate();
    return state;
}

/**
 * Draw a random winner from the participant list.
 */
function drawWinner() {
    if (state.participants.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * state.participants.length);
    const winner = state.participants[randomIndex];

    // Track this winner if not already in the winners array
    if (!state.winners.find(w => w.name === winner.name)) {
        state.winners.push(winner);
        emitStateUpdate();
    }

    // Emit special event for the OBS alert overlay
    if (ctx.io) {
        ctx.io.emit('sorteio-winner', { name: winner.name });
    }

    return winner;
}

/**
 * Replay the alert for a specific winner manually
 * @param {string} name 
 */
function replayWinner(name) {
    if (ctx.io && name) {
        ctx.io.emit('sorteio-winner', { name });
    }
}

/**
 * Handle incoming chat messages.
 * If the raffle is active and the message contains the keyword, add the user.
 * @param {object} message Normalized chat message from chat.js
 */
function handleMessage(message) {
    if (!state.isActive || !state.keyword) return;

    const text = message.chatmessage || '';
    const normText = normalizeText(text);
    const normKeyword = normalizeText(state.keyword);

    console.log(`[Sorteio] Checking message: "${text}" | norm: "${normText}" | kw: "${state.keyword}" | normKw: "${normKeyword}"`);

    if (normText.includes(normKeyword)) {
        console.log(`[Sorteio] Match! Adding participant.`);
        const name = message.chatname;
        const platform = message.source || 'unknown';

        if (name && !state.participants.find(p => p.name === name)) {
            state.participants.push({ name, platform });
            emitStateUpdate();
        } else {
            console.log(`[Sorteio] Participant ${name} already in list.`);
        }
    }
}

/**
 * Get current raffle state.
 */
function getState() {
    return { ...state };
}

/**
 * Helper to emit state to the admin panel.
 */
function emitStateUpdate() {
    if (ctx.io) {
        ctx.io.of('/admin').emit('sorteios-state', getState());
    }
}

module.exports = {
    startRaffle,
    stopRaffle,
    clearParticipants,
    drawWinner,
    replayWinner,
    handleMessage,
    getState
};
