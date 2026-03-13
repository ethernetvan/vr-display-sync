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
    // All VR-side runtime state lives here (meshes, materials, active objects, etc.).
    // Set to an object in startVR, back to null in disposeVR.
    // Using _vr instead of putting things directly on 'this' keeps state clean
    // across game switches, since this module is a singleton.
    _vr: null,

    // All screen-side runtime state lives here (canvas context, timers, scores, etc.).
    // Set to an object in startScreen, back to null in disposeScreen.
    _screen: null,

    /**
     * Called once when VR client starts (after calibration complete)
     * @param {Object} context - { scene, camera, renderer, player, controllers, 
     *                             sendGameMessage, screenState, screenMeta, screenRect,
     *                             handState, settings }
     */
    async startVR(context) {
        // Attach anything your VR code needs: this._vr.myMesh = ...
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
        if (!this._vr) return; // Guard against being called before startVR or after dispose
    },

    /**
     * Optional cleanup hook when switching away from this game in VR.
     * Keep this only if you allocate custom resources that need explicit teardown.
     * @param {Object} context - VR context
     */
    disposeVR(context) {
        // Dispose custom THREE.js resources here (geometry, material, etc.) before nulling
        this._vr = null;
    },

    /**
     * Called once when screen client starts
     * @param {Object} context - { canvas, sendGameMessage, settings }
     */
    async startScreen(context) {
        // Attach anything your screen code needs: this._screen.ctx = canvas.getContext('2d')
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
        if (!this._screen) return; // Guard against being called before startScreen or after dispose
    },

    /**
     * Optional cleanup hook when switching away from this game on screen.
     * Keep this only if you allocate custom resources that need explicit teardown.
     * @param {Object} context - Screen context
     */
    disposeScreen(context) {
        // Clear any timers or listeners here (e.g. clearInterval(this._screen.myInterval))
        this._screen = null;
    },

    /**
     * Receives messages sent via sendGameMessage from any client
     * @param {Object} msg - Message object with custom properties
     */
    onMessage(msg) {
    }
};
