import * as THREE from 'three';
import { init } from './init.js';
import * as cm from './clientManager.js';
import { XR_BUTTONS, XR_AXES } from 'gamepad-wrapper';
import { Text } from 'troika-three-text';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as gameAPI from './gameAPI.js';
import { DEFAULT_GAME_ID } from './games/index.js';

let configScreenMode = 'curved';
let configHandJointsDebugEnabled = false;
let configActiveGameId = DEFAULT_GAME_ID;
let lastGameVRContext = null;

function getActiveScreenMode() {
    return configScreenMode;
}

function setScreenRectOpacity(opacity) {
    if (!screenRect) return;
    screenRect.traverse((node) => {
        if (!node.isMesh || !node.material) return;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((m) => {
            if (!m) return;
            m.transparent = true;
            m.opacity = opacity;
            m.needsUpdate = true;
        });
    });
}

// Redirect to desktop if XR not supported
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!supported) window.location.href = '/desktop';
    });
} else {
    window.location.href = '/desktop';
}

cm.handleEvent('CONFIG_UPDATE', (message) => {
    if (!message) return;

    // Update all settings in gameAPI
    gameAPI.updateSettings(message);

    // Handle active game change
    if (typeof message.activeGameId === 'string') {
        const nextId = message.activeGameId;
        if (nextId && nextId !== configActiveGameId) {
            configActiveGameId = nextId;
            gameAPI.setActiveGame(nextId, { vrContext: lastGameVRContext, settings: gameAPI.getCurrentSettings() });
            if (gameStartedVR && lastGameVRContext) {
                try { void gameAPI.startVR(lastGameVRContext); } catch (e) { console.error('game startVR error', e); }
            }
        }
    }

    // Handle screen geometry mode change
    if (typeof message.screenGeometryMode === 'string') {
        const next = String(message.screenGeometryMode).toLowerCase();
        if (next === 'flat' || next === 'curved') {
            const prev = configScreenMode;
            configScreenMode = next;
            if (prev !== next) {
                // Rebuild screenRect on mode change.
                if (screenRect && screenRect.parent) screenRect.parent.remove(screenRect);
                screenRect = null;
                cachedMeshDimensions = null;
                widgetsSpawned = false;
                if (sceneVar && calibrated) addScreenRect(sceneVar);
            }
        }
    }

    // Handle hand joints debug setting
    if (typeof message.handJointsDebugEnabled === 'boolean') {
        configHandJointsDebugEnabled = message.handJointsDebugEnabled;
    }
});

// ---------- Scene & state ----------
let floor;
let screenRect;
let rayHelper;

let handDebugGroup = null;
let handDebugMeshes = new Map();
let statusDisplay;

let lastScreenRectOverlayEnabled = null;

const EYE_HEIGHT = 1.6;

// Calibration / rect state
let screenWidth = null;
let screenHeight = null;
let aspectRatio = null;
let topLeftCorner = [-0.5, 1.6, -2.0];
let bottomRightCorner = [1.0, 0.8, -2.0];
let rectXDistance = null;
let rectYDistance = null;
let calibrated = false;
let fineTuneMode = true;
let selectedCorner = 'topLeft';
let cornerDistance = 2.0;
let gameStartedVR = false;
let hasTriedLoadingCalibration = false;

// Latest per-frame screen intersection state (populated each frame)
let latestScreenState = { right: { onScreen: false }, left: { onScreen: false } };
// Latest screen metadata snapshot
let latestScreenMeta = { screenWidth: null, screenHeight: null, topLeftCorner: [...topLeftCorner], bottomRightCorner: [...bottomRightCorner], rectXDistance: null, rectYDistance: null };

// Scene refs
let sceneVar = null;
let camVar = null;

// Widget system
let loader = null;
let widgetGroup = null;
let readyButton = null;
let widgetTemplates = { scaleCube: null };
let curvedScreenTemplate = null;
let cachedMeshDimensions = null; // Cache original mesh dimensions to avoid recalculating bbox
let widgetsSpawned = false;
let grabbedWidget = null;
let grabState = null;
let hoveredWidget = null;
let hoveredWidgetHit = null;
let moveHandle = null;
let rotateHandleLeft = null;
let rotateHandleRight = null;

function getScreenCenterVector() {
    return new THREE.Vector3(
        (topLeftCorner[0] + bottomRightCorner[0]) / 2,
        (topLeftCorner[1] + bottomRightCorner[1]) / 2,
        (topLeftCorner[2] + bottomRightCorner[2]) / 2
    );
}

function getScreenYawRadians() {
    return Math.atan2(bottomRightCorner[2] - topLeftCorner[2], bottomRightCorner[0] - topLeftCorner[0]);
}

function getCalibrationDimensions() {
    const width = typeof rectXDistance === 'number' && Number.isFinite(rectXDistance)
        ? rectXDistance
        : Math.hypot(bottomRightCorner[0] - topLeftCorner[0], bottomRightCorner[2] - topLeftCorner[2]);
    const height = typeof rectYDistance === 'number' && Number.isFinite(rectYDistance)
        ? rectYDistance
        : (topLeftCorner[1] - bottomRightCorner[1]);
    return { width, height };
}

function buildCalibrationState() {
    const center = getScreenCenterVector();
    const { width, height } = getCalibrationDimensions();
    return {
        version: 2,
        center: [center.x, center.y, center.z],
        rotationY: getScreenYawRadians(),
        size: { width, height },
        topLeftCorner: [...topLeftCorner],
        bottomRightCorner: [...bottomRightCorner],
        rectXDistance: width,
        rectYDistance: height,
        screenWidth,
        screenHeight,
        aspectRatio,
        savedAt: Date.now()
    };
}

