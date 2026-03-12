import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export const metadata = {
    id: 'tutorial',
    name: 'Tutorial Shooter',
    description: 'Simple target shooting game from the tutorial',
    settings: [
        {
            key: 'sphereSpeed',
            label: 'Sphere Speed',
            type: 'number',
            default: 3.0,
            min: 1.0,
            max: 10.0,
            step: 0.5,
            tab: 'tutorial',
            applyTo: 'vr',
            description: 'Speed of projectile spheres (meters per second)'
        },
        {
            key: 'sphereColor',
            label: 'Sphere Color',
            type: 'color',
            default: '#ffee66',
            tab: 'tutorial',
            description: 'Color of projectile spheres'
        },
        {
            key: 'targetCount',
            label: 'Target Count',
            type: 'number',
            default: 5,
            min: 1,
            max: 20,
            step: 1,
            tab: 'tutorial',
            applyTo: 'screen',
            description: 'Number of targets on screen'
        }
    ]
};

const SPHERE_RADIUS = 0.02;
const SHOT_FADE_TIME = 0.6;
const TARGET_RADIUS_PERCENT = 0.06;

export default {
    // VR state
    _vr: null,
    
    // Screen state
    _screen: null,

    // VR lifecycle
    async startVR(context) {
        const { settings } = context;
        
        // Generate a unique player ID
        const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
        
        // Parse color from settings
        const colorInt = parseInt(settings.sphereColor.replace('#', ''), 16);
        
        this._vr = {
            activeSpheres: [],
            sphereMaterial: new THREE.MeshBasicMaterial({ color: colorInt }),
            playerId: playerId,
            sendMessage: context.sendGameMessage
        };
        
        console.log('Tutorial game VR started for player:', playerId);
    },

    updateVR(delta, time, context) {
        if (!this._vr) return;
        
        const { controllers, settings, scene } = context;
        const sides = ['right', 'left'];
        
        // Check both controllers for trigger press
        sides.forEach(side => {
            const controller = controllers[side];
            if (!controller || !controller.gamepad) return;
            
            // Check if trigger was just pressed (works with hand tracking pinch too)
            if (controller.gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
                this.spawnSphere(controller, context);
            }
        });
        
        // Update all active spheres
        this.updateSpheres(delta, context);
    },

    spawnSphere(controller, context) {
        if (!controller.raySpace) return;
        
        const { scene, settings } = context;
        
        // Create sphere at controller position
        const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 16, 12);
        const mesh = new THREE.Mesh(geometry, this._vr.sphereMaterial);
        
        const startPosition = controller.raySpace.position.clone();
        mesh.position.copy(startPosition);
        scene.add(mesh);
        
        // Get direction from controller's forward vector
        const direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(controller.raySpace.quaternion);
        direction.normalize();
        
        // Store sphere data
        this._vr.activeSpheres.push({
            mesh: mesh,
            direction: direction,
            speed: settings.sphereSpeed,
            startPosition: startPosition.clone(),
            hasHitScreen: false
        });
    },

    updateSpheres(delta, context) {
        if (!this._vr) return;
        
        const { screenRect, screenMeta, scene } = context;
        const toRemove = [];
        
        // Create raycaster for screen collision detection
        const raycaster = new THREE.Raycaster();
        
        this._vr.activeSpheres.forEach((sphere, index) => {
            // Move sphere in its direction
            const movement = sphere.direction.clone().multiplyScalar(sphere.speed * delta);
            sphere.mesh.position.add(movement);
            
            // Check if sphere traveled too far (10 meters)
            const distance = sphere.mesh.position.distanceTo(sphere.startPosition);
            if (distance > 10) {
                toRemove.push(index);
                return;
            }
            
            // Check for screen intersection (only once per sphere)
            if (!sphere.hasHitScreen && screenRect) {
                // Cast ray from sphere in its movement direction
                raycaster.set(sphere.mesh.position, sphere.direction);
                const intersects = raycaster.intersectObject(screenRect, false);
                
                if (intersects.length > 0 && intersects[0].distance < SPHERE_RADIUS * 2) {
                    sphere.hasHitScreen = true;
                    
                    // Calculate canvas coordinates from UV
                    const uv = intersects[0].uv;
                    if (uv && screenMeta) {
                        const canvasX = Math.round(uv.x * screenMeta.screenWidth);
                        const canvasY = Math.round((1 - uv.y) * screenMeta.screenHeight);
                        
                        // Send shot message to screen
                        this._vr.sendMessage({
                            event: 'SHOT',
                            canvasX: canvasX,
                            canvasY: canvasY,
                            player: this._vr.playerId
                        });
                        
                        // Remove sphere after hit
                        toRemove.push(index);
                        console.log('Hit screen at:', canvasX, canvasY);
                    }
                }
            }
        });
        
        // Remove spheres (from back to avoid index issues)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            const sphere = this._vr.activeSpheres[toRemove[i]];
            scene.remove(sphere.mesh);
            sphere.mesh.geometry.dispose();
            this._vr.activeSpheres.splice(toRemove[i], 1);
        }
    },

    // Screen lifecycle
    async startScreen(context) {
        const { canvas, settings, sendGameMessage } = context;
        
        this._screen = {
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            width: canvas.width,
            height: canvas.height,
            targetRadius: Math.min(canvas.width, canvas.height) * TARGET_RADIUS_PERCENT,
            targets: [],
            scores: {},
            shotVisuals: [],
            sendMessage: sendGameMessage,
            targetImage: new Image()
        };
        
        // Create targets based on settings
        for (let i = 0; i < settings.targetCount; i++) {
            this.createTarget();
        }
        
        // Make random target move every 1.5-3 seconds
        this._screen.teleportInterval = setInterval(() => {
            if (this._screen.targets.length > 0) {
                const randomIndex = Math.floor(Math.random() * this._screen.targets.length);
                this.repositionTarget(this._screen.targets[randomIndex]);
            }
        }, 1500 + Math.floor(Math.random() * 1500));
        
        // Load target image
        this._screen.targetImage.src = 'assets/target.png';
        
        console.log('Tutorial game screen started with', settings.targetCount, 'targets');
    },

    createTarget() {
        const x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
        const y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
        this._screen.targets.push({ x, y });
    },

    repositionTarget(target) {
        target.x = this._screen.targetRadius + Math.random() * (this._screen.width - 2 * this._screen.targetRadius);
        target.y = this._screen.targetRadius + Math.random() * (this._screen.height - 2 * this._screen.targetRadius);
    },

    drawTargets(ctx) {
        const radius = this._screen.targetRadius;
        
        this._screen.targets.forEach(target => {
            // Draw target image if loaded, otherwise draw circle
            if (this._screen.targetImage.complete && this._screen.targetImage.naturalWidth > 0) {
                ctx.drawImage(
                    this._screen.targetImage,
                    target.x - radius,
                    target.y - radius,
                    radius * 2,
                    radius * 2
                );
            } else {
                // Fallback: red circle with white center
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(target.x, target.y, radius * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    },

    updateScreen(delta, time, context) {
        if (!this._screen) return;
        
        // Update cached dimensions (canvas auto-resized by framework)
        const canvas = this._screen.canvas;
        this._screen.width = canvas.width;
        this._screen.height = canvas.height;
        this._screen.targetRadius = Math.min(canvas.width, canvas.height) * TARGET_RADIUS_PERCENT;
        
        const ctx = this._screen.ctx;
        const { width, height } = this._screen;
        
        // Clear canvas
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        
        // Draw white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        
        // Draw game elements
        this.drawTargets(ctx);
        this.drawShots(ctx, delta);
        this.drawLeaderboard(ctx);
    },

    drawShots(ctx, delta) {
        const toRemove = [];
        
        this._screen.shotVisuals.forEach((shot, index) => {
            // Decrease life
            shot.life -= delta;
            
            if (shot.life <= 0) {
                toRemove.push(index);
                return;
            }
            
            // Draw fading circle
            const alpha = shot.life / SHOT_FADE_TIME;
            const radius = 10 + (1 - alpha) * 10;  // Expands as it fades
            
            ctx.fillStyle = `rgba(255, 238, 102, ${alpha})`;
            ctx.beginPath();
            ctx.arc(shot.x, shot.y, radius, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Remove expired effects (from back to avoid index shifts)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            this._screen.shotVisuals.splice(toRemove[i], 1);
        }
    },

    drawLeaderboard(ctx) {
        ctx.save();
        
        // Convert scores to sorted array
        const entries = Object.entries(this._screen.scores)
            .map(([id, score]) => ({ id, score }))
            .sort((a, b) => b.score - a.score);  // Highest first
        
        if (entries.length === 0) {
            ctx.restore();
            return;
        }
        
        // Draw background
        const padding = 20;
        const lineHeight = 30;
        const width = 250;
        const height = padding * 2 + lineHeight * (entries.length + 1);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(this._screen.width - width - padding, padding, width, height);
        
        // Draw title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('LEADERBOARD', this._screen.width - width, padding + 25);
        
        // Draw scores
        ctx.font = '16px monospace';
        entries.forEach((entry, index) => {
            const y = padding + 25 + lineHeight * (index + 1);
            const shortId = entry.id.substring(0, 12);  // Truncate long IDs
            ctx.fillText(`${shortId}: ${entry.score}`, this._screen.width - width + padding, y);
        });
        
        ctx.restore();
    },

    // Message handler
    onMessage(msg) {
        // Only process on screen client
        if (!this._screen) return;
        
        if (msg.event === 'SHOT') {
            this.registerShot(msg.canvasX, msg.canvasY, msg.player);
        }
    },

    registerShot(x, y, playerId) {
        // Add visual effect
        this._screen.shotVisuals.push({
            x: x,
            y: y,
            life: SHOT_FADE_TIME
        });
        
        // Check for target hits
        const hitRadius = this._screen.targetRadius;
        
        for (let i = 0; i < this._screen.targets.length; i++) {
            const target = this._screen.targets[i];
            const dx = target.x - x;
            const dy = target.y - y;
            const distanceSquared = dx * dx + dy * dy;
            
            // Check if shot is within target radius
            if (distanceSquared <= hitRadius * hitRadius) {
                // Hit! Increment score
                if (!this._screen.scores[playerId]) {
                    this._screen.scores[playerId] = 0;
                }
                this._screen.scores[playerId]++;
                
                // Move target to new position
                this.repositionTarget(target);
                
                console.log('Hit! Player', playerId, 'scored. Total:', this._screen.scores[playerId]);
                break;  // Only hit one target per shot
            }
        }
    }
};
