import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const PINCH_DISTANCE_TO_PINCH = 0.02;
const PINCH_THRESHOLD = 0.005;
const DEFAULT_SUGAR_COLOR = '#efe2bd';
const DEFAULT_LINE_COLOR = '#5b4934';
const BACKGROUND_RGB = { r: 251, g: 247, b: 238 };
const CREDIT_URL = 'https://jason.today/falling-sand';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function hexToInt(hex) {
    if (typeof hex !== 'string') return null;
    const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return null;
    const parsed = parseInt(match[1], 16);
    return Number.isFinite(parsed) ? parsed : null;
}

function varySugarColor(colorInt) {
    const red = clamp(((colorInt >> 16) & 255) + Math.round((Math.random() - 0.5) * 12), 0, 255);
    const green = clamp(((colorInt >> 8) & 255) + Math.round((Math.random() - 0.5) * 10), 0, 255);
    const blue = clamp((colorInt & 255) + Math.round((Math.random() - 0.5) * 8), 0, 255);
    return (red << 16) | (green << 8) | blue;
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
        sandGrid: new Uint32Array(cols * rows),
        wallGrid: new Uint8Array(cols * rows),
        pendingLines: [],
        frameParity: 0,
        emitterCarry: 0,
        lastSize: { w: width, h: height },
        offscreenCanvas,
        offscreenContext: offscreenCanvas.getContext('2d', { alpha: false }),
        imageData: new ImageData(cols, rows)
    };
}

function clearBoard(screenState) {
    if (!screenState) return;
    if (screenState.sandGrid) screenState.sandGrid.fill(0);
    if (screenState.wallGrid) screenState.wallGrid.fill(0);
    if (Array.isArray(screenState.pendingLines)) screenState.pendingLines.length = 0;
    screenState.emitterCarry = 0;
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
    clearButton.textContent = 'Clear Board';
    clearButton.style.position = 'absolute';
    clearButton.style.top = '16px';
    clearButton.style.left = '16px';
    clearButton.style.padding = '10px 14px';
    clearButton.style.border = '1px solid rgba(71, 54, 32, 0.32)';
    clearButton.style.borderRadius = '10px';
    clearButton.style.background = 'rgba(255, 250, 240, 0.94)';
    clearButton.style.color = '#3f2f1f';
    clearButton.style.fontSize = '14px';
    clearButton.style.cursor = 'pointer';
    clearButton.style.boxShadow = '0 8px 24px rgba(45, 33, 15, 0.12)';
    clearButton.style.pointerEvents = 'auto';

    const hint = document.createElement('div');
    hint.textContent = 'Draw ramps to steer the sugar stream';
    hint.style.position = 'absolute';
    hint.style.top = '18px';
    hint.style.left = '50%';
    hint.style.transform = 'translateX(-50%)';
    hint.style.padding = '8px 12px';
    hint.style.borderRadius = '999px';
    hint.style.background = 'rgba(255, 250, 240, 0.78)';
    hint.style.color = '#5c4120';
    hint.style.fontSize = '13px';

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
    creditLink.style.background = 'rgba(255, 250, 240, 0.78)';
    creditLink.style.color = '#5c4120';
    creditLink.style.fontSize = '13px';
    creditLink.style.textDecoration = 'none';
    creditLink.style.pointerEvents = 'auto';

    const handleClear = () => {
        clearBoard(game._screen);
        if (context && typeof context.sendGameMessage === 'function') {
            context.sendGameMessage({ event: 'SUGAR_CLEAR' });
        }
    };

    clearButton.addEventListener('click', handleClear);
    overlayRoot.append(clearButton, hint, creditLink);
    document.body.appendChild(overlayRoot);

    if (!game._screen) game._screen = {};
    game._screen.overlayRoot = overlayRoot;
    game._screen.clearButton = clearButton;
    game._screen.creditLink = creditLink;
    game._screen.handleClear = handleClear;

    return overlayRoot;
}

function gridIndex(screenState, gridX, gridY) {
    return (gridY * screenState.cols) + gridX;
}

function canvasPointToGrid(screenState, x, y) {
    return {
        x: clamp(Math.round((x / screenState.lastSize.w) * (screenState.cols - 1)), 0, screenState.cols - 1),
        y: clamp(Math.round((y / screenState.lastSize.h) * (screenState.rows - 1)), 0, screenState.rows - 1)
    };
}

