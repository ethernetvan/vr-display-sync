import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const PINCH_DISTANCE_TO_PINCH = 0.02;
const PINCH_THRESHOLD = 0.005;
const DEFAULT_SAND_COLOR = '#d6b36a';
const BACKGROUND_RGB = { r: 246, g: 242, b: 230 };
const CREDIT_URL = 'https://jason.today/falling-sand';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getJointVec3(handState, side, jointName) {
    const joint = handState && handState[side] && handState[side].joints && handState[side].joints[jointName];
    const position = joint && joint.position;
    if (!Array.isArray(position) || position.length < 3) return null;
    return new THREE.Vector3(position[0], position[1], position[2]);
}

function isTriggerDown(context, side) {
    const controller = context && context.controllers ? context.controllers[side] : null;
    const gamepad = controller && controller.gamepad;
    if (!gamepad || typeof gamepad.getButton !== 'function') return false;

    try {
        return !!gamepad.getButton(XR_BUTTONS.TRIGGER);
    } catch (_error) {
        return false;
    }
}

function hexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return null;
    const parsed = parseInt(match[1], 16);
    return Number.isFinite(parsed) ? parsed : null;
}

function varySandColor(colorInt) {
    const red = clamp(((colorInt >> 16) & 255) + Math.round((Math.random() - 0.5) * 20), 0, 255);
    const green = clamp(((colorInt >> 8) & 255) + Math.round((Math.random() - 0.5) * 18), 0, 255);
    const blue = clamp((colorInt & 255) + Math.round((Math.random() - 0.5) * 14), 0, 255);
    return (red << 16) | (green << 8) | blue;
}

function getBrushSettings(settings) {
    return {
        brushRadiusPx: clamp(Number(settings.sandBrushRadiusPx ?? 26), 2, 120),
        spawnChance: clamp(Number(settings.sandSpawnChance ?? 0.78), 0.05, 1),
        color: hexToInt(settings.sandColorHex) ?? hexToInt(DEFAULT_SAND_COLOR) ?? 0xd6b36a
    };
}

function emitBrush(context, settings, x, y) {
    if (!context || typeof context.sendGameMessage !== 'function') return;

    const { brushRadiusPx, spawnChance, color } = getBrushSettings(settings);
    context.sendGameMessage({
        event: 'SAND_DRAW',
        x: Math.round(x),
        y: Math.round(y),
        brushRadiusPx,
        spawnChance,
        color
    });
}

function getHandScreenPoint(context, side) {
    if (!context || !context.screenRect || !context.screenMeta || !context.camera) return null;

    const indexTip = getJointVec3(context.handState, side, 'index-finger-tip');
    const thumbTip = getJointVec3(context.handState, side, 'thumb-tip');
    if (!indexTip || !thumbTip) return null;

    const cameraPosition = new THREE.Vector3();
    if (typeof context.camera.getWorldPosition === 'function') {
        context.camera.getWorldPosition(cameraPosition);
    } else if (context.camera.position) {
        cameraPosition.copy(context.camera.position);
    } else {
        return null;
    }

    const rayDirection = indexTip.clone().sub(cameraPosition);
    if (rayDirection.lengthSq() < 1e-8) return null;
    rayDirection.normalize();

    const raycaster = new THREE.Raycaster();
    raycaster.set(cameraPosition, rayDirection);
    const intersections = raycaster.intersectObject(context.screenRect, true);
    if (!intersections || intersections.length === 0) return null;

    const uv = intersections[0].uv;
    if (!uv) return null;

    return {
        x: uv.x * context.screenMeta.screenWidth,
        y: (1 - uv.y) * context.screenMeta.screenHeight
    };
}

function createScreenState(canvas, cellSizePx) {
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    const cols = Math.max(1, Math.ceil(width / cellSizePx));
    const rows = Math.max(1, Math.ceil(height / cellSizePx));
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = cols;
    offscreenCanvas.height = rows;

    return {
        cellSizePx,
        cols,
        rows,
        grid: new Uint32Array(cols * rows),
        pendingBrushes: [],
        frameParity: 0,
        lastSize: { w: width, h: height },
        offscreenCanvas,
        offscreenContext: offscreenCanvas.getContext('2d', { alpha: false }),
        imageData: new ImageData(cols, rows)
    };
}

function clearGrid(screenState) {
    if (!screenState || !screenState.grid) return;
    screenState.grid.fill(0);
}

