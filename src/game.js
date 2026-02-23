import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

const SPHERE_RADIUS = 0.02; // Do these go to the export?
const SPHERE_COLOR = 0xffee66;

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        this._vr = {};
        this._vr.scene = context.scene;
        this._vr.sendMessage = context.sendGameMessage;
        this._vr.activeSpheres = [];
        this._vr.sphereMaterial = new THREE.MeshBasicMaterial({ color: SPHERE_COLOR });
        this._vr.playerID = 'Player-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,5); //Creates a playername based on where they join

        // Called once on VR client after scene + calibration are ready.
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv, hitPoint }` (per-frame intersection)
    //      - if onScreen is false, nothing else is sent; canvasX and canvasY are canvas coords, hitPoint is WebXR coords, uv is 2D coords on rect.
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        // Optional per-frame VR logic
        const hand = ['right', 'left'];

        controllers.forEach((hand) => {
            const controller = context.controllers[hand];
            const triggerPressed = controller.gamepad.getButtonDown(XR_BUTTONS.TRIGGER);

            if (triggerPressed) {
                const screenState = context.screenState[hand];
                if (screenState.onScreen) {
                    console.log('Trigger pressed while pointing at screen!');
                    // We'll spawn a sphere here next.

                    this.spawnSphere(controller, screenState, context);
                }
            }
        });

    },

    spawnSphere(controller, screenHit, context) {
        const startPosition = controller.gripSpace.position.clone();
        const targetPosition = screenHit.hitPoint.clone();
        const sphereGeometry = new THREE.SphereGeometry(SPHERE_RADIUS, 12, 10);
        const sphereMesh = new THREE.Mesh(sphereGeometry, this._vr.sphereMaterial.clone());

        sphereMesh.position.copy(startPosition);
        this._vr.scene.add(sphereMesh);

        const distance = startPosition.distanceTo(targetPosition);
        const speed = Math.max(2, distance * 0.8);

        this._vr.activeSpheres.push({ //Actually nvm, you don't need to explain this too much. It's standard JS. We can just 
            mesh: sphereMesh, 
            startPosition: startPosition, 
            targetPosition: targetPosition,
            progress: 0,
            speed: speed,
            canvasX: screenHit.canvasX, //I would change this to destinationX, destinationY
            canvasY: screenHit.canvasY,
            playerID: this._vr.playerID

        });

        this.updateSpheres(delta);
    },

    updateSpheres(delta) {
        const toRemove = [];

        this._vr.activeSpheres.forEach((sphere, index) => {

            //Calculate Sphere Intended Distance
            const totalDistance = sphere.startPosition.distanceTo(sphere.targetPosition);
            sphere.progress += delta * (sphere.speed / totalDistance);

            const t = Math.min(1, sphere.progress);
            sphere.mesh.position.lerpVectors(sphere.startPosition, sphere.targetPosition, t);
            // What is a lerp vector??

            if (t >= 1) { //If the sphere has reached its' desitnation
                console.log('Sphere hit the screen at', sphere.canvasX, sphere.canvasY);
                sphere.mesh.parent.remove(sphere.mesh);
                sphere.mesh.geomtry.dispose();
                sphere.mesh.material.dispose();

                toRemove.push(index);


            }

            for (let i = toRemove.length - 1; i >= 0; i--) {
                this._vr.activeSpheres.splice(toRemove[i], 1);
            }

        })
            


    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        // Called once on Screen after registration and canvas creation.
    },

    // Optional per-frame Screen update. delta,time in seconds.
    // context: { canvas, sendGameMessage }
    updateScreen(delta, time, context) {
        // Optional per-frame screen logic
    },

    // Incoming messages handler
    onMessage(msg) {
        if (!msg) return;

        // Handle game messages here

        console.log('game onMessage received', msg);
    }
};