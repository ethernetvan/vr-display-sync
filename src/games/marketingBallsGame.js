import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export const metadata = {
    id: 'marketing',
    name: 'ImmerseGT',
    description: 'Multi-ball physics simulation with hand swipe and controller interaction',
    settings: [
        {
            key: 'displayOverlayEnabled',
            label: 'Display Overlay',
            type: 'boolean',
            default: true,
            tab: 'marketing',
            applyTo: 'vr',
            description: 'Show ball markers and crosshair in VR'
        },
        {
            key: 'gravityMultiplier',
            label: 'Gravity Multiplier',
            type: 'number',
            default: 1.0,
            min: 0,
            step: 0.1,
            tab: 'marketing',
            applyTo: 'screen',
            description: 'Multiplier for gravity (1.0 = Earth gravity)'
        },
        {
            key: 'swipeForceMultiplier',
            label: 'Swipe Force Multiplier',
            type: 'number',
            default: 1.0,
            min: 0,
            step: 0.1,
            tab: 'marketing',
            applyTo: 'screen',
            description: 'Multiplier for swipe impulse force'
        },
        {
            key: 'handTouchRadiusMeters',
            label: 'Hand Touch Radius (m)',
            type: 'number',
            default: 0.06,
            min: 0,
            step: 0.005,
            tab: 'marketing',
            applyTo: 'vr',
            description: 'Touch detection radius for hand joints'
        },
        {
            key: 'handMinSwipeSpeedMetersPerSec',
            label: 'Hand Min Swipe Speed (m/s)',
            type: 'number',
            default: 0.25,
            min: 0,
            step: 0.05,
            tab: 'marketing',
            applyTo: 'vr',
            description: 'Minimum velocity threshold for hand swipe'
        },
        {
            key: 'handSwipeBallCooldownSec',
            label: 'Hand Cooldown (s)',
            type: 'number',
            default: 0.10,
            min: 0,
            step: 0.01,
            tab: 'marketing',
            applyTo: 'vr',
            description: 'Cooldown between successive impulses per ball'
        }
    ]
};