function destroyOverlay(overlayRoot) {
    if (!overlayRoot) return;
    if (overlayRoot.parentElement) {
        overlayRoot.parentElement.removeChild(overlayRoot);
    }
}

function ensureOverlay(game, context) {
    if (!context || !context.canvas) return null;
    if (game._screen && game._screen.overlayRoot && document.body.contains(game._screen.overlayRoot)) {
        return game._screen.overlayRoot;
    }

    const overlayRoot = document.createElement('div');
    overlayRoot.style.position = 'fixed';
    overlayRoot.style.inset = '0';
    overlayRoot.style.pointerEvents = 'none';
    overlayRoot.style.zIndex = '20';
    overlayRoot.style.fontFamily = 'Georgia, "Times New Roman", serif';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear Sand';
    clearButton.style.position = 'absolute';
    clearButton.style.top = '16px';
    clearButton.style.left = '16px';
    clearButton.style.padding = '10px 14px';
    clearButton.style.border = '1px solid rgba(78, 57, 24, 0.35)';
    clearButton.style.borderRadius = '10px';
    clearButton.style.background = 'rgba(255, 249, 235, 0.92)';
    clearButton.style.color = '#3d2a12';
    clearButton.style.fontSize = '14px';
    clearButton.style.cursor = 'pointer';
    clearButton.style.boxShadow = '0 8px 24px rgba(45, 33, 15, 0.14)';
    clearButton.style.pointerEvents = 'auto';

    const creditLink = document.createElement('a');
    creditLink.href = CREDIT_URL;
    creditLink.target = '_blank';
    creditLink.rel = 'noreferrer noopener';
    creditLink.textContent = 'sand by jason.today';
    creditLink.style.position = 'absolute';
    creditLink.style.top = '18px';
    creditLink.style.right = '18px';
    creditLink.style.padding = '8px 10px';
    creditLink.style.borderRadius = '10px';
    creditLink.style.background = 'rgba(255, 249, 235, 0.78)';
    creditLink.style.color = '#5c4120';
    creditLink.style.fontSize = '13px';
    creditLink.style.textDecoration = 'none';
    creditLink.style.pointerEvents = 'auto';

    const handleClear = () => {
        clearGrid(game._screen);
        if (context && typeof context.sendGameMessage === 'function') {
            context.sendGameMessage({ event: 'SAND_CLEAR' });
        }
    };

    clearButton.addEventListener('click', handleClear);
    overlayRoot.append(clearButton, creditLink);
    document.body.appendChild(overlayRoot);

    if (!game._screen) game._screen = {};
    game._screen.overlayRoot = overlayRoot;
    game._screen.clearButton = clearButton;
    game._screen.creditLink = creditLink;
    game._screen.handleClear = handleClear;

    return overlayRoot;
}

function applyBrush(screenState, brush) {
    if (!screenState || !brush || !screenState.lastSize.w || !screenState.lastSize.h) return;

    const centerX = clamp(Math.round((brush.x / screenState.lastSize.w) * (screenState.cols - 1)), 0, screenState.cols - 1);
    const centerY = clamp(Math.round((brush.y / screenState.lastSize.h) * (screenState.rows - 1)), 0, screenState.rows - 1);
    const radiusCells = Math.max(1, Math.round((brush.brushRadiusPx || 24) / screenState.cellSizePx));
    const probability = clamp(Number(brush.spawnChance ?? 0.78), 0.05, 1);
    const baseColor = typeof brush.color === 'number' ? brush.color : (hexToInt(DEFAULT_SAND_COLOR) ?? 0xd6b36a);

    for (let y = -radiusCells; y <= radiusCells; y += 1) {
        const gridY = centerY + y;
        if (gridY < 0 || gridY >= screenState.rows) continue;

        for (let x = -radiusCells; x <= radiusCells; x += 1) {
            const gridX = centerX + x;
            if (gridX < 0 || gridX >= screenState.cols) continue;
            if ((x * x) + (y * y) > radiusCells * radiusCells) continue;
            if (Math.random() > probability) continue;

            const index = (gridY * screenState.cols) + gridX;
            if (screenState.grid[index] !== 0) continue;
            screenState.grid[index] = varySandColor(baseColor);
        }
    }
}