function applyCalibrationState(data) {
    if (!data || !Array.isArray(data.center) || data.center.length < 3) return false;

    const width = data.size && typeof data.size.width === 'number'
        ? data.size.width
        : data.rectXDistance;
    const height = data.size && typeof data.size.height === 'number'
        ? data.size.height
        : data.rectYDistance;
    const rotationY = typeof data.rotationY === 'number'
        ? data.rotationY
        : (Array.isArray(data.topLeftCorner) && Array.isArray(data.bottomRightCorner)
            ? Math.atan2(data.bottomRightCorner[2] - data.topLeftCorner[2], data.bottomRightCorner[0] - data.topLeftCorner[0])
            : 0);

    if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(rotationY)) return false;

    const center = new THREE.Vector3(data.center[0], data.center[1], data.center[2]);
    const xDirection = new THREE.Vector3(Math.cos(rotationY), 0, Math.sin(rotationY));
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const halfHorizontal = xDirection.clone().multiplyScalar(halfWidth);

    topLeftCorner = [
        center.x - halfHorizontal.x,
        center.y + halfHeight,
        center.z - halfHorizontal.z
    ];
    bottomRightCorner = [
        center.x + halfHorizontal.x,
        center.y - halfHeight,
        center.z + halfHorizontal.z
    ];
    rectXDistance = width;
    rectYDistance = height;
    return true;
}

function getWidgetScaleMetrics() {
    const width = Math.max(0.001, rectXDistance || 0.8);
    const height = Math.max(0.001, rectYDistance || 0.45);
    const minDimension = Math.max(0.001, Math.min(width, height));
    const cubeSize = THREE.MathUtils.clamp(minDimension * 0.18, 0.03, 0.0825);
    const centerSize = THREE.MathUtils.clamp(cubeSize * 1.08, 0.035, 0.0975);
    const cornerInset = THREE.MathUtils.clamp(cubeSize * 0.8, 0.025, 0.08);
    const rotateHeight = THREE.MathUtils.clamp(minDimension * 0.42, 0.075, 0.165);
    const rotateWidth = THREE.MathUtils.clamp(cubeSize * 0.55, 0.024, 0.045);
    return { cubeSize, centerSize, cornerInset, rotateHeight, rotateWidth };
}

// ---------- Utilities ----------
function applyColorToMesh(object, hexColor) {
    object.traverse((node) => {
        if (node.isMesh) {
            if (!node.userData.originalMaterial) node.userData.originalMaterial = node.material;
            node.material = new THREE.MeshBasicMaterial({ color: hexColor });
            node.material.needsUpdate = true;
        }
    });
    if (object.userData.originalColor === undefined) object.userData.originalColor = hexColor;
}

function restoreColorFromUserData(object) {
    if (object.userData && object.userData.originalColor !== undefined) {
        applyColorToMesh(object, object.userData.originalColor);
        return;
    }
    object.traverse((node) => {
        if (node.isMesh && node.userData && node.userData.originalMaterial) {
            node.material = node.userData.originalMaterial;
            node.material.needsUpdate = true;
        }
    });
}

function rotatePointAroundY(point, center, angle) {
    const p = point.clone().sub(center);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const x = p.x * cos - p.z * sin;
    const z = p.x * sin + p.z * cos;
    return new THREE.Vector3(x, p.y, z).add(center);
}

// ---------- Widgets ----------
function loadWidgetTemplates() {
    if (!loader) loader = new GLTFLoader();
    const basePath = '/assets/';
    loader.load(basePath + 'scale_cube.glb', (gltf) => { widgetTemplates.scaleCube = gltf.scene.clone(); }, undefined, () => {});
    loader.load(basePath + 'led_wall.glb', (gltf) => { curvedScreenTemplate = gltf.scene.clone(); }, undefined, (error) => { console.error('Failed to load led_wall.glb:', error); });
}

function highlightWidget(widget) {
    if (!widget) return;
    widget.traverse((node) => {
        if (node.isMesh && node.material) {
            if (node.userData._hoverPrevColor === undefined && node.material.color) node.userData._hoverPrevColor = node.material.color.getHex();
            if (node.material.color) node.material.color.setHex(0xffffff);
        }
    });
}
function clearHighlight(widget) {
    if (!widget) return;
    widget.traverse((node) => {
        if (node.isMesh && node.material && node.userData && node.userData._hoverPrevColor !== undefined) {
            node.material.color.setHex(node.userData._hoverPrevColor);
            delete node.userData._hoverPrevColor;
        }
    });
}

function spawnWidgets(scene) {
    if (!widgetGroup || widgetsSpawned) return;
    widgetsSpawned = true;
    const center = new THREE.Vector3(0, -0.3, -0.3);
    while (widgetGroup.children.length) widgetGroup.remove(widgetGroup.children[0]);
    const widgetMetrics = getWidgetScaleMetrics();

    const widgetUnitCube = new THREE.BoxGeometry(1, 1, 1);

    const tlPos = new THREE.Vector3(-0.3, 0, -0.3);
    const brPos = new THREE.Vector3(0.3, -0.6, -0.3);
    const tlMesh = new THREE.Mesh(widgetUnitCube, new THREE.MeshBasicMaterial({color:0xff8800}));
    const brMesh = new THREE.Mesh(widgetUnitCube, new THREE.MeshBasicMaterial({color:0xff8800}));
    tlMesh.scale.setScalar(widgetMetrics.cubeSize);
    brMesh.scale.setScalar(widgetMetrics.cubeSize);
    tlMesh.userData.type = 'scale'; tlMesh.userData.corner = 'topLeft';
    brMesh.userData.type = 'scale'; brMesh.userData.corner = 'bottomRight';
    tlMesh.position.copy(tlPos);
    brMesh.position.copy(brPos);
    applyColorToMesh(tlMesh, 0xff8800);
    applyColorToMesh(brMesh, 0xff8800);
    widgetGroup.add(tlMesh, brMesh);

    const moveMaterial = new THREE.MeshBasicMaterial({ color: 0x0066ff });
    moveHandle = new THREE.Mesh(widgetUnitCube, moveMaterial);
    moveHandle.scale.setScalar(widgetMetrics.centerSize);
    moveHandle.userData.type = 'move';
    moveHandle.position.copy(center);
    applyColorToMesh(moveHandle, 0x0066ff);
    widgetGroup.add(moveHandle);

    readyButton = new THREE.Group();
    readyButton.userData.type = 'ready';
    readyButton.frustumCulled = false;
    const readyGeom = new THREE.BoxGeometry(0.28, 0.10, 0.04);
    const readyMat = new THREE.MeshBasicMaterial({ color: 0x00aa00 });
    const readyMesh = new THREE.Mesh(readyGeom, readyMat);
    readyMesh.frustumCulled = false;
    readyButton.add(readyMesh);
    const readyText = new Text();
    readyText.text = 'Ready?';
    readyText.anchorX = 'center';
    readyText.anchorY = 'middle';
    readyText.fontSize = 0.055;
    readyText.color = 0xffffff;
    readyText.frustumCulled = false;
    readyText.position.set(0, 0, 0.03);
    readyText.sync();
    readyButton.add(readyText);
    readyButton.position.copy(center);
    widgetGroup.add(readyButton);

    const rotateBarGeometry = new THREE.BoxGeometry(0.06, 0.26, 0.06);
    const rotateBarMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    rotateHandleLeft = new THREE.Mesh(rotateBarGeometry, rotateBarMaterial);
    rotateHandleLeft.scale.set(widgetMetrics.rotateWidth / 0.06, widgetMetrics.rotateHeight / 0.26, widgetMetrics.rotateWidth / 0.06);
    rotateHandleLeft.userData.type = 'rotateY';
    rotateHandleLeft.userData.side = 'left';
    applyColorToMesh(rotateHandleLeft, 0xffff00);
    widgetGroup.add(rotateHandleLeft);

    rotateHandleRight = new THREE.Mesh(rotateBarGeometry, rotateBarMaterial);
    rotateHandleRight.scale.set(widgetMetrics.rotateWidth / 0.06, widgetMetrics.rotateHeight / 0.26, widgetMetrics.rotateWidth / 0.06);
    rotateHandleRight.userData.type = 'rotateY';
    rotateHandleRight.userData.side = 'right';
    applyColorToMesh(rotateHandleRight, 0xffff00);
    widgetGroup.add(rotateHandleRight);

    widgetGroup.visible = true;
}