function paintWallDisc(screenState, gridX, gridY, radiusCells) {
    for (let y = -radiusCells; y <= radiusCells; y += 1) {
        const targetY = gridY + y;
        if (targetY < 0 || targetY >= screenState.rows) continue;

        for (let x = -radiusCells; x <= radiusCells; x += 1) {
            const targetX = gridX + x;
            if (targetX < 0 || targetX >= screenState.cols) continue;
            if ((x * x) + (y * y) > radiusCells * radiusCells) continue;

            const index = gridIndex(screenState, targetX, targetY);
            screenState.wallGrid[index] = 1;
            screenState.sandGrid[index] = 0;
        }
    }
}

function applyLine(screenState, line) {
    if (!screenState || !line || !screenState.lastSize.w || !screenState.lastSize.h) return;

    const start = canvasPointToGrid(screenState, line.x1, line.y1);
    const end = canvasPointToGrid(screenState, line.x2, line.y2);
    const radiusCells = Math.max(1, Math.round((line.thicknessPx || 18) / screenState.cellSizePx / 2));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const gridX = Math.round(start.x + (dx * t));
        const gridY = Math.round(start.y + (dy * t));
        paintWallDisc(screenState, gridX, gridY, radiusCells);
    }
}

function spawnSugar(screenState, settings) {
    if (!screenState) return;

    const grainsPerSecond = clamp(Number(settings.sugarDropPerSecond ?? 42), 1, 400);
    const emitterWidthPx = clamp(Number(settings.sugarEmitterWidthPx ?? 30), 4, 220);
    const baseColor = hexToInt(settings.sugarColorHex) ?? hexToInt(DEFAULT_SUGAR_COLOR) ?? 0xefe2bd;

    const emitterRadiusCells = Math.max(0, Math.round((emitterWidthPx / screenState.cellSizePx) / 2));
    const centerX = Math.floor(screenState.cols / 2);
    const spawnCount = Math.floor(screenState.emitterCarry);
    screenState.emitterCarry -= spawnCount;

    for (let grainIndex = 0; grainIndex < spawnCount; grainIndex += 1) {
        const offset = emitterRadiusCells === 0
            ? 0
            : Math.round((Math.random() * 2 - 1) * emitterRadiusCells);
        const gridX = clamp(centerX + offset, 0, screenState.cols - 1);
        const gridY = 0;
        const index = gridIndex(screenState, gridX, gridY);
        if (screenState.wallGrid[index] || screenState.sandGrid[index] !== 0) continue;
        screenState.sandGrid[index] = varySugarColor(baseColor);
    }
}

function stepSugar(screenState) {
    if (!screenState) return;

    const { cols, rows, sandGrid, wallGrid } = screenState;
    for (let y = rows - 2; y >= 0; y -= 1) {
        const leftToRight = ((y + screenState.frameParity) & 1) === 0;
        const start = leftToRight ? 0 : cols - 1;
        const end = leftToRight ? cols : -1;
        const step = leftToRight ? 1 : -1;

        for (let x = start; x !== end; x += step) {
            const index = gridIndex(screenState, x, y);
            const color = sandGrid[index];
            if (color === 0) continue;

            const below = index + cols;
            if (!wallGrid[below] && sandGrid[below] === 0) {
                sandGrid[below] = color;
                sandGrid[index] = 0;
                continue;
            }

            const downLeftOpen = x > 0 && !wallGrid[below - 1] && sandGrid[below - 1] === 0;
            const downRightOpen = x < cols - 1 && !wallGrid[below + 1] && sandGrid[below + 1] === 0;
            if (!downLeftOpen && !downRightOpen) continue;

            const goLeft = downLeftOpen && (!downRightOpen || ((x + y + screenState.frameParity) & 1) === 0);
            const target = goLeft ? below - 1 : below + 1;
            sandGrid[target] = color;
            sandGrid[index] = 0;
        }
    }

    screenState.frameParity += 1;
}

