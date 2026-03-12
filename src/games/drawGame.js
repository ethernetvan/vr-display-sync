import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const PINCH_DISTANCE_TO_PINCH = 0.02;
const PINCH_THRESHOLD = 0.005;

function getJointVec3(handState, side, jointName) {
    const j = handState && handState[side] && handState[side].joints && handState[side].joints[jointName];
    const p = j && j.position;
    if (!Array.isArray(p) || p.length < 3) return null;
    return new THREE.Vector3(p[0], p[1], p[2]);
}

function getControllerPoint(context, side) {
    const c = context && context.controllers ? context.controllers[side] : null;
    if (!c) return null;

    // Prefer gripSpace because it is stable for the controller model pose.
    const space = c.gripSpace || c.raySpace;
    if (!space) return null;

    // A point slightly forward from the grip, approximating where a controller "tip" is.
    const p = new THREE.Vector3(0, 0, -0.06);
    try {
        space.localToWorld(p);
        return p;
    } catch (e) {
        // Fallback: world position of the space.
        try {
            return space.getWorldPosition(new THREE.Vector3());
        } catch (_e) {
            return null;
        }
    }
}

function isTriggerDown(context, side) {
    const c = context && context.controllers ? context.controllers[side] : null;
    const gp = c && c.gamepad;
    if (!gp || typeof gp.getButton !== 'function') return false;
    try {
        return !!gp.getButton(XR_BUTTONS.TRIGGER);
    } catch (e) {
        return false;
    }
}

function hexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const s = hex.trim();
    if (!s) return null;
    const m = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return Number.isFinite(v) ? v : null;
}

export const metadata = {
    id: 'draw',
    name: 'Draw',
    description: 'Draw on screen with pinch gesture or controller trigger',
    settings: [
        {
            key: 'drawColorHex',
            label: 'Color',
            type: 'color',
            default: '#111111',
            tab: 'draw',
            applyTo: 'vr',
            description: 'Drawing color (hex)'
        },
        {
            key: 'drawThicknessPx',
            label: 'Thickness (px)',
            type: 'number',
            default: 20,
            min: 1,
            step: 1,
            tab: 'draw',
            applyTo: 'vr',
            description: 'Drawing stroke thickness in pixels'
        },
        {
            key: 'drawAlpha',
            label: 'Alpha (0-1)',
            type: 'number',
            default: 0.22,
            min: 0,
            max: 1,
            step: 0.05,
            tab: 'draw',
            applyTo: 'vr',
            description: 'Drawing stroke opacity'
        }
    ]
};