function updateWidgetPositions() {
    if (!widgetGroup || !screenRect) return;

    const widgetMetrics = getWidgetScaleMetrics();

    const screenQ = new THREE.Quaternion();
    screenRect.getWorldQuaternion(screenQ);
    
    // Use the actual corner coordinates (not bbox which changes with rotation)
    const tl = new THREE.Vector3(topLeftCorner[0], topLeftCorner[1], topLeftCorner[2]);
    const br = new THREE.Vector3(bottomRightCorner[0], bottomRightCorner[1], bottomRightCorner[2]);
    const center = tl.clone().add(br).multiplyScalar(0.5);
    
    widgetGroup.children.forEach((child) => {
        if (child.userData && child.userData.type === 'scale') {
            const cornerName = child.userData.corner;
            let cornerPos = cornerName === 'topLeft' ? tl.clone() : br.clone();
            child.scale.setScalar(widgetMetrics.cubeSize);
            
            // Move slightly toward center for visibility
            const inward = center.clone().sub(cornerPos).normalize().multiplyScalar(widgetMetrics.cornerInset);
            const worldPos = cornerPos.clone().add(inward);
            
            if (child.parent) {
                const localPos = worldPos.clone();
                child.parent.worldToLocal(localPos);
                child.position.copy(localPos);
            } else {
                child.position.copy(worldPos);
            }

            child.quaternion.copy(screenQ);
        }
    });

    if (moveHandle && rectYDistance !== null) {
        moveHandle.scale.setScalar(widgetMetrics.centerSize);
        const worldPos = center.clone();
        // Put the handle in the center of the screen, slightly in front of it so it's easy to ray-hit.
        if (screenRect) {
            const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenQ).normalize();
            worldPos.add(normal.multiplyScalar(0.06));
        }
        const localPos = worldPos.clone();
        widgetGroup.worldToLocal(localPos);
        moveHandle.position.copy(localPos);

        moveHandle.quaternion.copy(screenQ);
    }

    if (readyButton && rectYDistance !== null) {
        const worldPos = center.clone();
        // Offset scales with the current calibrated screen size
        worldPos.y -= rectYDistance * 0.6;
        if (screenRect) {
            const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenQ).normalize();
            const normalOffset = (typeof rectXDistance === 'number' && rectXDistance) ? (0.03 * (rectXDistance / 1.0)) : 0.03;
            worldPos.add(normal.multiplyScalar(normalOffset));
        }
        const localPos = worldPos.clone();
        widgetGroup.worldToLocal(localPos);
        readyButton.position.copy(localPos);

        readyButton.quaternion.copy(screenQ);
    }

    if ((rotateHandleLeft || rotateHandleRight) && rectXDistance !== null) {
        const dx = bottomRightCorner[0] - topLeftCorner[0];
        const dz = bottomRightCorner[2] - topLeftCorner[2];
        const screenXDir = new THREE.Vector3(dx, 0, dz);
        if (screenXDir.lengthSq() > 1e-8) screenXDir.normalize();

        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screenQ).normalize();

        const margin = 0.04;
        const xOffset = (rectXDistance / 2) + margin;

        if (rotateHandleLeft) {
            rotateHandleLeft.scale.set(widgetMetrics.rotateWidth / 0.06, widgetMetrics.rotateHeight / 0.26, widgetMetrics.rotateWidth / 0.06);
            const worldPos = center.clone()
                .add(screenXDir.clone().multiplyScalar(-xOffset))
                .add(normal.clone().multiplyScalar(0.02));
            const localPos = worldPos.clone();
            widgetGroup.worldToLocal(localPos);
            rotateHandleLeft.position.copy(localPos);
            rotateHandleLeft.quaternion.copy(screenQ);
        }
        if (rotateHandleRight) {
            rotateHandleRight.scale.set(widgetMetrics.rotateWidth / 0.06, widgetMetrics.rotateHeight / 0.26, widgetMetrics.rotateWidth / 0.06);
            const worldPos = center.clone()
                .add(screenXDir.clone().multiplyScalar(xOffset))
                .add(normal.clone().multiplyScalar(0.02));
            const localPos = worldPos.clone();
            widgetGroup.worldToLocal(localPos);
            rotateHandleRight.position.copy(localPos);
            rotateHandleRight.quaternion.copy(screenQ);
        }
    }
}