function renderScreen(screenState, canvas, settings) {
    if (!screenState || !screenState.imageData || !screenState.offscreenContext) return;

    const lineColor = hexToInt(settings.sugarLineColorHex) ?? hexToInt(DEFAULT_LINE_COLOR) ?? 0x5b4934;
    const data = screenState.imageData.data;
    for (let index = 0; index < screenState.sandGrid.length; index += 1) {
        const offset = index * 4;
        const sand = screenState.sandGrid[index];

        let color = sand;
        if (screenState.wallGrid[index]) {
            color = lineColor;
        }

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

function getStrokePoint(context, side) {
    const controllerScreenState = context.screenState && context.screenState[side];
    if (controllerScreenState && controllerScreenState.onScreen) {
        return {
            x: controllerScreenState.canvasX,
            y: controllerScreenState.canvasY
        };
    }

    return getHandScreenPoint(context, side);
}

function emitLineSegment(context, settings, side, fromPoint, toPoint) {
    if (!context || typeof context.sendGameMessage !== 'function' || !fromPoint || !toPoint) return;

    context.sendGameMessage({
        event: 'SUGAR_LINE',
        strokeId: side,
        x1: Math.round(fromPoint.x),
        y1: Math.round(fromPoint.y),
        x2: Math.round(toPoint.x),
        y2: Math.round(toPoint.y),
        thicknessPx: clamp(Number(settings.sugarLineThicknessPx ?? 18), 2, 80)
    });
}

export const metadata = {
    id: 'sugar',
    name: 'Sugar Flow',
    description: 'A slow sugar stream falls from the top while you draw ramps to redirect it',
    settings: [
        {
            key: 'sugarDropPerSecond',
            label: 'Drop Rate',
            type: 'number',
            default: 42,
            min: 1,
            max: 400,
            step: 1,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'How many grains spawn per second from the top center'
        },
        {
            key: 'sugarEmitterWidthPx',
            label: 'Emitter Width (px)',
            type: 'number',
            default: 30,
            min: 4,
            max: 220,
            step: 1,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'How wide the sugar source is at the top of the screen'
        },
        {
            key: 'sugarLineThicknessPx',
            label: 'Ramp Thickness (px)',
            type: 'number',
            default: 18,
            min: 2,
            max: 80,
            step: 1,
            tab: 'sugar',
            applyTo: 'vr',
            description: 'Thickness of the ramps you draw on the screen'
        },
        {
            key: 'sugarColorHex',
            label: 'Sugar Color',
            type: 'color',
            default: DEFAULT_SUGAR_COLOR,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'Base color for the falling sugar'
        },
        {
            key: 'sugarLineColorHex',
            label: 'Ramp Color',
            type: 'color',
            default: DEFAULT_LINE_COLOR,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'Color of the ramps you draw'
        },
        {
            key: 'sugarCellSizePx',
            label: 'Cell Size (px)',
            type: 'number',
            default: 4,
            min: 2,
            max: 12,
            step: 1,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'Simulation resolution. Smaller cells look better but cost more'
        },
        {
            key: 'sugarStepsPerFrame',
            label: 'Simulation Steps',
            type: 'number',
            default: 2,
            min: 1,
            max: 6,
            step: 1,
            tab: 'sugar',
            applyTo: 'screen',
            description: 'How many settling passes run each frame'
        }
    ]
};

export default {
    async startVR(context) {
        this.settings = context.settings || {};
        this._vr = {
            pinching: { left: false, right: false },
            lastPoints: { left: null, right: null }
        };
    },

    updateVR(_delta, _time, context) {
        if (!context) return;
        this.settings = context.settings || this.settings || {};

        for (const side of ['left', 'right']) {
            let active = false;
            let point = null;

            const controllerScreenState = context.screenState && context.screenState[side];
            if (controllerScreenState && controllerScreenState.onScreen && isTriggerDown(context, side)) {
                active = true;
                point = { x: controllerScreenState.canvasX, y: controllerScreenState.canvasY };
            } else {
                const tracked = !!(context.handState && context.handState[side] && context.handState[side].tracked);
                if (!tracked) {
                    if (this._vr) this._vr.pinching[side] = false;
                } else {
                    const indexTip = getJointVec3(context.handState, side, 'index-finger-tip');
                    const thumbTip = getJointVec3(context.handState, side, 'thumb-tip');
                    if (!indexTip || !thumbTip) {
                        if (this._vr) this._vr.pinching[side] = false;
                    } else {
                        const distance = indexTip.distanceTo(thumbTip);
                        const wasPinching = !!(this._vr && this._vr.pinching[side]);
                        let isPinching = wasPinching;

                        if (wasPinching && distance > PINCH_DISTANCE_TO_PINCH + PINCH_THRESHOLD) {
                            isPinching = false;
                        } else if (!wasPinching && distance <= PINCH_DISTANCE_TO_PINCH - PINCH_THRESHOLD) {
                            isPinching = true;
                        }

                        if (this._vr) this._vr.pinching[side] = isPinching;
                        if (isPinching) {
                            point = getStrokePoint(context, side);
                            active = !!point;
                        }
                    }
                }
            }

            const previousPoint = this._vr && this._vr.lastPoints ? this._vr.lastPoints[side] : null;
            if (!active || !point) {
                if (this._vr && this._vr.lastPoints) this._vr.lastPoints[side] = null;
                continue;
            }

            emitLineSegment(context, this.settings, side, previousPoint || point, point);
            if (this._vr && this._vr.lastPoints) {
                this._vr.lastPoints[side] = point;
            }
        }
    },

    disposeVR() {
        this._vr = null;
    },

    async startScreen(context) {
        this.settings = context.settings || {};
        const cellSizePx = clamp(Number(this.settings.sugarCellSizePx ?? 4), 2, 12);
        const pendingLines = this._screen && Array.isArray(this._screen.pendingLines)
            ? [...this._screen.pendingLines]
            : [];
        const previousSandGrid = this._screen && this._screen.sandGrid ? this._screen.sandGrid : null;
        const previousWallGrid = this._screen && this._screen.wallGrid ? this._screen.wallGrid : null;
        this._screen = createScreenState(context.canvas, cellSizePx);
        this._screen.pendingLines.push(...pendingLines);
        if (previousSandGrid && previousSandGrid.length === this._screen.sandGrid.length) {
            this._screen.sandGrid.set(previousSandGrid);
        }
        if (previousWallGrid && previousWallGrid.length === this._screen.wallGrid.length) {
            this._screen.wallGrid.set(previousWallGrid);
        }
        ensureOverlay(this, context);
    },

    updateScreen(delta, _time, context) {
        if (!context || !context.canvas) return;
        this.settings = context.settings || this.settings || {};

        const desiredCellSize = clamp(Number(this.settings.sugarCellSizePx ?? 4), 2, 12);
        if (!this._screen
            || !this._screen.lastSize
            || this._screen.lastSize.w !== context.canvas.width
            || this._screen.lastSize.h !== context.canvas.height
            || this._screen.cellSizePx !== desiredCellSize) {
            const pendingLines = this._screen && Array.isArray(this._screen.pendingLines)
                ? [...this._screen.pendingLines]
                : [];
            const previousSandGrid = this._screen && this._screen.sandGrid ? this._screen.sandGrid : null;
            const previousWallGrid = this._screen && this._screen.wallGrid ? this._screen.wallGrid : null;
            const overlayRoot = this._screen && this._screen.overlayRoot ? this._screen.overlayRoot : null;
            const clearButton = this._screen && this._screen.clearButton ? this._screen.clearButton : null;
            const creditLink = this._screen && this._screen.creditLink ? this._screen.creditLink : null;
            const handleClear = this._screen && this._screen.handleClear ? this._screen.handleClear : null;
            const emitterCarry = this._screen && Number.isFinite(this._screen.emitterCarry) ? this._screen.emitterCarry : 0;

            this._screen = createScreenState(context.canvas, desiredCellSize);
            this._screen.pendingLines.push(...pendingLines);
            this._screen.emitterCarry = emitterCarry;
            if (previousSandGrid && previousSandGrid.length === this._screen.sandGrid.length) {
                this._screen.sandGrid.set(previousSandGrid);
            }
            if (previousWallGrid && previousWallGrid.length === this._screen.wallGrid.length) {
                this._screen.wallGrid.set(previousWallGrid);
            }
            this._screen.overlayRoot = overlayRoot;
            this._screen.clearButton = clearButton;
            this._screen.creditLink = creditLink;
            this._screen.handleClear = handleClear;
        }

        ensureOverlay(this, context);

        this._screen.lastSize.w = context.canvas.width;
        this._screen.lastSize.h = context.canvas.height;
        this._screen.emitterCarry += clamp(Number(this.settings.sugarDropPerSecond ?? 42), 1, 400) * Math.max(delta || 0, 0);

        while (this._screen.pendingLines.length > 0) {
            applyLine(this._screen, this._screen.pendingLines.shift());
        }

        spawnSugar(this._screen, this.settings);

        const stepsPerFrame = clamp(Number(this.settings.sugarStepsPerFrame ?? 2), 1, 6);
        for (let stepIndex = 0; stepIndex < stepsPerFrame; stepIndex += 1) {
            stepSugar(this._screen);
        }

        renderScreen(this._screen, context.canvas, this.settings);
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

        if (msg.event === 'SUGAR_CLEAR') {
            clearBoard(this._screen);
            return;
        }

        if (msg.event !== 'SUGAR_LINE') return;

        if (!this._screen) {
            this._screen = {
                pendingLines: [],
                sandGrid: null,
                wallGrid: null,
                emitterCarry: 0
            };
        }
        if (!Array.isArray(this._screen.pendingLines)) {
            this._screen.pendingLines = [];
        }

        this._screen.pendingLines.push({
            x1: typeof msg.x1 === 'number' ? msg.x1 : 0,
            y1: typeof msg.y1 === 'number' ? msg.y1 : 0,
            x2: typeof msg.x2 === 'number' ? msg.x2 : 0,
            y2: typeof msg.y2 === 'number' ? msg.y2 : 0,
            thicknessPx: typeof msg.thicknessPx === 'number' ? msg.thicknessPx : 18
        });

        if (this._screen.pendingLines.length > 256) {
            this._screen.pendingLines.splice(0, this._screen.pendingLines.length - 256);
        }
    }
};