export default {
    // Instance variables here
    impulseMultiplierX: 500,
    impulseMultiplierY: 700,

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage, settings }
    async startVR(context) {
        // Store settings
        this.settings = context.settings || {};

        this.latestPoint = {};
        this.latestBallsState = null;
        this.prevControllerPositions = { right: null, left: null };
        this.prevGripPositions = { right: null, left: null };
        this.wasTouchingRay = { right: false, left: false };
        this.wasTouchingBallId = { right: null, left: null };

        this.prevHandJointPositions = new Map();
        this.wasTouchingHandJoint = new Map();
        this.lastHandImpulseTimeByBallId = new Map();

        this.markers = new Map();

        // Create cross-hair lines perpendicular to the direction vector
        const horizontalMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
        const verticalMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        
        const points = [ new THREE.Vector3(), new THREE.Vector3() ];
        
        this.horizontalLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            horizontalMaterial
        );
        this.horizontalLine.frustumCulled = false;
        context.scene.add(this.horizontalLine);
        
        this.verticalLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            verticalMaterial
        );
        this.verticalLine.frustumCulled = false;
        context.scene.add(this.verticalLine);

        // Line to show controller crossing direction
        const crossingMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 });
        this.crossingLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            crossingMaterial
        );
        this.crossingLine.frustumCulled = false;
        this.crossingLine.visible = false;
        context.scene.add(this.crossingLine);
        
        // Cone to show direction of crossing
        const coneGeometry = new THREE.ConeGeometry(0.02, 0.06, 8);
        const coneMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.crossingCone = new THREE.Mesh(coneGeometry, coneMaterial);
        this.crossingCone.frustumCulled = false;
        this.crossingCone.visible = false;
        context.scene.add(this.crossingCone);
        
        this.crossingFadeTime = 0;
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect, settings }
    updateVR(delta, time, context) {
        // Update settings from context if provided
        if (context && context.settings) {
            this.settings = context.settings;
        }

        const displayOverlayEnabled = this.settings.displayOverlayEnabled !== undefined 
            ? this.settings.displayOverlayEnabled 
            : true;
        const touchRadiusMeters = this.settings.handTouchRadiusMeters !== undefined
            ? this.settings.handTouchRadiusMeters
            : 0.06;
        const minSwipeSpeedMetersPerSec = this.settings.handMinSwipeSpeedMetersPerSec !== undefined
            ? this.settings.handMinSwipeSpeedMetersPerSec
            : 0.25;
        const handSwipeBallCooldownSec = this.settings.handSwipeBallCooldownSec !== undefined
            ? this.settings.handSwipeBallCooldownSec
            : 0.10;

        const getWorldPointForCanvasXY = (canvasX, canvasY, screenWidth, screenHeight) => {
            if (!context || !context.screenRect || !context.screenMeta) return null;
            if (!screenWidth || !screenHeight) return null;
            const targetUVx = canvasX / screenWidth;
            const targetUVy = 1 - (canvasY / screenHeight);

            let worldPoint = null;
            context.screenRect.traverse((node) => {
                if (node.isMesh && node.geometry && !worldPoint) {
                    const geometry = node.geometry;
                    const positionAttr = geometry.getAttribute('position');
                    const uvAttr = geometry.getAttribute('uv');

                    if (positionAttr && uvAttr) {
                        const index = geometry.index;
                        const faceCount = index ? index.count / 3 : positionAttr.count / 3;
                        for (let i = 0; i < faceCount; i++) {
                            const i0 = index ? index.getX(i * 3) : i * 3;
                            const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
                            const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;

                            const uv0 = new THREE.Vector2(uvAttr.getX(i0), uvAttr.getY(i0));
                            const uv1 = new THREE.Vector2(uvAttr.getX(i1), uvAttr.getY(i1));
                            const uv2 = new THREE.Vector2(uvAttr.getX(i2), uvAttr.getY(i2));

                            const targetUV = new THREE.Vector2(targetUVx, targetUVy);
                            const v0 = uv1.clone().sub(uv0);
                            const v1 = uv2.clone().sub(uv0);
                            const v2 = targetUV.clone().sub(uv0);

                            const d00 = v0.dot(v0);
                            const d01 = v0.dot(v1);
                            const d11 = v1.dot(v1);
                            const d20 = v2.dot(v0);
                            const d21 = v2.dot(v1);

                            const denom = d00 * d11 - d01 * d01;
                            if (Math.abs(denom) < 0.0001) continue;

                            const v = (d11 * d20 - d01 * d21) / denom;
                            const w = (d00 * d21 - d01 * d20) / denom;
                            const u = 1 - v - w;

                            if (u >= -0.01 && v >= -0.01 && w >= -0.01) {
                                const p0 = new THREE.Vector3(positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0));
                                const p1 = new THREE.Vector3(positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1));
                                const p2 = new THREE.Vector3(positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2));

                                const localPos = new THREE.Vector3()
                                    .addScaledVector(p0, u)
                                    .addScaledVector(p1, v)
                                    .addScaledVector(p2, w);

                                worldPoint = localPos.clone();
                                node.localToWorld(worldPoint);
                                break;
                            }
                        }
                    }
                }
            });

            if (!worldPoint) {
                const local = new THREE.Vector3((targetUVx - 0.5) * context.screenMeta.rectXDistance, (0.5 - targetUVy) * context.screenMeta.rectYDistance, 0);
                worldPoint = local.clone();
                context.screenRect.localToWorld(worldPoint);
            }

            return worldPoint;
        };

        const getBallWorldPoints = () => {
            if (!this.latestBallsState) return null;
            const state = this.latestBallsState;
            if (!state || !Array.isArray(state.balls) || !state.screenWidth || !state.screenHeight) return null;

            const out = [];
            for (let i = 0; i < state.balls.length; i++) {
                const b = state.balls[i];
                const id = b && (b.id ?? i);
                if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') continue;

                const wp = getWorldPointForCanvasXY(b.x, b.y, state.screenWidth, state.screenHeight);
                if (!wp) continue;

                out.push({ id, worldPoint: wp });
            }
            return out;
        };

        // Multi-ball overlay rendering
        if (this.latestBallsState && context && context.screenRect) {
            const state = this.latestBallsState;
            const balls = Array.isArray(state.balls) ? state.balls : [];
            const used = new Set();

            balls.forEach((b, idx) => {
                const id = b.id ?? idx;
                used.add(String(id));
                const color = typeof b.color === 'number' ? b.color : 0xff0000;
                const rPx = typeof b.radius === 'number' ? b.radius : 10;

                let mesh = this.markers.get(String(id));
                if (!mesh) {
                    const mat = new THREE.MeshBasicMaterial({ color });
                    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), mat);
                    mesh.frustumCulled = false;
                    context.scene.add(mesh);
                    this.markers.set(String(id), mesh);
                }

                if (mesh.material && mesh.material.color) mesh.material.color.setHex(color);

                const worldPoint = getWorldPointForCanvasXY(b.x, b.y, state.screenWidth, state.screenHeight);
                if (worldPoint) {
                    mesh.position.copy(worldPoint);
                }

                // Approximate pixel->world scaling based on screen height.
                const rectY = context.screenMeta && context.screenMeta.rectYDistance ? context.screenMeta.rectYDistance : 1;
                const pxToMeters = rectY / (state.screenHeight || 1);
                const rMeters = Math.max(0.005, rPx * pxToMeters);
                const base = 0.02;
                mesh.scale.setScalar(rMeters / base);
                mesh.visible = !!displayOverlayEnabled;
            });

            for (const [id, mesh] of this.markers.entries()) {
                if (!used.has(id)) {
                    mesh.visible = false;
                }
            }
        }

        // Keep legacy single-point overlay logic for crosshair, but for swipe targeting prefer the closest ball.
        if (this.latestPoint && context.screenRect) {
            const point = this.latestPoint;
            const targetUVx = point.canvasX / point.screenWidth;
            const targetUVy = 1 - (point.canvasY / point.screenHeight); // Note: flipped for Three.js UV space
            
            // Find the position on the curved screen mesh by sampling the geometry
            let worldPoint = null;
            context.screenRect.traverse((node) => {
                if (node.isMesh && node.geometry && !worldPoint) {
                    const geometry = node.geometry;
                    const positionAttr = geometry.getAttribute('position');
                    const uvAttr = geometry.getAttribute('uv');
                    
                    if (positionAttr && uvAttr) {
                        // Find closest triangle by UV coordinates
                        let closestDist = Infinity;
                        let closestPos = new THREE.Vector3();
                        
                        const index = geometry.index;
                        const faceCount = index ? index.count / 3 : positionAttr.count / 3;
                        
                        for (let i = 0; i < faceCount; i++) {
                            const i0 = index ? index.getX(i * 3) : i * 3;
                            const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
                            const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
                            
                            const uv0 = new THREE.Vector2(uvAttr.getX(i0), uvAttr.getY(i0));
                            const uv1 = new THREE.Vector2(uvAttr.getX(i1), uvAttr.getY(i1));
                            const uv2 = new THREE.Vector2(uvAttr.getX(i2), uvAttr.getY(i2));
                            
                            // Check if target UV is inside this triangle
                            const targetUV = new THREE.Vector2(targetUVx, targetUVy);
                            const barycentric = new THREE.Vector3();
                            
                            // Simple barycentric coordinate calculation
                            const v0 = uv1.clone().sub(uv0);
                            const v1 = uv2.clone().sub(uv0);
                            const v2 = targetUV.clone().sub(uv0);
                            
                            const d00 = v0.dot(v0);
                            const d01 = v0.dot(v1);
                            const d11 = v1.dot(v1);
                            const d20 = v2.dot(v0);
                            const d21 = v2.dot(v1);
                            
                            const denom = d00 * d11 - d01 * d01;
                            if (Math.abs(denom) < 0.0001) continue;
                            
                            const v = (d11 * d20 - d01 * d21) / denom;
                            const w = (d00 * d21 - d01 * d20) / denom;
                            const u = 1 - v - w;
                            
                            // Check if point is inside triangle (with some tolerance)
                            if (u >= -0.01 && v >= -0.01 && w >= -0.01) {
                                const p0 = new THREE.Vector3(positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0));
                                const p1 = new THREE.Vector3(positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1));
                                const p2 = new THREE.Vector3(positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2));
                                
                                // Interpolate position using barycentric coordinates
                                const localPos = new THREE.Vector3()
                                    .addScaledVector(p0, u)
                                    .addScaledVector(p1, v)
                                    .addScaledVector(p2, w);
                                
                                // Convert to world space
                                worldPoint = localPos.clone();
                                node.localToWorld(worldPoint);
                                break;
                            }
                        }
                    }
                }
            });
            
            // Fallback to flat plane calculation if geometry sampling fails
            if (!worldPoint) {
                const local = new THREE.Vector3((targetUVx - 0.5) * context.screenMeta.rectXDistance, (0.5 - targetUVy) * context.screenMeta.rectYDistance, 0);
                worldPoint = local.clone();
                context.screenRect.localToWorld(worldPoint);
            }


            if (worldPoint) {
                // Use first marker as the legacy ball marker if present
                const legacyId = 'legacy';
                let legacyMesh = this.markers && this.markers.get(legacyId);
                if (!legacyMesh) {
                    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                    legacyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), sphereMaterial);
                    context.scene.add(legacyMesh);
                    if (this.markers) this.markers.set(legacyId, legacyMesh);
                }
                legacyMesh.position.copy(worldPoint);
                legacyMesh.visible = !!displayOverlayEnabled;

                const headsetPos = new THREE.Vector3();
                context.camera.getWorldPosition(headsetPos);

                const dir = worldPoint.clone().sub(headsetPos).normalize();

                // Create perpendicular vectors to form a cross-hair
                // Choose a reference vector that isn't parallel to dir
                const worldUp = new THREE.Vector3(0, 1, 0);
                const worldForward = new THREE.Vector3(0, 0, 1);
                
                // If dir is too close to parallel with worldUp, use worldForward instead
                const upDot = Math.abs(dir.dot(worldUp));
                const referenceVec = upDot > 0.9 ? worldForward : worldUp;
                
                const right = new THREE.Vector3().crossVectors(referenceVec, dir).normalize();
                const up = new THREE.Vector3().crossVectors(dir, right).normalize();

                // Length of cross-hair lines
                const lineLength = 0.15;

                // Horizontal line (perpendicular to direction)
                if (this.horizontalLine && this.horizontalLine.geometry) {
                    const hStart = worldPoint.clone().add(right.clone().multiplyScalar(-lineLength));
                    const hEnd = worldPoint.clone().add(right.clone().multiplyScalar(lineLength));
                    this.horizontalLine.geometry.setFromPoints([hStart, hEnd]);
                    this.horizontalLine.visible = !!displayOverlayEnabled;
                }

                // Vertical line (perpendicular to direction)
                if (this.verticalLine && this.verticalLine.geometry) {
                    const vStart = worldPoint.clone().add(up.clone().multiplyScalar(-lineLength));
                    const vEnd = worldPoint.clone().add(up.clone().multiplyScalar(lineLength));
                    this.verticalLine.geometry.setFromPoints([vStart, vEnd]);
                    this.verticalLine.visible = !!displayOverlayEnabled;
                }

                // Check for controller crossing the point-to-headset vector.
                // If multi-ball state is available, we target the closest ball instead of always the legacy point (ball[0]).
                const candidates = getBallWorldPoints();

                // Precompute screen-aligned basis (shared by controllers + hand joints)
                let screenXDir = null;
                if (context.screenMeta && context.screenMeta.topLeftCorner && context.screenMeta.bottomRightCorner) {
                    const tl = context.screenMeta.topLeftCorner;
                    const br = context.screenMeta.bottomRightCorner;
                    const dx = br[0] - tl[0];
                    const dz = br[2] - tl[2];
                    const v = new THREE.Vector3(dx, 0, dz);
                    if (v.lengthSq() > 1e-8) screenXDir = v.normalize();
                }
                if (!screenXDir) {
                    const q = new THREE.Quaternion();
                    context.screenRect.getWorldQuaternion(q);
                    screenXDir = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
                }
                const screenYDirUp = new THREE.Vector3(0, 1, 0);

                const resolveTouch = (probePos, ballWorldPoint) => {
                    const segment = ballWorldPoint.clone().sub(headsetPos);
                    const segmentLen = segment.length();
                    if (segmentLen <= 1e-6) return null;
                    const dSeg = segment.clone().divideScalar(segmentLen);
                    const t = THREE.MathUtils.clamp(probePos.clone().sub(headsetPos).dot(dSeg), 0, segmentLen);
                    const closest = headsetPos.clone().add(dSeg.multiplyScalar(t));
                    const distToSegment = probePos.distanceTo(closest);
                    return { distToSegment };
                };

                // Hand joints -> impulses (use all joints, same mechanism as controller swipe)
                if (context.handState && delta > 0) {
                    const firedBallIdsThisFrame = new Set();
                    for (const side of ['right', 'left']) {
                        const h = context.handState[side];
                        if (!h || !h.tracked || !h.joints) continue;

                        for (const [jointName, joint] of Object.entries(h.joints)) {
                            if (!joint || !Array.isArray(joint.position)) continue;
                            const jointPos = new THREE.Vector3(joint.position[0], joint.position[1], joint.position[2]);

                            const jointKey = `${side}:${jointName}`;
                            const prev = this.prevHandJointPositions.get(jointKey);
                            let jointVel = null;
                            if (prev) {
                                jointVel = jointPos.clone().sub(prev).divideScalar(delta);
                            }

                            let targetBallId = null;
                            let bestDist = Infinity;
                            if (Array.isArray(candidates) && candidates.length) {
                                for (const c of candidates) {
                                    const r = resolveTouch(jointPos, c.worldPoint);
                                    if (!r) continue;
                                    if (r.distToSegment < bestDist) {
                                        bestDist = r.distToSegment;
                                        targetBallId = c.id;
                                    }
                                }
                            } else {
                                const r = resolveTouch(jointPos, worldPoint);
                                if (r) bestDist = r.distToSegment;
                            }

                            const radius = (typeof joint.radius === 'number' && Number.isFinite(joint.radius)) ? joint.radius : 0;
                            const touchR = Math.max(touchRadiusMeters, radius * 2.0);
                            const touching = bestDist < touchR;

                            const wasTouching = !!this.wasTouchingHandJoint.get(jointKey);
                            if (touching && !wasTouching && jointVel) {
                                const speed = jointVel.length();
                                if (speed >= minSwipeSpeedMetersPerSec) {
                                    const ballKey = String(targetBallId ?? 'legacy');
                                    const lastT = this.lastHandImpulseTimeByBallId.get(ballKey);
                                    const cooldownOk = (typeof lastT !== 'number') || ((time - lastT) >= handSwipeBallCooldownSec);
                                    if (cooldownOk && !firedBallIdsThisFrame.has(ballKey)) {
                                        this.lastHandImpulseTimeByBallId.set(ballKey, time);
                                        firedBallIdsThisFrame.add(ballKey);
                                    const forceX = jointVel.dot(screenXDir);
                                    const forceY = -jointVel.dot(screenYDirUp);
                                    context.sendGameMessage({
                                        event: 'APPLY_FORCE',
                                        ballId: targetBallId,
                                        forceX,
                                        forceY
                                    });
                                    }
                                }
                            }

                            this.wasTouchingHandJoint.set(jointKey, touching);
                            this.prevHandJointPositions.set(jointKey, jointPos);
                        }
                    }
                }
                ['right', 'left'].forEach((side) => {
                    const controller = context.controllers && context.controllers[side];
                    if (controller && controller.gripSpace) {
                        const gripPos = new THREE.Vector3();
                        controller.gripSpace.getWorldPosition(gripPos);

                        // Compute grip velocity in world space (m/s)
                        let gripVel = null;
                        if (this.prevGripPositions[side] && delta > 0) {
                            gripVel = gripPos.clone().sub(this.prevGripPositions[side]).divideScalar(delta);
                        }

                        let targetBallId = null;
                        let targetBallWorldPoint = worldPoint;
                        let bestDist = Infinity;

                        if (Array.isArray(candidates) && candidates.length) {
                            for (const c of candidates) {
                                const r = resolveTouch(gripPos, c.worldPoint);
                                if (!r) continue;
                                if (r.distToSegment < bestDist) {
                                    bestDist = r.distToSegment;
                                    targetBallId = c.id;
                                    targetBallWorldPoint = c.worldPoint;
                                }
                            }
                        } else {
                            const r = resolveTouch(gripPos, worldPoint);
                            if (r) bestDist = r.distToSegment;
                        }

                        const touching = bestDist < touchRadiusMeters;

                            // Fire a single impulse on touch enter
                            if (touching && !this.wasTouchingRay[side] && gripVel) {
                                const speed = gripVel.length();
                                if (speed >= minSwipeSpeedMetersPerSec) {
                                    // Canvas Y increases downward, so map world +Y(up) to negative canvas Y.
                                    const forceX = gripVel.dot(screenXDir);
                                    const forceY = -gripVel.dot(screenYDirUp);

                                    context.sendGameMessage({
                                        event: 'APPLY_FORCE',
                                        ballId: targetBallId,
                                        forceX,
                                        forceY
                                    });
                                }
                            }

                            this.wasTouchingRay[side] = touching;
                            this.wasTouchingBallId[side] = touching ? targetBallId : null;

                        this.prevGripPositions[side] = gripPos.clone();
                    }
                });
                
                // Fade out crossing line and cone over time
                if (this.crossingFadeTime > 0) {
                    this.crossingFadeTime -= delta;
                    if (this.crossingFadeTime <= 0) {
                        this.crossingLine.visible = false;
                        this.crossingCone.visible = false;
                    }
                }
            }
        }
    },

    // Screen handling
    // context: { canvas, sendGameMessage, settings }
    async startScreen(context) {
        // Store settings
        this.settings = context.settings || {};

        const { canvas } = context;
        void canvas;

        // Load ball image
        this.ballImage = new Image();
        this.ballImage.src = '/assets/ImmerseGTCircle.png';

        // Load overlay images
        this.qrImage = new Image();
        this.qrImage.src = '/assets/ImmerseGTQR.png';
        this.infoImage = new Image();
        this.infoImage.src = '/assets/ImmerseGTInfo.png';

        // Initialize balls with physics
        this.balls = [
            { id: 0, x: canvas.width * 0.15, y: canvas.height * 0.20, vx: 0,   vy: 0,   radius: 70, color: 0xff0000 },
            { id: 1, x: canvas.width * 0.35, y: canvas.height * 0.15, vx: 50,  vy: 0,   radius: 70, color: 0x00aaff },
            { id: 2, x: canvas.width * 0.55, y: canvas.height * 0.25, vx: -30, vy: 0,   radius: 70, color: 0xff8800 },
            { id: 3, x: canvas.width * 0.75, y: canvas.height * 0.15, vx: 0,   vy: -20, radius: 70, color: 0x66ff66 },
            { id: 4, x: canvas.width * 0.20, y: canvas.height * 0.50, vx: 40,  vy: 0,   radius: 70, color: 0xff44cc },
            { id: 5, x: canvas.width * 0.45, y: canvas.height * 0.45, vx: -20, vy: 30,  radius: 70, color: 0xffff00 },
            { id: 6, x: canvas.width * 0.65, y: canvas.height * 0.55, vx: 30,  vy: -10, radius: 70, color: 0x44ffee },
            { id: 7, x: canvas.width * 0.85, y: canvas.height * 0.40, vx: -40, vy: 20,  radius: 70, color: 0xaa44ff },
        ];
    },

    updateScreen(delta, time, context) {
        void time;
        if (!this.balls || !this.balls.length) return;

        // Update settings from context if provided
        if (context && context.settings) {
            this.settings = context.settings;
        }

        const gravityMultiplier = this.settings.gravityMultiplier !== undefined
            ? this.settings.gravityMultiplier
            : 1.0;
        const swipeForceMultiplier = this.settings.swipeForceMultiplier !== undefined
            ? this.settings.swipeForceMultiplier
            : 1.0;

        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');
        const baseGravity = 980;
        const gravity = baseGravity * gravityMultiplier;
        const damping = 0.8;
        const friction = 0.98;

        // Clear and draw with black background
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (const ball of this.balls) {
            // Apply gravity
            ball.vy += gravity * delta;

            // Update position
            ball.x += ball.vx * delta;
            ball.y += ball.vy * delta;

            // Apply friction
            ball.vx *= friction;
            ball.vy *= friction;

            // Bounce off walls
            if (ball.x - ball.radius < 0) {
                ball.x = ball.radius;
                ball.vx = Math.abs(ball.vx) * damping;
            }
            if (ball.x + ball.radius > canvas.width) {
                ball.x = canvas.width - ball.radius;
                ball.vx = -Math.abs(ball.vx) * damping;
            }
            if (ball.y - ball.radius < 0) {
                ball.y = ball.radius;
                ball.vy = Math.abs(ball.vy) * damping;
            }
            if (ball.y + ball.radius > canvas.height) {
                ball.y = canvas.height - ball.radius;
                ball.vy = -Math.abs(ball.vy) * damping;
            }
        }

        // Draw overlay images (beneath balls)
        const padding = 20;
        const qrSize = Math.round(canvas.height * 0.22);
        if (this.qrImage && this.qrImage.complete && this.qrImage.naturalWidth > 0) {
            ctx.drawImage(this.qrImage, canvas.width - qrSize - padding, canvas.height - qrSize - padding, qrSize, qrSize);
        }
        const infoH = Math.round(canvas.height * 0.12);
        const infoW = Math.round(infoH * (this.infoImage && this.infoImage.naturalWidth && this.infoImage.naturalHeight
            ? this.infoImage.naturalWidth / this.infoImage.naturalHeight : 4));
        if (this.infoImage && this.infoImage.complete && this.infoImage.naturalWidth > 0) {
            ctx.drawImage(this.infoImage, padding, canvas.height - infoH - padding, infoW, infoH);
        }

        // Draw balls on top of overlay images
        for (const ball of this.balls) {
            if (this.ballImage && this.ballImage.complete && this.ballImage.naturalWidth > 0) {
                ctx.drawImage(this.ballImage, ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
            } else {
                ctx.fillStyle = `#${(ball.color >>> 0).toString(16).padStart(6, '0')}`;
                ctx.beginPath();
                ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Send balls state to VR
        context.sendGameMessage({
            event: 'BALLS_STATE',
            screenWidth: canvas.width,
            screenHeight: canvas.height,
            balls: this.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, radius: b.radius, color: b.color }))
        });

        // Backwards compatibility: first ball only
        const b0 = this.balls[0];
        if (b0) {
            context.sendGameMessage({
                event: 'BALL_POSITION',
                canvasX: b0.x,
                canvasY: b0.y,
                screenWidth: canvas.width,
                screenHeight: canvas.height
            });
        }
    },

    disposeVR(context) {
        if (context && context.scene) {
            const remove = (obj) => {
                if (obj && obj.parent) {
                    try { obj.parent.remove(obj); } catch (e) { /* ignore */ }
                } else if (obj) {
                    try { context.scene.remove(obj); } catch (e) { /* ignore */ }
                }
            };

            remove(this.horizontalLine);
            remove(this.verticalLine);
            remove(this.crossingLine);
            remove(this.crossingCone);

            if (this.markers && typeof this.markers.entries === 'function') {
                for (const [, mesh] of this.markers.entries()) {
                    remove(mesh);
                }
            }
        }

        this.horizontalLine = null;
        this.verticalLine = null;
        this.crossingLine = null;
        this.crossingCone = null;
        this.markers = new Map();

        this.latestPoint = {};
        this.latestBallsState = null;
        this.prevControllerPositions = { right: null, left: null };
        this.prevGripPositions = { right: null, left: null };
        this.wasTouchingRay = { right: false, left: false };
        this.wasTouchingBallId = { right: null, left: null };

        this.prevHandJointPositions = new Map();
        this.wasTouchingHandJoint = new Map();
        this.lastHandImpulseTimeByBallId = new Map();
    },

    disposeScreen(_context) {
        this.balls = [];
        this.ballImage = null;
        this.qrImage = null;
        this.infoImage = null;
    },

    /*
        Incoming messages handler.

        All controller data is available directly in updateVR via context.controllers, 
        context.screenState, and context.screenMeta. Use sendGameMessage to communicate 
        between VR and screen clients when custom events are needed.

        Handle messages sent via `sendGameMessage` here as you like.
    */
    onMessage(msg) {
        if (!msg) return;

        if (msg.event === 'BALL_POSITION') {
            this.latestPoint = msg;
        }

        if (msg.event === 'BALLS_STATE') {
            this.latestBallsState = msg;
            // Keep legacy point in sync with ball[0]
            if (msg.balls && msg.balls[0]) {
                const b0 = msg.balls[0];
                this.latestPoint = { event: 'BALL_POSITION', canvasX: b0.x, canvasY: b0.y, screenWidth: msg.screenWidth, screenHeight: msg.screenHeight };
            }
        }

        if (msg.event === 'APPLY_FORCE' && this.balls && this.balls.length) {
            const targetId = msg.ballId;
            const target = (targetId === null || targetId === undefined)
                ? this.balls[0]
                : (this.balls.find((b) => b && b.id === targetId) || this.balls[0]);

            const swipeForceMultiplier = this.settings.swipeForceMultiplier !== undefined
                ? this.settings.swipeForceMultiplier
                : 1.0;

            target.vx += msg.forceX * this.impulseMultiplierX * swipeForceMultiplier;
            target.vy += msg.forceY * this.impulseMultiplierY * swipeForceMultiplier;
            console.log('Applied force:', msg.forceX, msg.forceY, 'ballId=', targetId);
        }

        console.log('game onMessage received', msg);
    }
};