function updateSand(screenState) {
    if (!screenState || !screenState.grid) return;

    const { cols, rows, grid } = screenState;
    for (let y = rows - 2; y >= 0; y -= 1) {
        const leftToRight = ((y + screenState.frameParity) & 1) === 0;
        const start = leftToRight ? 0 : cols - 1;
        const end = leftToRight ? cols : -1;
        const step = leftToRight ? 1 : -1;

        for (let x = start; x !== end; x += step) {
            const index = (y * cols) + x;
            const color = grid[index];
            if (color === 0) continue;

            const below = index + cols;
            if (grid[below] === 0) {
                grid[below] = color;
                grid[index] = 0;
                continue;
            }

            const canFallLeft = x > 0 && grid[below - 1] === 0;
            const canFallRight = x < cols - 1 && grid[below + 1] === 0;
            if (!canFallLeft && !canFallRight) continue;

            const goLeft = canFallLeft && (!canFallRight || ((x + y + screenState.frameParity) & 1) === 0);
            const target = goLeft ? below - 1 : below + 1;
            grid[target] = color;
            grid[index] = 0;
        }
    }

    screenState.frameParity += 1;
}

function renderScreen(screenState, canvas) {
    if (!screenState || !screenState.imageData || !screenState.offscreenContext) return;

    const data = screenState.imageData.data;
    const { grid } = screenState;
    for (let index = 0; index < grid.length; index += 1) {
        const color = grid[index];
        const offset = index * 4;

        if (color === 0) {
            data[offset] = BACKGROUND_RGB.r;
            data[offset + 1] = BACKGROUND_RGB.g;
            data[offset + 2] = BACKGROUND_RGB.b;
        } else {
            data[offset] = (color >> 16) & 255;
            data[offset + 1] = (color >> 8) & 255;
            data[offset + 2] = color & 255;
        }
        data[offset + 3] = 255;
    }

    screenState.offscreenContext.putImageData(screenState.imageData, 0, 0);

    const context2d = canvas.getContext('2d');
    context2d.imageSmoothingEnabled = false;
    context2d.clearRect(0, 0, canvas.width, canvas.height);
    context2d.drawImage(screenState.offscreenCanvas, 0, 0, canvas.width, canvas.height);
}