// ---------- Scene setup ----------
function setupScene({ scene, camera, renderer, player, controllers }) {
    sceneVar = scene;
    camVar = camera;
    loader = new GLTFLoader();
    widgetGroup = new THREE.Group();
    widgetGroup.visible = false;
    scene.add(widgetGroup);
    loadWidgetTemplates();

    const floorGeometry = new THREE.PlaneGeometry(6, 6);
    const floorMaterial = new THREE.MeshBasicMaterial({color: 'black', transparent: true, opacity: 0.0 });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotateX(-Math.PI / 2);
    floor.position.y = -EYE_HEIGHT;
    scene.add(floor);

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-3)]);
    rayHelper = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    rayHelper.visible = false;
    scene.add(rayHelper);

    handDebugGroup = new THREE.Group();
    handDebugGroup.visible = false;
    scene.add(handDebugGroup);
}

// ---------- Frame loop ----------
async function onFrame(delta, time, {scene, camera, renderer, player, controllers}, xrFrame) {
    // Hide the screenRect visualization when overlay is disabled (but keep it raycastable).
    // Always show it during calibration.
    {
        const settings = gameAPI.getCurrentSettings();
        const overlayOn = !!(settings.displayOverlayEnabled !== undefined ? settings.displayOverlayEnabled : true);
        const shouldShowGhost = !calibrated || overlayOn;
        if (screenRect && lastScreenRectOverlayEnabled !== shouldShowGhost) {
            setScreenRectOpacity(shouldShowGhost ? 0.2 : 0.0);
            lastScreenRectOverlayEnabled = shouldShowGhost;
        }
    }

    // Compute per-controller screen intersection state and screen metadata (store to shared latest values)
    latestScreenMeta = {
        screenWidth,
        screenHeight,
        topLeftCorner: [...topLeftCorner],
        bottomRightCorner: [...bottomRightCorner],
        rectXDistance,
        rectYDistance
    };
    // reset defaults
    latestScreenState.right = { onScreen: false };
    latestScreenState.left = { onScreen: false };
    if (calibrated && screenRect && screenWidth && screenHeight) {
        ['right', 'left'].forEach((side) => {
            const controller = controllers && controllers[side];
            if (!controller) return;
            const { raySpace } = controller;
            if (!raySpace) return;
            const rayDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion);
            const raycaster = new THREE.Raycaster();
            raycaster.set(raySpace.position, rayDirection);
            // Intersect recursively through Group children (for loaded .glb)
            const intersects = raycaster.intersectObject(screenRect, true);
            if (intersects.length > 0) {
                const uv = intersects[0].uv;
                if (!uv) {
                    console.warn('No UV data on curved mesh intersection');
                    latestScreenState[side] = { onScreen: false };
                    return;
                }
                const canvasX = uv.x * screenWidth;
                const canvasY = (1 - uv.y) * screenHeight;
                if (!isNaN(canvasX) && !isNaN(canvasY)) {
                    latestScreenState[side] = { onScreen: true, canvasX: Math.round(canvasX), canvasY: Math.round(canvasY), uv, hitPoint: intersects[0].point };
                } else {
                    latestScreenState[side] = { onScreen: false };
                }
            } else {
                latestScreenState[side] = { onScreen: false };
            }
        });
    }

    let handState = null;
    try {
        const session = renderer && renderer.xr && renderer.xr.getSession ? renderer.xr.getSession() : null;
        if (session && xrFrame && typeof xrFrame.getJointPose === 'function') {
            const referenceSpace = renderer.xr.getReferenceSpace ? renderer.xr.getReferenceSpace() : null;
            if (referenceSpace) {
                handState = { left: { tracked: false, joints: {} }, right: { tracked: false, joints: {} } };
                for (const inputSource of session.inputSources) {
                    if (!inputSource || !inputSource.hand) continue;
                    const handedness = inputSource.handedness;
                    if (handedness !== 'left' && handedness !== 'right') continue;

                    const joints = {};
                    for (const [jointName, jointSpace] of inputSource.hand.entries()) {
                        const pose = xrFrame.getJointPose(jointSpace, referenceSpace);
                        if (!pose) continue;
                        joints[jointName] = {
                            position: [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z],
                            radius: (typeof pose.radius === 'number' ? pose.radius : null),
                        };
                    }

                    handState[handedness] = { tracked: true, joints };
                }
            }
        }
    } catch (e) {
        handState = null;
    }

    if (handDebugGroup) {
        const enabled = !!configHandJointsDebugEnabled;
        handDebugGroup.visible = enabled;
        if (enabled && handState) {
            const used = new Set();
            for (const side of ['left', 'right']) {
                const h = handState[side];
                if (!h || !h.tracked || !h.joints) continue;
                for (const [jointName, joint] of Object.entries(h.joints)) {
                    if (!joint || !Array.isArray(joint.position)) continue;
                    const key = `${side}:${jointName}`;
                    used.add(key);
                    let mesh = handDebugMeshes.get(key);
                    if (!mesh) {
                        const geom = new THREE.SphereGeometry(0.008, 8, 6);
                        const mat = new THREE.MeshBasicMaterial({ color: side === 'left' ? 0x00ffcc : 0xff00cc });
                        mesh = new THREE.Mesh(geom, mat);
                        handDebugGroup.add(mesh);
                        handDebugMeshes.set(key, mesh);
                    }
                    mesh.visible = true;
                    mesh.position.set(joint.position[0], joint.position[1], joint.position[2]);
                    const r = (typeof joint.radius === 'number' && Number.isFinite(joint.radius)) ? joint.radius : null;
                    const s = r ? (r / 0.008) : 1.0;
                    mesh.scale.setScalar(s);
                }
            }
            for (const [key, mesh] of handDebugMeshes.entries()) {
                if (!used.has(key) && mesh) mesh.visible = false;
            }
        } else {
            for (const mesh of handDebugMeshes.values()) {
                if (mesh) mesh.visible = false;
            }
        }
    }

    // Drive game updates when started, provide screenState + screenMeta in the context
    if (gameStartedVR) {
        try {
            const ctx = { scene, camera, renderer, player, controllers, sendGameMessage: gameAPI.sendGameMessage, screenState: latestScreenState, screenMeta: latestScreenMeta, screenRect, handState };
            lastGameVRContext = ctx;
            gameAPI.updateVR(delta, time, ctx);
        } catch (e) {
            console.error('game updateVR error', e);
        }
    }
    const controllerConfigs = [controllers.right, controllers.left];

    // Calibration flow (manual)
    if (!calibrated && aspectRatio) {
        const controller = controllerConfigs[0];
        if (controller && controller.gamepad && controller.raySpace) {
            const { gamepad, raySpace } = controller;
            rayHelper.visible = true;
            rayHelper.position.copy(raySpace.position);
            rayHelper.quaternion.copy(raySpace.quaternion);

            const rayDirection = new THREE.Vector3(0,0,-1).applyQuaternion(raySpace.quaternion).normalize();

            const raycasterWidgets = new THREE.Raycaster();
            raycasterWidgets.set(raySpace.position, rayDirection);
            let widgetIntersects = [];
            if (widgetGroup && widgetGroup.visible) widgetIntersects = raycasterWidgets.intersectObjects(widgetGroup.children, true);

            let hoverTarget = null;
            if (widgetIntersects.length > 0) {
                let hit = widgetIntersects[0].object;
                while (hit.parent && hit.parent !== widgetGroup) hit = hit.parent;
                hoverTarget = hit;
                hoveredWidgetHit = widgetIntersects[0];
            } else {
                hoveredWidgetHit = null;
            }

            if (hoverTarget !== hoveredWidget) {
                if (hoveredWidget) clearHighlight(hoveredWidget);
                hoveredWidget = hoverTarget;
                if (hoveredWidget) highlightWidget(hoveredWidget);
            }

            // Start grab
            if (gamepad.getButtonDown && gamepad.getButtonDown(XR_BUTTONS.TRIGGER) && hoveredWidget && !grabbedWidget) {
                if (hoveredWidget.userData && hoveredWidget.userData.type === 'ready') {
                    // Handle ready button click - commit calibration
                    cm.sendMessage({
                        type: 'CALIBRATION_COMMIT',
                        message: buildCalibrationState()
                    });
                    calibrated = true;
                    saveCalibration();
                    // Start the active game once calibration is committed
                    if (!gameStartedVR) {
                        gameStartedVR = true;
                        try {
                            const startCtx = { scene, camera, renderer, player, controllers, sendGameMessage: gameAPI.sendGameMessage };
                            lastGameVRContext = startCtx;
                            gameAPI.setActiveGame(configActiveGameId, { vrContext: lastGameVRContext });
                            await gameAPI.startVR(startCtx);
                        } catch (e) {
                            console.error('game startVR error', e);
                        }
                    }
                    fineTuneMode = false;
                    rayHelper.visible = false;
                    widgetsSpawned = false;
                    // Keep only the ready button visible
                    if (widgetGroup) {
                        widgetGroup.children.forEach((child) => {
                            if (child.userData && child.userData.type !== 'ready') {
                                child.visible = false;
                            }
                        });
                    }
                    if (readyButton) readyButton.visible = false;
                    if (widgetGroup) widgetGroup.visible = false;
                    if (!screenRect && aspectRatio) addScreenRect(scene);
                    if (screenRect) screenRect.visible = true;
                    return;
                }
                grabbedWidget = hoveredWidget;
                const qWorld = new THREE.Quaternion();
                grabbedWidget.getWorldQuaternion(qWorld);
                const startControllerPos = raySpace.position.clone();
                const startWidgetWorldPos = (() => { const p = new THREE.Vector3(); grabbedWidget.getWorldPosition(p); return p; })();
                grabState = {
                    widget: grabbedWidget,
                    type: grabbedWidget.userData.type || 'unknown',
                    startControllerPos,
                    startControllerQuat: raySpace.quaternion.clone(),
                    startTopLeft: [...topLeftCorner],
                    startBottomRight: [...bottomRightCorner],
                    startWidgetWorldPos
                };
                if ((grabState.type === 'move' || grabState.type === 'scale' || grabState.type === 'rotateY') && hoveredWidgetHit) {
                    grabState.grabDistance = hoveredWidgetHit.distance;
                    grabState.grabOffset = startWidgetWorldPos.clone().sub(hoveredWidgetHit.point);
                }
                if (grabState.type === 'rotateY') {
                    const centerW = new THREE.Vector3(
                        grabState.startTopLeft[0] + (grabState.startBottomRight[0] - grabState.startTopLeft[0]) / 2,
                        grabState.startTopLeft[1] - (rectYDistance / 2),
                        grabState.startTopLeft[2] + (grabState.startBottomRight[2] - grabState.startTopLeft[2]) / 2
                    );
                    grabState.rotateCenter = centerW;
                    if (typeof grabState.grabDistance === 'number') {
                        const rayDir = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion).normalize();
                        const hitPoint = raySpace.position.clone().add(rayDir.multiplyScalar(grabState.grabDistance));
                        const offset = grabState.grabOffset ? grabState.grabOffset.clone() : new THREE.Vector3();
                        const anchoredPos = hitPoint.clone().add(offset);
                        const rel = anchoredPos.clone().sub(centerW);
                        grabState.startRotateAngle = Math.atan2(rel.z, rel.x);
                    } else {
                        const rel = startControllerPos.clone().sub(centerW);
                        grabState.startRotateAngle = Math.atan2(rel.z, rel.x);
                    }
                }
                applyColorToMesh(grabbedWidget, 0xffffff);
                if (hoveredWidget) { clearHighlight(hoveredWidget); hoveredWidget = null; }
            }

            // Update while grabbing
            if (grabbedWidget && gamepad.getButton && gamepad.getButton(XR_BUTTONS.TRIGGER)) {
                const type = grabbedWidget.userData.type;
                if (type === 'move') {
                    const rayDir = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion).normalize();
                    const d = typeof grabState.grabDistance === 'number' ? grabState.grabDistance : 0;
                    const hitPoint = raySpace.position.clone().add(rayDir.multiplyScalar(d));
                    const offset = grabState.grabOffset ? grabState.grabOffset.clone() : new THREE.Vector3();
                    const newWorldPos = hitPoint.clone().add(offset);
                    const translateVec = newWorldPos.clone().sub(grabState.startWidgetWorldPos);
                    topLeftCorner[0] = grabState.startTopLeft[0] + translateVec.x;
                    topLeftCorner[1] = grabState.startTopLeft[1] + translateVec.y;
                    topLeftCorner[2] = grabState.startTopLeft[2] + translateVec.z;
                    bottomRightCorner[0] = grabState.startBottomRight[0] + translateVec.x;
                    bottomRightCorner[1] = grabState.startBottomRight[1] + translateVec.y;
                    bottomRightCorner[2] = grabState.startBottomRight[2] + translateVec.z;

                    if (grabbedWidget.parent) {
                        const localPos = newWorldPos.clone();
                        grabbedWidget.parent.worldToLocal(localPos);
                        grabbedWidget.position.copy(localPos);
                    } else {
                        grabbedWidget.position.copy(newWorldPos);
                    }
                } else if (type === 'scale') {
                    const cornerName = grabbedWidget.userData.corner;
                    const startTL = grabState.startTopLeft;
                    const startBR = grabState.startBottomRight;
                    const startTLV = new THREE.Vector3(startTL[0], startTL[1], startTL[2]);
                    const startBRV = new THREE.Vector3(startBR[0], startBR[1], startBR[2]);
                    
                    // Fixed corner is the opposite of the one being dragged
                    const fixedCorner = cornerName === 'topLeft' ? startBRV : startTLV;
                    const movingCorner = cornerName === 'topLeft' ? startTLV : startBRV;
                    
                    // Direction from fixed corner to moving corner
                    const direction = movingCorner.clone().sub(fixedCorner);
                    const dirLen = direction.length();
                    if (dirLen < 1e-6) return;
                    const dirNorm = direction.clone().normalize();
                    
                    // Calculate how much the controller has moved along the diagonal
                    let projected = 0;
                    if (typeof grabState.grabDistance === 'number') {
                        const rayDir = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion).normalize();
                        const hitPoint = raySpace.position.clone().add(rayDir.multiplyScalar(grabState.grabDistance));
                        const offset = grabState.grabOffset ? grabState.grabOffset.clone() : new THREE.Vector3();
                        const anchoredPos = hitPoint.clone().add(offset);
                        const delta = anchoredPos.clone().sub(grabState.startWidgetWorldPos);
                        projected = delta.dot(dirNorm);
                    } else {
                        const curr = raySpace.position;
                        const delta = curr.clone().sub(grabState.startControllerPos);
                        projected = delta.dot(dirNorm);
                    }
                    
                    // Scale factor based on movement
                    const k = 1.0;
                    const scaleFactor = Math.exp(k * (projected / Math.max(0.001, dirLen)));
                    
                    // Calculate new diagonal vector maintaining direction (and thus aspect ratio)
                    const newDirection = direction.clone().multiplyScalar(scaleFactor);
                    const newMovingCorner = fixedCorner.clone().add(newDirection);
                    
                    // Update corners
                    if (cornerName === 'topLeft') {
                        topLeftCorner = [newMovingCorner.x, newMovingCorner.y, newMovingCorner.z];
                        bottomRightCorner = [fixedCorner.x, fixedCorner.y, fixedCorner.z];
                    } else {
                        bottomRightCorner = [newMovingCorner.x, newMovingCorner.y, newMovingCorner.z];
                        topLeftCorner = [fixedCorner.x, fixedCorner.y, fixedCorner.z];
                    }
                } else if (type === 'rotateY') {
                    const centerW = grabState.rotateCenter ? grabState.rotateCenter.clone() : new THREE.Vector3(
                        grabState.startTopLeft[0] + (grabState.startBottomRight[0] - grabState.startTopLeft[0]) / 2,
                        grabState.startTopLeft[1] - (rectYDistance / 2),
                        grabState.startTopLeft[2] + (grabState.startBottomRight[2] - grabState.startTopLeft[2]) / 2
                    );
                    let currAngle = 0;
                    if (typeof grabState.grabDistance === 'number') {
                        const rayDir = new THREE.Vector3(0, 0, -1).applyQuaternion(raySpace.quaternion).normalize();
                        const hitPoint = raySpace.position.clone().add(rayDir.multiplyScalar(grabState.grabDistance));
                        const offset = grabState.grabOffset ? grabState.grabOffset.clone() : new THREE.Vector3();
                        const anchoredPos = hitPoint.clone().add(offset);
                        const rel = anchoredPos.clone().sub(centerW);
                        currAngle = Math.atan2(rel.z, rel.x);
                    } else {
                        const rel = raySpace.position.clone().sub(centerW);
                        currAngle = Math.atan2(rel.z, rel.x);
                    }
                    const startAngle = grabState.startRotateAngle !== undefined ? grabState.startRotateAngle : 0;
                    const deltaAngle = currAngle - startAngle;

                    const tl = new THREE.Vector3(grabState.startTopLeft[0], grabState.startTopLeft[1], grabState.startTopLeft[2]);
                    const br = new THREE.Vector3(grabState.startBottomRight[0], grabState.startBottomRight[1], grabState.startBottomRight[2]);
                    const newTL = rotatePointAroundY(tl, centerW, deltaAngle);
                    const newBR = rotatePointAroundY(br, centerW, deltaAngle);
                    topLeftCorner = [newTL.x, newTL.y, newTL.z];
                    bottomRightCorner = [newBR.x, newBR.y, newBR.z];
                }
                // Update measures & visuals
                const dx = bottomRightCorner[0] - topLeftCorner[0];
                const dz = bottomRightCorner[2] - topLeftCorner[2];
                rectXDistance = Math.sqrt(dx * dx + dz * dz);
                rectYDistance = topLeftCorner[1] - bottomRightCorner[1]; // Use actual Y distance
                addScreenRect(scene);
            }

            // Release grab
            if (grabbedWidget && (!gamepad.getButton || !gamepad.getButton(XR_BUTTONS.TRIGGER))) {
                if (grabbedWidget) restoreColorFromUserData(grabbedWidget);
                grabbedWidget = null;
                grabState = null;
                if (!calibrated) {
                    widgetsSpawned = false;
                    if (widgetGroup) widgetGroup.visible = true;
                    spawnWidgets(scene);
                }
            }

            // Adjust distance with thumbstick
            const thumbstickY = gamepad.getAxis(XR_AXES.THUMBSTICK_Y);
            if (Math.abs(thumbstickY) > 0.1) {
                cornerDistance += -thumbstickY * 0.02;
                cornerDistance = Math.max(0.5, Math.min(cornerDistance, 10));
            }

            // Switch corner with B
            if (gamepad.getButtonDown(XR_BUTTONS.BUTTON_2)) {
                selectedCorner = selectedCorner === 'topLeft' ? 'bottomRight' : 'topLeft';
                cornerDistance = 2.0;
            }

            // Keep live rectangle updated
            if (aspectRatio) {
                const directionX = bottomRightCorner[0] - topLeftCorner[0];
                const directionZ = bottomRightCorner[2] - topLeftCorner[2];
                rectXDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
                rectYDistance = topLeftCorner[1] - bottomRightCorner[1]; // Use actual Y distance
            }
            addScreenRect(scene);
        }
        return;
    }

    // If not calibrated, nothing else to do
    if (!calibrated) return;

    // Allow right controller trigger on confirm ball to restart calibration
    try {
        const rightController = controllerConfigs[0];
        if (calibrated && rightController && rightController.gamepad && rightController.raySpace) {
            const { gamepad, raySpace } = rightController;
            
            // Check if aiming at ready button
            const rayDirection = new THREE.Vector3(0,0,-1).applyQuaternion(raySpace.quaternion).normalize();
            const raycaster = new THREE.Raycaster();
            raycaster.set(raySpace.position, rayDirection);
            let readyIntersects = [];
            if (readyButton && readyButton.visible) {
                readyIntersects = raycaster.intersectObject(readyButton, true);
            }
            
            // Highlight ball when hovering
            if (readyIntersects.length > 0) {
                highlightWidget(readyButton);
                
                // Trigger on ball restarts calibration
                if (gamepad.getButtonDown && gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                    calibrated = false;
                    fineTuneMode = true;
                    selectedCorner = 'topLeft';
                    cornerDistance = 2.0;
                    widgetsSpawned = false;
                    if (widgetGroup) {
                        widgetGroup.visible = true;
                        // Make all widgets visible again
                        widgetGroup.children.forEach((child) => {
                            child.visible = true;
                        });
                    }
                    if (sceneVar) spawnWidgets(sceneVar);
                    rayHelper.visible = true;
                    if (screenRect && screenRect.parent) { screenRect.parent.remove(screenRect); screenRect = null; }
                }
            } else {
                // Clear highlight when not hovering
                if (readyButton) clearHighlight(readyButton);
            }
        }
    } catch (e) {
        console.warn('restart-via-ball error', e);
    }
}