export default {
    async startVR(context) {
        this.settings = context.settings || {};
        
        this._vr = {
            pinching: { left: false, right: false }
        };
    },

    updateVR(_delta, _time, context) {
        if (!context || !context.handState || !context.screenRect || !context.screenMeta) return;

        // Update settings from context if provided
        if (context && context.settings) {
            this.settings = context.settings;
        }

        const thicknessPx = this.settings.drawThicknessPx !== undefined
            ? this.settings.drawThicknessPx
            : 20;
        const colorHex = this.settings.drawColorHex !== undefined
            ? this.settings.drawColorHex
            : '#111111';
        const alpha = this.settings.drawAlpha !== undefined
            ? this.settings.drawAlpha
            : 0.22;
        
        const colorInt = hexToInt(colorHex);

        const { handState, screenRect, screenMeta, camera } = context;
        const screenWidth = screenMeta.screenWidth;
        const screenHeight = screenMeta.screenHeight;
        if (!screenWidth || !screenHeight) return;

        const camPos = new THREE.Vector3();
        if (camera && typeof camera.getWorldPosition === 'function') {
            camera.getWorldPosition(camPos);
        } else if (camera && camera.position) {
            camPos.copy(camera.position);
        } else {
            return;
        }

        for (const side of ['left', 'right']) {
            // Controller-based drawing: hold trigger to draw.
            if (isTriggerDown(context, side)) {
                const controllerPoint = getControllerPoint(context, side);
                if (controllerPoint) {
                    const rayDir = controllerPoint.clone().sub(camPos);
                    if (rayDir.lengthSq() > 1e-8) {
                        rayDir.normalize();
                        const raycaster = new THREE.Raycaster();
                        raycaster.set(camPos, rayDir);
                        const intersects = raycaster.intersectObject(screenRect, true);
                        if (intersects && intersects.length > 0) {
                            const uv = intersects[0].uv;
                            if (uv) {
                                const canvasX = uv.x * screenWidth;
                                const canvasY = (1 - uv.y) * screenHeight;
                                if (!Number.isNaN(canvasX) && !Number.isNaN(canvasY)) {
                                    context.sendGameMessage({
                                        event: 'DRAW',
                                        x: Math.round(canvasX),
                                        y: Math.round(canvasY),
                                        r: thicknessPx,
                                        color: colorInt !== null ? colorInt : 0x111111,
                                        alpha
                                    });
                                }
                            }
                        }
                    }
                }
                continue;
            }

            const tracked = !!(handState[side] && handState[side].tracked);
            if (!tracked) {
                if (this._vr) this._vr.pinching[side] = false;
                continue;
            }

            const indexTip = getJointVec3(handState, side, 'index-finger-tip');
            const thumbTip = getJointVec3(handState, side, 'thumb-tip');
            if (!indexTip || !thumbTip) {
                if (this._vr) this._vr.pinching[side] = false;
                continue;
            }

            const distance = indexTip.distanceTo(thumbTip);
            const wasPinching = !!(this._vr && this._vr.pinching[side]);
            let isPinching = wasPinching;

            if (wasPinching && distance > PINCH_DISTANCE_TO_PINCH + PINCH_THRESHOLD) {
                isPinching = false;
            } else if (!wasPinching && distance <= PINCH_DISTANCE_TO_PINCH - PINCH_THRESHOLD) {
                isPinching = true;
            }

            if (this._vr) this._vr.pinching[side] = isPinching;
            if (!isPinching) continue;

            // For stability, cast through the index finger tip (pinch is still detected via thumb/index distance).
            const rayDir = indexTip.clone().sub(camPos);
            if (rayDir.lengthSq() < 1e-8) continue;
            rayDir.normalize();

            const raycaster = new THREE.Raycaster();
            raycaster.set(camPos, rayDir);
            const intersects = raycaster.intersectObject(screenRect, true);
            if (!intersects || intersects.length === 0) continue;

            const uv = intersects[0].uv;
            if (!uv) continue;

            const canvasX = uv.x * screenWidth;
            const canvasY = (1 - uv.y) * screenHeight;
            if (Number.isNaN(canvasX) || Number.isNaN(canvasY)) continue;

            context.sendGameMessage({
                event: 'DRAW',
                x: Math.round(canvasX),
                y: Math.round(canvasY),
                r: thicknessPx,
                color: colorInt !== null ? colorInt : 0x111111,
                alpha
            });
        }
    },

    async startScreen(context) {
        this.settings = context.settings || {};
        
        this._screen = {
            strokes: [],
        };

        if (context && context.canvas) {
            const ctx = context.canvas.getContext('2d');
            ctx.clearRect(0, 0, context.canvas.width, context.canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, context.canvas.width, context.canvas.height);
        }
    },

    updateScreen(_delta, _time, context) {
        if (!context || !context.canvas) return;
        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (this._screen && Array.isArray(this._screen.strokes)) {
            for (const s of this._screen.strokes) {
                ctx.fillStyle = `rgba(${(s.color >> 16) & 255}, ${(s.color >> 8) & 255}, ${s.color & 255}, ${s.alpha})`;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    },

    onMessage(msg) {
        if (!msg) return;
        if (msg.event === 'DRAW_CLEAR') {
            if (this._screen && Array.isArray(this._screen.strokes)) {
                this._screen.strokes.length = 0;
            }
            return;
        }
        if (msg.event === 'DRAW') {
            if (!this._screen) this._screen = { strokes: [] };
            if (!Array.isArray(this._screen.strokes)) this._screen.strokes = [];

            const x = typeof msg.x === 'number' ? msg.x : null;
            const y = typeof msg.y === 'number' ? msg.y : null;
            if (x === null || y === null) return;

            this._screen.strokes.push({
                x,
                y,
                r: typeof msg.r === 'number' ? msg.r : 20,
                color: typeof msg.color === 'number' ? msg.color : 0x111111,
                alpha: typeof msg.alpha === 'number' ? msg.alpha : 0.2
            });

            if (this._screen.strokes.length > 8000) {
                this._screen.strokes.splice(0, this._screen.strokes.length - 8000);
            }
        }
    }
};