export const metadata = {
    id: 'sand',
    name: 'Falling Sand',
    description: 'Aim at the screen and pour falling sand with trigger or pinch gestures',
    settings: [
        {
            key: 'sandBrushRadiusPx',
            label: 'Brush Radius (px)',
            type: 'number',
            default: 26,
            min: 4,
            max: 120,
            step: 1,
            tab: 'sand',
            applyTo: 'vr',
            description: 'How wide each sand spray is on the screen'
        },
        {
            key: 'sandSpawnChance',
            label: 'Brush Density',
            type: 'number',
            default: 0.78,
            min: 0.05,
            max: 1,
            step: 0.01,
            tab: 'sand',
            applyTo: 'vr',
            description: 'How densely the brush fills with grains'
        },
        {
            key: 'sandColorHex',
            label: 'Sand Color',
            type: 'color',
            default: DEFAULT_SAND_COLOR,
            tab: 'sand',
            description: 'Base color for the falling sand'
        },
        {
            key: 'sandCellSizePx',
            label: 'Cell Size (px)',
            type: 'number',
            default: 4,
            min: 2,
            max: 12,
            step: 1,
            tab: 'sand',
            applyTo: 'screen',
            description: 'Simulation resolution. Smaller cells look better but cost more'
        },
        {
            key: 'sandStepsPerFrame',
            label: 'Simulation Steps',
            type: 'number',
            default: 2,
            min: 1,
            max: 6,
            step: 1,
            tab: 'sand',
            applyTo: 'screen',
            description: 'How many settling passes run each frame'
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
        if (!context) return;
        this.settings = context.settings || this.settings || {};

        for (const side of ['left', 'right']) {
            const screenState = context.screenState && context.screenState[side];
            if (screenState && screenState.onScreen && isTriggerDown(context, side)) {
                emitBrush(context, this.settings, screenState.canvasX, screenState.canvasY);
            }

            const tracked = !!(context.handState && context.handState[side] && context.handState[side].tracked);
            if (!tracked) {
                if (this._vr) this._vr.pinching[side] = false;
                continue;
            }

            const indexTip = getJointVec3(context.handState, side, 'index-finger-tip');
            const thumbTip = getJointVec3(context.handState, side, 'thumb-tip');
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

            const handScreenPoint = getHandScreenPoint(context, side);
            if (!handScreenPoint) continue;
            emitBrush(context, this.settings, handScreenPoint.x, handScreenPoint.y);
        }
    },

    disposeVR() {
        this._vr = null;
    },

    async startScreen(context) {
        this.settings = context.settings || {};
        const cellSizePx = clamp(Number(this.settings.sandCellSizePx ?? 4), 2, 12);
        const existingPendingBrushes = this._screen && Array.isArray(this._screen.pendingBrushes)
            ? [...this._screen.pendingBrushes]
            : [];
        const existingGrid = this._screen && this._screen.grid ? this._screen.grid : null;
        this._screen = createScreenState(context.canvas, cellSizePx);
        this._screen.pendingBrushes.push(...existingPendingBrushes);
        if (existingGrid && existingGrid.length === this._screen.grid.length) {
            this._screen.grid.set(existingGrid);
        }
        ensureOverlay(this, context);
    },

    updateScreen(_delta, _time, context) {
        if (!context || !context.canvas) return;
        this.settings = context.settings || this.settings || {};

        const desiredCellSize = clamp(Number(this.settings.sandCellSizePx ?? 4), 2, 12);
        if (!this._screen
            || !this._screen.lastSize
            || this._screen.lastSize.w !== context.canvas.width
            || this._screen.lastSize.h !== context.canvas.height
            || this._screen.cellSizePx !== desiredCellSize) {
            const pendingBrushes = this._screen && Array.isArray(this._screen.pendingBrushes)
                ? [...this._screen.pendingBrushes]
                : [];
            const previousGrid = this._screen && this._screen.grid ? this._screen.grid : null;
            const overlayRoot = this._screen && this._screen.overlayRoot ? this._screen.overlayRoot : null;
            const clearButton = this._screen && this._screen.clearButton ? this._screen.clearButton : null;
            const creditLink = this._screen && this._screen.creditLink ? this._screen.creditLink : null;
            const handleClear = this._screen && this._screen.handleClear ? this._screen.handleClear : null;
            this._screen = createScreenState(context.canvas, desiredCellSize);
            this._screen.pendingBrushes.push(...pendingBrushes);
            if (previousGrid && previousGrid.length === this._screen.grid.length) {
                this._screen.grid.set(previousGrid);
            }
            this._screen.overlayRoot = overlayRoot;
            this._screen.clearButton = clearButton;
            this._screen.creditLink = creditLink;
            this._screen.handleClear = handleClear;
        }

        ensureOverlay(this, context);

        this._screen.lastSize.w = context.canvas.width;
        this._screen.lastSize.h = context.canvas.height;

        while (this._screen.pendingBrushes.length > 0) {
            applyBrush(this._screen, this._screen.pendingBrushes.shift());
        }

        const stepsPerFrame = clamp(Number(this.settings.sandStepsPerFrame ?? 2), 1, 6);
        for (let stepIndex = 0; stepIndex < stepsPerFrame; stepIndex += 1) {
            updateSand(this._screen);
        }

        renderScreen(this._screen, context.canvas);
    },

    disposeScreen() {
        if (this._screen && this._screen.clearButton && this._screen.handleClear) {
            this._screen.clearButton.removeEventListener('click', this._screen.handleClear);
        }
        destroyOverlay(this._screen && this._screen.overlayRoot);
        this._screen = null;
    },

    onMessage(msg) {
        if (!msg) return;

        if (msg.event === 'SAND_CLEAR') {
            clearGrid(this._screen);
            return;
        }

        if (msg.event !== 'SAND_DRAW') return;
        if (!this._screen) {
            this._screen = {
                pendingBrushes: [],
                grid: null
            };
        }
        if (!Array.isArray(this._screen.pendingBrushes)) {
            this._screen.pendingBrushes = [];
        }

        this._screen.pendingBrushes.push({
            x: typeof msg.x === 'number' ? msg.x : 0,
            y: typeof msg.y === 'number' ? msg.y : 0,
            brushRadiusPx: typeof msg.brushRadiusPx === 'number' ? msg.brushRadiusPx : 24,
            spawnChance: typeof msg.spawnChance === 'number' ? msg.spawnChance : 0.78,
            color: typeof msg.color === 'number' ? msg.color : (hexToInt(DEFAULT_SAND_COLOR) ?? 0xd6b36a)
        });

        if (this._screen.pendingBrushes.length > 128) {
            this._screen.pendingBrushes.splice(0, this._screen.pendingBrushes.length - 128);
        }
    }
};