// ---------- Screen rect & labels ----------
function addScreenRect(scene) {
    const directionX = bottomRightCorner[0] - topLeftCorner[0];
    const directionZ = bottomRightCorner[2] - topLeftCorner[2];
    const angle = Math.atan2(directionZ, directionX);
    const cornerDistance = Math.sqrt(directionX * directionX + directionZ * directionZ);
    rectXDistance = cornerDistance;
    rectYDistance = topLeftCorner[1] - bottomRightCorner[1]; // Use actual Y distance, not aspect-locked

    if (!screenRect) {
        if (getActiveScreenMode() === 'flat') {
            const unitGeometry = new THREE.PlaneGeometry(1, 1);
            const screenRectMaterial = new THREE.MeshBasicMaterial({
                color: 'white',
                transparent: true,
                opacity: 0.2,
                side: THREE.DoubleSide
            });
            screenRect = new THREE.Mesh(unitGeometry, screenRectMaterial);
        } else if (curvedScreenTemplate) {
            screenRect = curvedScreenTemplate.clone();
            // Apply transparent material to all meshes in the loaded model
            screenRect.traverse((node) => {
                if (node.isMesh) {
                    node.material = new THREE.MeshBasicMaterial({
                        color: 'white',
                        transparent: true,
                        opacity: 0.2,
                        side: THREE.DoubleSide
                    });
                    node.material.needsUpdate = true;
                    node.frustumCulled = false;
                }
            });
        } else {
            // Fallback to plane if mesh not loaded yet
            console.warn('Curved screen template not loaded, using fallback plane');
            const unitGeometry = new THREE.PlaneGeometry(1, 1);
            const screenRectMaterial = new THREE.MeshBasicMaterial({
                color: 'white',
                transparent: true,
                opacity: 0.2,
                side: THREE.DoubleSide
            });
            screenRect = new THREE.Mesh(unitGeometry, screenRectMaterial);
        }
        screenRect.name = 'screenRect';
        screenRect.frustumCulled = false;
        scene.add(screenRect);
        
        // Calculate and cache bounding box dimensions once when mesh is first created
        screenRect.updateMatrixWorld(true); // Ensure matrix is updated before bbox calculation
        const bbox = new THREE.Box3().setFromObject(screenRect);
        cachedMeshDimensions = {
            width: bbox.max.x - bbox.min.x,
            height: bbox.max.y - bbox.min.y,
            depth: bbox.max.z - bbox.min.z
        };
    }

    // Use cached dimensions if available, otherwise fall back to calculating (for plane fallback)
    const meshWidth = cachedMeshDimensions ? cachedMeshDimensions.width : 1;
    const meshHeight = cachedMeshDimensions ? cachedMeshDimensions.height : 1;

    // Calculate scale to match calibrated dimensions
    const scaleX = rectXDistance / meshWidth;
    const scaleY = rectYDistance / meshHeight;
    const scaleZ = scaleX; // Maintain curve depth proportional to width

    screenRect.scale.set(scaleX, scaleY, scaleZ);
    const centerPos = new THREE.Vector3(
        topLeftCorner[0] + (rectXDistance / 2) * Math.cos(angle),
        topLeftCorner[1] - (rectYDistance / 2),
        topLeftCorner[2] + (rectXDistance / 2) * Math.sin(angle)
    );
    screenRect.position.copy(centerPos);
    // Curved GLB is authored facing opposite our expected forward, so we flip it.
    // A plain PlaneGeometry is already aligned, so flipping would mirror UV->world mapping.
    const flipY = getActiveScreenMode() === 'flat' ? 0 : Math.PI;
    screenRect.rotation.set(0, -angle + flipY, 0);

    updateWidgetPositions();
}

