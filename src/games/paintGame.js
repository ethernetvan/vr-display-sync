import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export const metadata = {
    id: 'paint',
    name: 'Paint',
    description: 'Simple controller-ray painting with two colors',
    settings: [
        // No custom settings currently - uses hardcoded values for simplicity
    ]
};

export default {
    async startVR(context) {
        this.settings = context.settings || {};
        
        this._vr = {
            root: null,
            hasScene: !!(context && context.scene)
        };

        if (context && context.scene) {
            const root = new THREE.Group();
            root.name = 'paintGameRoot';
            context.scene.add(root);
            this._vr.root = root;
        }
    },

    updateVR(_delta, _time, context) {
        if (!context || !context.screenState) return;

        // Emit PAINT events when controller rays intersect the screen.
        for (const side of ['left', 'right']) {
            const st = context.screenState[side];
            if (!st || !st.onScreen) continue;

            context.sendGameMessage({
                event: 'PAINT',
                x: st.canvasX,
                y: st.canvasY,
                r: side === 'left' ? 40 : 60,
                color: side === 'left' ? 0x00aaff : 0xff00aa,
                alpha: 0.12
            });
        }
    },

    async startScreen(context) {
        this.settings = context.settings || {};
        
        this._screen = {
            lastSize: { w: 0, h: 0 },
            strokes: [],
        };

        if (context && context.canvas) {
            this._screen.lastSize.w = context.canvas.width;
            this._screen.lastSize.h = context.canvas.height;
        }
    },

    updateScreen(_delta, _time, context) {
        if (!context || !context.canvas) return;
        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');

        // Clear to white each frame.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw strokes.
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
        if (msg.event === 'PAINT') {
            if (!this._screen) this._screen = { strokes: [], lastSize: { w: 0, h: 0 } };
            if (!Array.isArray(this._screen.strokes)) this._screen.strokes = [];

            const x = typeof msg.x === 'number' ? msg.x : null;
            const y = typeof msg.y === 'number' ? msg.y : null;
            if (x === null || y === null) return;

            this._screen.strokes.push({
                x,
                y,
                r: typeof msg.r === 'number' ? msg.r : 50,
                color: typeof msg.color === 'number' ? msg.color : 0x000000,
                alpha: typeof msg.alpha === 'number' ? msg.alpha : 0.1
            });

            // Cap memory.
            if (this._screen.strokes.length > 2000) {
                this._screen.strokes.splice(0, this._screen.strokes.length - 2000);
            }
        }
    }
};
