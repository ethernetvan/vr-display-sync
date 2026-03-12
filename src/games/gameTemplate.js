import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

/**
 * GAME TEMPLATE - Copy this file to create a new game
 * 
 * Steps to use this template:
 * 1. Copy this file and rename it (e.g., myGame.js)
 * 2. Update the metadata below with your game's ID, name, description, and settings
 * 3. Fill in the lifecycle methods (startVR, updateVR, startScreen, updateScreen)
 * 4. Register your game in src/games/index.js
 * 5. Add defaults to config/defaults.json
 */

export const metadata = {
    id: 'mygame',
    name: 'My Game',
    description: 'Description of what your game does',
    settings: [
        {
            key: 'mySetting',
            label: 'My Setting',
            type: 'number',
            default: 1.0,
            min: 0.0,
            max: 10.0,
            step: 0.1,
            tab: 'mygame',
            description: 'Description of setting'
        }
    ]
};

export default {
    _vr: null,
    _screen: null,

    /**
     * Called once when VR client starts (after calibration complete)
     * @param {Object} context - { scene, camera, renderer, player, controllers, 
     *                             sendGameMessage, screenState, screenMeta, screenRect,
     *                             handState, settings }
     */
    async startVR(context) {
        this._vr = {};
        console.log('Game started with settings:', context.settings);
    },

    /**
     * Called every frame in VR
     * @param {number} delta - Time since last frame (seconds)
     * @param {number} time - Total elapsed time (seconds)
     * @param {Object} context - Same as startVR, updated each frame
     */
    updateVR(delta, time, context) {
        if (!this._vr) return;
    },

    /**
     * Optional cleanup hook when switching away from this game in VR.
     * Keep this only if you allocate custom resources that need explicit teardown.
     * @param {Object} context - VR context
     */
    disposeVR(context) {
        this._vr = null;
    },

    /**
     * Called once when screen client starts
     * @param {Object} context - { canvas, sendGameMessage, settings }
     */
    async startScreen(context) {
        this._screen = {};
        console.log('Screen started with settings:', context.settings);
    },

    /**
     * Called every frame on screen client
     * @param {number} delta - Time since last frame (seconds)
     * @param {number} time - Total elapsed time (seconds)
     * @param {Object} context - { canvas, sendGameMessage, settings }
     */
    updateScreen(delta, time, context) {
        if (!this._screen) return;
    },

    /**
     * Optional cleanup hook when switching away from this game on screen.
     * Keep this only if you allocate custom resources that need explicit teardown.
     * @param {Object} context - Screen context
     */
    disposeScreen(context) {
        this._screen = null;
    },

    /**
     * Receives messages sent via sendGameMessage from any client
     * @param {Object} msg - Message object with custom properties
     */
    onMessage(msg) {
    }
};