// ---------- Calibration persistence ----------
function saveCalibration() {
    try {
        const data = buildCalibrationState();
        localStorage.setItem('vr-calibration', JSON.stringify(data));
        console.log('Calibration saved to localStorage');
    } catch (e) {
        console.warn('Failed to save calibration:', e);
    }
}

function loadCalibration() {
    try {
        const stored = localStorage.getItem('vr-calibration');
        if (!stored) return false;
        
        const data = JSON.parse(stored);
        if (applyCalibrationState(data)) {
            console.log('Calibration loaded from localStorage');
            return true;
        }

        if (!data.topLeftCorner || !data.bottomRightCorner || 
            typeof data.rectXDistance !== 'number' || typeof data.rectYDistance !== 'number') {
            return false;
        }

        topLeftCorner = [...data.topLeftCorner];
        bottomRightCorner = [...data.bottomRightCorner];
        rectXDistance = data.rectXDistance;
        rectYDistance = data.rectYDistance;
        console.log('Calibration loaded from localStorage (legacy format)');
        return true;
    } catch (e) {
        console.warn('Failed to load calibration:', e);
        return false;
    }
}

function clearCalibration() {
    try {
        localStorage.removeItem('vr-calibration');
        console.log('Calibration cleared from localStorage');
    } catch (e) {
        console.warn('Failed to clear calibration:', e);
    }
}

