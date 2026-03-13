import * as THREE from 'three';

const BACKGROUND_TOP = '#f8fafc';
const BACKGROUND_BOTTOM = '#dbeafe';
const PALETTE = [0xff7a59, 0x5a67ff, 0x1fbf8f, 0xffc857, 0xa855f7, 0x0ea5e9];
const EPSILON = 0.0001;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function easeInOutCubic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function darkenColor(colorInt, factor) {
    const red = clamp(Math.round(((colorInt >> 16) & 255) * factor), 0, 255);
    const green = clamp(Math.round(((colorInt >> 8) & 255) * factor), 0, 255);
    const blue = clamp(Math.round((colorInt & 255) * factor), 0, 255);
    return (red << 16) | (green << 8) | blue;
}

function colorIntToCss(colorInt, alpha = 1) {
    const red = (colorInt >> 16) & 255;
    const green = (colorInt >> 8) & 255;
    const blue = colorInt & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function randomQuaternion() {
    const euler = new THREE.Euler(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        'XYZ'
    );
    return new THREE.Quaternion().setFromEuler(euler);
}

function pushUniquePoint(target, point) {
    const exists = target.some((candidate) => candidate.distanceToSquared(point) < 0.25);
    if (!exists) target.push(point);
}

function sortPolygonPoints(points) {
    const center = new THREE.Vector2();
    for (const point of points) center.add(point);
    center.multiplyScalar(1 / points.length);

    return [...points].sort((a, b) => {
        const angleA = Math.atan2(a.y - center.y, a.x - center.x);
        const angleB = Math.atan2(b.y - center.y, b.x - center.x);
        return angleA - angleB;
    });
}

function getBoxVertices(shape) {
    const halfWidth = shape.widthPx / 2;
    const halfHeight = shape.heightPx / 2;
    const halfDepth = shape.depthPx / 2;

    return [
        new THREE.Vector3(-halfWidth, -halfHeight, -halfDepth),
        new THREE.Vector3(halfWidth, -halfHeight, -halfDepth),
        new THREE.Vector3(halfWidth, halfHeight, -halfDepth),
        new THREE.Vector3(-halfWidth, halfHeight, -halfDepth),
        new THREE.Vector3(-halfWidth, -halfHeight, halfDepth),
        new THREE.Vector3(halfWidth, -halfHeight, halfDepth),
        new THREE.Vector3(halfWidth, halfHeight, halfDepth),
        new THREE.Vector3(-halfWidth, halfHeight, halfDepth)
    ];
}

function getPrismVertices(shape) {
    const halfWidth = shape.widthPx / 2;
    const halfHeight = shape.heightPx / 2;
    const halfDepth = shape.depthPx / 2;
    const topY = halfHeight * 0.72;
    const bottomY = -halfHeight * 0.92;

    return [
        new THREE.Vector3(-halfWidth, topY, -halfDepth),
        new THREE.Vector3(halfWidth, topY, -halfDepth),
        new THREE.Vector3(0, bottomY, -halfDepth),
        new THREE.Vector3(-halfWidth, topY, halfDepth),
        new THREE.Vector3(halfWidth, topY, halfDepth),
        new THREE.Vector3(0, bottomY, halfDepth)
    ];
}

const BOX_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
];

const PRISM_EDGES = [
    [0, 1], [1, 2], [2, 0],
    [3, 4], [4, 5], [5, 3],
    [0, 3], [1, 4], [2, 5]
];

function getCrossSectionPolygon(shape) {
    if (shape.type === 'sphere') {
        const radius = shape.widthPx / 2;
        if (Math.abs(shape.zPx) >= radius) return null;
        return {
            kind: 'circle',
            radius: Math.sqrt(Math.max(0, (radius * radius) - (shape.zPx * shape.zPx)))
        };
    }

    const vertices = shape.type === 'box' ? getBoxVertices(shape) : getPrismVertices(shape);
    const edges = shape.type === 'box' ? BOX_EDGES : PRISM_EDGES;
    const transformed = vertices.map((vertex) => vertex.clone().applyQuaternion(shape.rotationQuaternion));
    const intersectionPoints = [];

    for (const [startIndex, endIndex] of edges) {
        const start = transformed[startIndex];
        const end = transformed[endIndex];
        const startZ = start.z + shape.zPx;
        const endZ = end.z + shape.zPx;

        if (Math.abs(startZ) < EPSILON) {
            pushUniquePoint(intersectionPoints, new THREE.Vector2(start.x, start.y));
        }
        if (Math.abs(endZ) < EPSILON) {
            pushUniquePoint(intersectionPoints, new THREE.Vector2(end.x, end.y));
        }

        if ((startZ < 0 && endZ > 0) || (startZ > 0 && endZ < 0)) {
            const t = startZ / (startZ - endZ);
            const point = start.clone().lerp(end, t);
            pushUniquePoint(intersectionPoints, new THREE.Vector2(point.x, point.y));
        }
    }

    if (intersectionPoints.length < 3) return null;

    return {
        kind: 'polygon',
        points: sortPolygonPoints(intersectionPoints)
    };
}

function drawBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, BACKGROUND_TOP);
    gradient.addColorStop(1, BACKGROUND_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawOverlay(ctx, canvas, activeCount) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(18, 18, 250, 54, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = '600 18px Georgia';
    ctx.fillText('Shapes', 34, 42);
    ctx.fillStyle = '#475569';
    ctx.font = '14px Georgia';
    ctx.fillText(`${activeCount} shapes transitioning through the screen`, 34, 63);
    ctx.restore();
}

function createPrismGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0.36);
    shape.lineTo(0.5, 0.36);
    shape.lineTo(0, -0.46);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false
    });
    geometry.translate(0, 0, -0.5);
    return geometry;
}

function canvasLocalY(localY) {
    return -localY;
}

function buildGeometryForType(type) {
    if (type === 'sphere') return new THREE.SphereGeometry(0.5, 32, 24);
    if (type === 'box') return new THREE.BoxGeometry(1, 1, 1);
    return createPrismGeometry();
}

function createShapeRecord(id, settings, width, height) {
    const typeOptions = ['sphere', 'box', 'prism'];
    const type = typeOptions[Math.floor(Math.random() * typeOptions.length)];
    const baseSizePx = clamp(Number(settings.shapesBaseSizePx ?? 150), 40, 360);
    const sizeVariation = clamp(Number(settings.shapesSizeVariancePx ?? 48), 0, 180);
    const durationSec = clamp(Number(settings.shapesTravelDurationSec ?? 3.2), 1.2, 8);
    const travelDistancePx = clamp(Number(settings.shapesTravelDistancePx ?? 140), 40, 320);
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const sizePx = clamp(baseSizePx + ((Math.random() * 2 - 1) * sizeVariation), 36, 380);
    const aspectA = lerp(0.65, 1.35, Math.random());
    const aspectB = lerp(0.65, 1.35, Math.random());
    const widthPx = sizePx;
    const heightPx = sizePx * aspectA;
    const depthPx = sizePx * aspectB;
    const screenMargin = sizePx * 0.65;
    const x = lerp(screenMargin, Math.max(screenMargin, width - screenMargin), Math.random());
    const y = lerp(screenMargin, Math.max(screenMargin, height - screenMargin), Math.random());
    const rotationQuaternion = randomQuaternion();

    return {
        id,
        type,
        x,
        y,
        widthPx,
        heightPx,
        depthPx,
        color,
        ageSec: 0,
        durationSec,
        travelDistancePx,
        rotationQuaternion,
        rotationVelocity: {
            x: lerp(-0.45, 0.45, Math.random()),
            y: lerp(-0.75, 0.75, Math.random()),
            z: lerp(-0.35, 0.35, Math.random())
        },
        zPx: -travelDistancePx
    };
}

function serializeShape(shape) {
    return {
        id: shape.id,
        type: shape.type,
        x: shape.x,
        y: shape.y,
        widthPx: shape.widthPx,
        heightPx: shape.heightPx,
        depthPx: shape.depthPx,
        zPx: shape.zPx,
        color: shape.color,
        progress: shape.ageSec / shape.durationSec,
        rotation: shape.rotationQuaternion.toArray()
    };
}

export const metadata = {
    id: 'shapes',
    name: 'Shapes',
    description: '2D cross-sections swell on the screen and emerge into 3D shapes in WebXR',
    settings: [
        {
            key: 'shapesSpawnIntervalSec',
            label: 'Spawn Interval (s)',
            type: 'number',
            default: 1.1,
            min: 0.2,
            max: 4,
            step: 0.1,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'How often a new shape starts emerging'
        },
        {
            key: 'shapesMaxActive',
            label: 'Max Active Shapes',
            type: 'number',
            default: 4,
            min: 1,
            max: 12,
            step: 1,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'How many shapes can be mid-transition at once'
        },
        {
            key: 'shapesTravelDurationSec',
            label: 'Travel Duration (s)',
            type: 'number',
            default: 3.2,
            min: 1.2,
            max: 8,
            step: 0.1,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'How long each shape takes to travel through the screen'
        },
        {
            key: 'shapesBaseSizePx',
            label: 'Base Size (px)',
            type: 'number',
            default: 150,
            min: 40,
            max: 360,
            step: 2,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'Typical screen size of the emerging shapes'
        },
        {
            key: 'shapesSizeVariancePx',
            label: 'Size Variance (px)',
            type: 'number',
            default: 48,
            min: 0,
            max: 180,
            step: 2,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'How much random size variation to allow between shapes'
        },
        {
            key: 'shapesTravelDistancePx',
            label: 'Travel Distance (px)',
            type: 'number',
            default: 140,
            min: 40,
            max: 320,
            step: 2,
            tab: 'shapes',
            applyTo: 'screen',
            description: 'How far shapes start behind the screen and move out from it'
        }
    ]
};

