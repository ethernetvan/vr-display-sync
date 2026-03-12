import ballsGame, { metadata as ballsMeta } from './ballsGame.js';
import marketingBallsGame, { metadata as marketingBallsMeta } from './marketingBallsGame.js';
import paintGame, { metadata as paintMeta } from './paintGame.js';
import drawGame, { metadata as drawMeta } from './drawGame.js';
import tutorialGame, { metadata as tutorialMeta } from './tutorialGame.js';

// Central game registry
export const GAMES = new Map([
    [ballsMeta.id, { game: ballsGame, metadata: ballsMeta }],
    [marketingBallsMeta.id, { game: marketingBallsGame, metadata: marketingBallsMeta }],
    [paintMeta.id, { game: paintGame, metadata: paintMeta }],
    [drawMeta.id, { game: drawGame, metadata: drawMeta }],
    [tutorialMeta.id, { game: tutorialGame, metadata: tutorialMeta }]
]);

// Default game to load on startup
export const DEFAULT_GAME_ID = 'balls';

// System-wide settings (not game-specific)
export const SYSTEM_SETTINGS = {
    screenGeometryMode: { key: 'screenGeometryMode', type: 'string', default: 'curved', validValues: ['flat', 'curved'] },
    handJointsDebugEnabled: { key: 'handJointsDebugEnabled', type: 'boolean', default: false }
};

/**
 * Extract all default settings from all games
 * @returns {Object} Object with all game setting keys and their default values
 */
export function getDefaultSettings() {
    const defaults = {};
    
    // Add system-wide settings
    for (const [key, setting] of Object.entries(SYSTEM_SETTINGS)) {
        defaults[setting.key] = setting.default;
    }

    // Add game-specific settings
    for (const [id, { metadata }] of GAMES) {
        if (!metadata.settings) continue;
        for (const setting of metadata.settings) {
            defaults[setting.key] = setting.default;
        }
    }
    
    return defaults;
}

/**
 * Get settings schema for a specific game
 * @param {string} gameId - The game ID
 * @returns {Array} Array of setting definitions
 */
export function getGameSettings(gameId) {
    const entry = GAMES.get(gameId);
    return entry?.metadata?.settings || [];
}

/**
 * Get metadata for a specific game
 * @param {string} gameId - The game ID
 * @returns {Object|null} Game metadata or null
 */
export function getGameMetadata(gameId) {
    const entry = GAMES.get(gameId);
    return entry?.metadata || null;
}

/**
 * Get all settings grouped by tab
 * @returns {Object} Object with tab names as keys and array of settings as values
 */
export function getSettingsByTab() {
    const byTab = {
        general: [],
        physics: [],
        hands: [],
        draw: [],
        paint: []
    };

    for (const [id, { metadata }] of GAMES) {
        if (!metadata.settings) continue;
        for (const setting of metadata.settings) {
            const tab = setting.tab || 'general';
            if (!byTab[tab]) byTab[tab] = [];
            byTab[tab].push({ ...setting, gameId: id });
        }
    }

    return byTab;
}

/**
 * Get all settings that apply to VR client
 * @returns {Object} Object with setting keys and their defaults
 */
export function getVRSettings() {
    const vrSettings = {};
    
    for (const [id, { metadata }] of GAMES) {
        if (!metadata.settings) continue;
        for (const setting of metadata.settings) {
            if (setting.applyTo === 'vr' || setting.applyTo === 'both') {
                vrSettings[setting.key] = setting.default;
            }
        }
    }
    
    return vrSettings;
}

/**
 * Get all settings that apply to Screen client
 * @returns {Object} Object with setting keys and their defaults
 */
export function getScreenSettings() {
    const screenSettings = {};
    
    for (const [id, { metadata }] of GAMES) {
        if (!metadata.settings) continue;
        for (const setting of metadata.settings) {
            if (setting.applyTo === 'screen' || setting.applyTo === 'both') {
                screenSettings[setting.key] = setting.default;
            }
        }
    }
    
    return screenSettings;
}

export default {
    GAMES,
    DEFAULT_GAME_ID,
    SYSTEM_SETTINGS,
    getDefaultSettings,
    getGameSettings,
    getGameMetadata,
    getSettingsByTab,
    getVRSettings,
    getScreenSettings
};