// ---------- Calibration messages ----------
function handleCalibration(message) {
    screenWidth = message.screenWidth;
    screenHeight = message.screenHeight;
    aspectRatio = screenWidth / screenHeight;

    // Try to load from localStorage once (before sceneVar is ready)
    if (!hasTriedLoadingCalibration && !calibrated) {
        hasTriedLoadingCalibration = true;
        const loaded = loadCalibration();
        if (loaded) {
            console.log('Loaded previous calibration position from localStorage');
        }
    }

    // If sceneVar is ready and we have loaded calibration data, initialize with it
    if (!calibrated && !screenRect && sceneVar && rectXDistance && rectYDistance) {
        addScreenRect(sceneVar);
        spawnWidgets(sceneVar);
        console.log('Initialized with loaded calibration - adjust and press Ready to confirm');
        return;
    }
    
    // If we're already calibrated, keep width (rectXDistance) and adapt height to match aspect ratio.
    if (calibrated && rectXDistance && aspectRatio) {
        const prevRectY = rectYDistance;
        const nextRectY = rectXDistance / aspectRatio;
        if (!prevRectY || Math.abs(nextRectY - prevRectY) > 1e-6) {
            const tl = new THREE.Vector3(topLeftCorner[0], topLeftCorner[1], topLeftCorner[2]);
            const br = new THREE.Vector3(bottomRightCorner[0], bottomRightCorner[1], bottomRightCorner[2]);
            const center = tl.clone().add(br).multiplyScalar(0.5);
            rectYDistance = nextRectY;

            // Preserve horizontal placement and rotation; adjust Y extents about center.
            topLeftCorner[1] = center.y + rectYDistance / 2;
            bottomRightCorner[1] = center.y - rectYDistance / 2;

            addScreenRect(sceneVar);
            updateWidgetPositions();
        }
        return;
    }

    if (calibrated) return;

    if (sceneVar && !screenRect) {
        if (!curvedScreenTemplate) {
            console.warn('Curved screen template not loaded yet, retrying in 500ms...');
            setTimeout(() => handleCalibration(message), 500);
            return;
        }
        
        // Only use default position if we didn't load from localStorage
        if (!rectXDistance || !rectYDistance) {
            const center = new THREE.Vector3(0, -0.3, -0.6);
            rectXDistance = 1.0;
            rectYDistance = aspectRatio ? (rectXDistance / aspectRatio) : 0.5;
            topLeftCorner = [center.x - rectXDistance / 2, center.y + rectYDistance / 2, center.z];
            bottomRightCorner = [center.x + rectXDistance / 2, center.y - rectYDistance / 2, center.z];
        }
        
        addScreenRect(sceneVar);
        spawnWidgets(sceneVar);
    }
}

function resetCalibration() {
    calibrated = false;
    fineTuneMode = true;
    clearCalibration();
    hasTriedLoadingCalibration = false;
    selectedCorner = 'topLeft';
    if (screenRect) { sceneVar.remove(screenRect); screenRect = null; }
    if (frontLabel) { if (frontLabel.parent) frontLabel.parent.remove(frontLabel); frontLabel = null; }
    if (backLabel) { if (backLabel.parent) backLabel.parent.remove(backLabel); backLabel = null; }
    cachedMeshDimensions = null; // Reset cached dimensions
    topLeftCorner = [-0.5, 1.6, -2.0];
    bottomRightCorner = [1.0, 0.8, -2.0];
    rectXDistance = null;
    rectYDistance = null;
    aspectRatio = null;
}

// ---------- Registration ----------
cm.registerToServer('VR').then(updateStatus).catch((e) => { console.error('Failed to register:', e); updateStatus(); });
function updateStatus() {
    const state = cm.getConnectionState();
    void state;
}

cm.handleEvent('CLOSE', updateStatus);
cm.handleEvent('SCREEN_CALIBRATION', handleCalibration);
cm.handleEvent('SCREEN_DISCONNECTED', resetCalibration);

// Initialize XR scene
init(setupScene, onFrame);