export default {
    async startVR(context) {
        const root = new THREE.Group();
        context.scene.add(root);

        this._vr = {
            root,
            meshes: new Map(),
            shapeStates: [],
            boxGeometry: new THREE.BoxGeometry(1, 1, 1),
            sphereGeometry: new THREE.SphereGeometry(0.5, 32, 24),
            prismGeometry: createPrismGeometry()
        };
    },

    updateVR(_delta, _time, context) {
        if (!this._vr || !context || !context.screenRect || !context.screenMeta) return;

        const root = this._vr.root;
        context.screenRect.updateMatrixWorld?.(true);
        context.screenRect.getWorldPosition(root.position);
        context.screenRect.getWorldQuaternion(root.quaternion);

        const rectWidth = context.screenMeta.rectXDistance || 1;
        const rectHeight = context.screenMeta.rectYDistance || 1;
        const liveIds = new Set();

        for (const shape of this._vr.shapeStates) {
            liveIds.add(String(shape.id));

            const screenWidth = shape.screenWidth || context.screenMeta.screenWidth || 1;
            const screenHeight = shape.screenHeight || context.screenMeta.screenHeight || 1;
            const depthScale = (rectWidth / screenWidth + rectHeight / screenHeight) * 0.5;

            let mesh = this._vr.meshes.get(String(shape.id));
            if (!mesh) {
                const geometry = shape.type === 'sphere'
                    ? this._vr.sphereGeometry
                    : shape.type === 'box'
                        ? this._vr.boxGeometry
                        : this._vr.prismGeometry;
                const material = new THREE.MeshPhongMaterial({
                    color: shape.color,
                    transparent: true,
                    opacity: 0.96,
                    shininess: 80,
                    specular: 0xffffff
                });
                mesh = new THREE.Mesh(geometry, material);
                mesh.frustumCulled = false;
                root.add(mesh);
                this._vr.meshes.set(String(shape.id), mesh);
            }

            const halfWidth = rectWidth / 2;
            const halfHeight = rectHeight / 2;
            const worldX = ((shape.x / screenWidth) - 0.5) * rectWidth;
            const worldY = (0.5 - (shape.y / screenHeight)) * rectHeight;
            const worldZ = shape.zPx * depthScale;
            mesh.position.set(
                clamp(worldX, -halfWidth, halfWidth),
                clamp(worldY, -halfHeight, halfHeight),
                worldZ
            );

            if (Array.isArray(shape.rotation) && shape.rotation.length === 4) {
                mesh.quaternion.fromArray(shape.rotation);
            }

            const widthScale = (shape.widthPx / screenWidth) * rectWidth;
            const heightScale = (shape.heightPx / screenHeight) * rectHeight;
            const depthSize = shape.depthPx * depthScale;

            if (shape.type === 'sphere') {
                const radius = ((widthScale + heightScale) * 0.25);
                mesh.scale.setScalar(radius * 2);
            } else {
                mesh.scale.set(widthScale, heightScale, depthSize);
            }

            const progress = clamp(Number(shape.progress ?? 0), 0, 1);
            mesh.material.opacity = lerp(0.45, 0.96, progress);
        }

        for (const [id, mesh] of this._vr.meshes.entries()) {
            if (liveIds.has(id)) continue;
            root.remove(mesh);
            if (mesh.material && typeof mesh.material.dispose === 'function') {
                mesh.material.dispose();
            }
            this._vr.meshes.delete(id);
        }
    },

    disposeVR(context) {
        if (!this._vr) return;

        if (context && context.scene && this._vr.root) {
            context.scene.remove(this._vr.root);
        }

        for (const mesh of this._vr.meshes.values()) {
            if (mesh.material && typeof mesh.material.dispose === 'function') {
                mesh.material.dispose();
            }
        }

        this._vr.boxGeometry?.dispose();
        this._vr.sphereGeometry?.dispose();
        this._vr.prismGeometry?.dispose();
        this._vr = null;
    },

    async startScreen(context) {
        this._screen = {
            nextShapeId: 1,
            spawnTimerSec: 0,
            syncTimerSec: 0,
            shapes: []
        };

        if (context && context.sendGameMessage) {
            context.sendGameMessage({ event: 'SHAPES_STATE', shapes: [], screenWidth: context.canvas.width, screenHeight: context.canvas.height });
        }
    },

    updateScreen(delta, _time, context) {
        if (!this._screen || !context || !context.canvas) return;

        const settings = context.settings || {};
        const spawnIntervalSec = clamp(Number(settings.shapesSpawnIntervalSec ?? 1.1), 0.2, 4);
        const maxActive = clamp(Number(settings.shapesMaxActive ?? 4), 1, 12);
        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');

        this._screen.spawnTimerSec += Math.max(delta || 0, 0);
        while (this._screen.spawnTimerSec >= spawnIntervalSec) {
            this._screen.spawnTimerSec -= spawnIntervalSec;
            if (this._screen.shapes.length < maxActive) {
                this._screen.shapes.push(createShapeRecord(this._screen.nextShapeId, settings, canvas.width, canvas.height));
                this._screen.nextShapeId += 1;
            }
        }

        const survivors = [];
        for (const shape of this._screen.shapes) {
            shape.ageSec += Math.max(delta || 0, 0);
            const progress = clamp(shape.ageSec / shape.durationSec, 0, 1);
            const eased = easeInOutCubic(progress);
            shape.zPx = lerp(-shape.travelDistancePx, shape.travelDistancePx * 0.85, eased);

            const deltaRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
                shape.rotationVelocity.x * Math.max(delta || 0, 0),
                shape.rotationVelocity.y * Math.max(delta || 0, 0),
                shape.rotationVelocity.z * Math.max(delta || 0, 0),
                'XYZ'
            ));
            shape.rotationQuaternion.multiply(deltaRotation).normalize();

            if (progress < 1) survivors.push(shape);
        }
        this._screen.shapes = survivors;

        drawBackground(ctx, canvas);

        for (const shape of this._screen.shapes) {
            const crossSection = getCrossSectionPolygon(shape);
            if (!crossSection) continue;

            const progress = clamp(shape.ageSec / shape.durationSec, 0, 1);
            const fillAlpha = lerp(0.24, 0.78, Math.sin(progress * Math.PI));
            const strokeColor = darkenColor(shape.color, 0.62);

            ctx.save();
            ctx.translate(shape.x, shape.y);
            ctx.fillStyle = colorIntToCss(shape.color, fillAlpha);
            ctx.strokeStyle = colorIntToCss(strokeColor, Math.min(1, fillAlpha + 0.22));
            ctx.lineWidth = lerp(1.5, 4.5, Math.sin(progress * Math.PI));
            ctx.shadowBlur = 18;
            ctx.shadowColor = colorIntToCss(shape.color, 0.22);

            if (crossSection.kind === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, crossSection.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else if (crossSection.points.length >= 3) {
                ctx.beginPath();
                ctx.moveTo(crossSection.points[0].x, canvasLocalY(crossSection.points[0].y));
                for (let pointIndex = 1; pointIndex < crossSection.points.length; pointIndex += 1) {
                    const point = crossSection.points[pointIndex];
                    ctx.lineTo(point.x, canvasLocalY(point.y));
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            ctx.restore();
        }

        drawOverlay(ctx, canvas, this._screen.shapes.length);

        this._screen.syncTimerSec += Math.max(delta || 0, 0);
        if (this._screen.syncTimerSec >= 1 / 15) {
            this._screen.syncTimerSec = 0;
            context.sendGameMessage({
                event: 'SHAPES_STATE',
                screenWidth: canvas.width,
                screenHeight: canvas.height,
                shapes: this._screen.shapes.map(serializeShape)
            });
        }
    },

    async disposeScreen(context) {
        if (context && context.sendGameMessage) {
            context.sendGameMessage({ event: 'SHAPES_STATE', shapes: [], screenWidth: 1, screenHeight: 1 });
        }
        this._screen = null;
    },

    onMessage(message) {
        if (!message || message.event !== 'SHAPES_STATE') return;
        if (!this._vr) return;

        const screenWidth = Number(message.screenWidth) || 1;
        const screenHeight = Number(message.screenHeight) || 1;
        const shapes = Array.isArray(message.shapes) ? message.shapes : [];
        this._vr.shapeStates = shapes.map((shape) => ({
            id: shape.id,
            type: shape.type,
            x: Number(shape.x) || 0,
            y: Number(shape.y) || 0,
            widthPx: Number(shape.widthPx) || 60,
            heightPx: Number(shape.heightPx) || 60,
            depthPx: Number(shape.depthPx) || 60,
            zPx: Number(shape.zPx) || 0,
            color: Number(shape.color) || 0xffffff,
            progress: Number(shape.progress) || 0,
            rotation: Array.isArray(shape.rotation) ? shape.rotation : [0, 0, 0, 1],
            screenWidth,
            screenHeight
        })).map((shape) => ({
            ...shape,
            screenWidth,
            screenHeight
        }));

        if (this._vr) {
            for (const shape of this._vr.shapeStates) {
                shape.screenWidth = screenWidth;
                shape.screenHeight = screenHeight;
            }
        }
    }
};