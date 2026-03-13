# VR Display Sync

## TL;DR
- This is a system to connect virtual reality headsets to an external screen via WebSockets and web routes.
- This strategy can be used to make interactive experiences combining XR experiences with viewable displays, helping bring isolated visualizations out into the real world.

## Resources
- [WebXR First Steps](https://developers.meta.com/horizon/documentation/web/webxr-first-steps/) - Meta's beginner WebXR guide
- [WebXR Hands API](https://developers.meta.com/horizon/documentation/web/webxr-hands/) - Hand tracking documentation
- [gamepad-wrapper](https://www.npmjs.com/package/gamepad-wrapper) - Controller input library used by this project 

## Game API (developing games in `src/games/`)
### Purpose
- Create games in the `src/games/` directory to develop experiences that take advantage of the combined VR + screen system.
- Each game consists of a module that exports **metadata** (settings schema) and a **game object** (lifecycle methods).
- Games are automatically registered via `src/games/index.js` and can be switched dynamically via the settings menu.
- Different API methods are called based on client type:
    - VR clients run `startVR` and `updateVR`
    - Screen clients run `startScreen` and `updateScreen`
    - Both can send broadcasts with `sendGameMessage` and receive messages with `onMessage`
- The "screen" refers to the single display client showing a JavaScript canvas.
- The "vr" client refers to any number of WebXR clients (Quest headsets).

### Creating a New Game

**1. Create your game file** in `src/games/yourGame.js`:

```javascript
import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

// Define metadata with settings schema
export const metadata = {
    id: 'yourgame',
    name: 'Your Game',
    description: 'Description of your game',
    settings: [
        {
            key: 'myNumberSetting',
            label: 'My Number Setting',
            type: 'number',
            default: 1.0,
            min: 0,
            max: 10,
            step: 0.1,
            tab: 'yourgame',
            applyTo: 'vr',  // 'vr', 'screen', or omit for both
            description: 'What this setting does'
        },
        {
            key: 'myBooleanSetting',
            label: 'Enable Feature',
            type: 'boolean',
            default: true,
            tab: 'yourgame',
            description: 'Enables a feature'
        },
        {
            key: 'myColorSetting',
            label: 'Color',
            type: 'color',
            default: '#ff0000',
            tab: 'yourgame',
            description: 'Choose a color'
        }
    ]
};

// NOTE: The 'default' values in metadata should match the values you set in config/defaults.json (step 3).
// The metadata defaults are used for UI hints and documentation, while config/defaults.json provides
// the actual initial values loaded by the server.

// Export game object with lifecycle methods
export default {
    // Store all VR-side runtime state here (meshes, materials, arrays, etc.)
    // Initialized in startVR, nulled out in disposeVR.
    _vr: null,

    // Store all screen-side runtime state here (canvas context, timers, scores, etc.)
    // Initialized in startScreen, nulled out in disposeScreen.
    _screen: null,

    // VR lifecycle methods
    async startVR(context) {
        this._vr = {};
        // Attach everything your VR code needs: this._vr.myMesh = ...
        // Access settings via context.settings.myNumberSetting
    },

    updateVR(delta, time, context) {
        if (!this._vr) return;
        // Update every frame in VR
        // Use context.settings for current values
    },

    disposeVR(context) {
        // Dispose any custom THREE.js resources here, then clear state
        this._vr = null;
    },

    // Screen lifecycle methods
    async startScreen(context) {
        this._screen = {};
        // Attach everything your screen code needs: this._screen.ctx = ...
    },

    updateScreen(delta, time, context) {
        if (!this._screen) return;
        // Update screen every frame
    },

    disposeScreen(context) {
        // Clear any timers or listeners here, then clear state
        this._screen = null;
    },

    // Network message handler
    onMessage(message) {
        // Handle GAME_EVENT messages
    }
};
```

**Why `_vr` and `_screen`?** Game modules are JavaScript singletons — the same object is reused every time a player switches to your game. If you store state directly on `this` (`this.myMesh = ...`), it persists across game switches and causes bugs. Bundling all state into `this._vr` and `this._screen` means you can reset everything cleanly by setting them to `null`. The `if (!this._vr) return;` guard in update methods also prevents crashes if the game is switched mid-frame. The engine additionally reads these objects to do automatic fallback cleanup of common resources when switching games.

**2. Register your game** in `src/games/index.js`:

```javascript
import yourGame, { metadata as yourMetadata } from './yourGame.js';

export const GAMES = new Map([
    ['balls', { game: ballsGame, metadata: ballsMetadata }],
    ['yourgame', { game: yourGame, metadata: yourMetadata }]  // Add this
]);
```

**3. Add default settings** in `config/defaults.json`:

```json
{
  "gameDefaults": {
    "yourgame": {
      "myNumberSetting": 1.0,
      "myBooleanSetting": true,
      "myColorSetting": "#ff0000"
    }
  }
}
```

**Important:** These values should match the `default` fields in your metadata (step 1). The server loads initial settings from this file on startup, while the metadata defaults serve as documentation and UI hints.

That's it! Your game will automatically:
- Appear in the settings menu with its own tab
- Have its settings UI auto-generated
- Receive settings via `context.settings`
- Be switchable without restarting the server

**Tip:** Use `src/games/gameTemplate.js` as a starting point - it includes all the boilerplate imports, metadata structure, and lifecycle methods ready to fill in.

### Game Loop Methods
- `startVR(context)`
	- Called once after screen calibration is complete.
	- `context`: `{ scene, camera, renderer, player, controllers, sendGameMessage, screenState, screenMeta, screenRect, handState, settings }`
        - scene: THREE.js scene for WebXR
        - camera: THREE.js PerspectiveCamera
        - renderer: THREE.js WebGlRenderer
        - player: group containing camera and controller spaces
        - controllers: dictionary of left and right controllers, each holding respective raySpace, gripSpace, and gamepad (GamepadWrapper)
            - raySpace: controller ray origin/direction pose (position, quaternion)
            - gripSpace: controller grip pose for physical position (position, quaternion)
            - gamepad: GamepadWrapper with methods getButton(XR_BUTTONS.TRIGGER), getButtonDown(), getButtonUp(), getAxis(XR_AXES.THUMBSTICK_X)
        - sendGameMessage: method to send message packets with type GAME_EVENT for additional shared game logic
        - settings: object containing current game settings (access via context.settings.mySettingKey)

- `updateVR(delta, time, context)`
	- Runs every frame
    - Delta and time in seconds (delta is time from last frame, time is total time passed)
	- `context` contains the same fields as `startVR` plus:
        - controllers: access controller input here (NOT through messages)
            - Buttons: `controllers.right.gamepad.getButton(XR_BUTTONS.TRIGGER)` returns 0-1 value
            - Button events: `getButtonDown()` for press, `getButtonUp()` for release (detects edges)
            - Axes: `controllers.right.gamepad.getAxis(XR_AXES.THUMBSTICK_X)` returns -1 to 1
            - Position: `controllers.right.gripSpace.position` (THREE.Vector3)
            - Rotation: `controllers.right.gripSpace.quaternion` (THREE.Quaternion)
        - screenState: holds raycast intersection status and position for left and right controllers and screen
            - `screenState.right` and `screenState.left` contain:
                - onScreen: boolean, true if controller ray intersects screen
                - canvasX, canvasY: pixel coordinates on screen canvas (only when onScreen is true)
                - hitPoint: THREE.Vector3 world position of intersection in WebXR space
                - uv: object with x, y properties (0-1 normalized coordinates on screen rect)
        - screenMeta: width, height, corner positions, screen rectangle scaling
            - screenWidth, screenHeight: canvas dimensions in pixels
            - topLeftCorner: [x, y, z] array of screen top-left corner in WebXR world coordinates
            - bottomRightCorner: [x, y, z] array of screen bottom-right corner in WebXR world coordinates
            - rectXDistance: physical horizontal width of screen rectangle in meters
            - rectYDistance: physical vertical height of screen rectangle in meters
        - screenRect: THREE.Mesh representing calibrated screen rectangle (useful for custom raycasting if needed)
        - handState: WebXR hand tracking data (available when user removes controllers on Quest)
            - Structure: `{ left: { tracked: boolean, joints: {} }, right: { tracked: boolean, joints: {} } }`
            - Each joint contains: `{ position: [x, y, z], radius: number }`
            - Joint names: 'wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip', etc.
            - Will be `null` if hand tracking is unavailable
            - Used for pinch gestures, finger painting, direct hand interaction with virtual objects
        - settings: object containing current game settings from metadata schema

- `disposeVR(context)` (optional)
    - Called when switching away from this game in VR
    - Use this if your game creates custom THREE.js resources, event listeners, intervals, etc.
    - For simple local/dev games, the engine does fallback cleanup of common `_vr` state even if this method is omitted

- `startScreen(context)`
	- Called once on the Screen client. `context` contains `{ canvas, sendGameMessage, settings }` and should be used to set up drawing and event handlers
	- **Note:** Canvas is automatically resized by the framework to match the window viewport - no manual resizing needed. Aspect ratio changes also update the VR screenRect automatically.

- `updateScreen(delta, time, context)`
	- Runs every frame for screen canvas updates
    - Useful for animation, events, gameplay changes, and anything else happening on the screen canvas
    - **Note:** Canvas is automatically resized before this is called - just use `canvas.width` and `canvas.height` directly
    - Note: Screen client does NOT have access to VR controller data in context - use GAME_EVENT messages via sendGameMessage to communicate from VR to screen
    - `context` contains `{ canvas, sendGameMessage, settings }`

- `disposeScreen(context)` (optional)
    - Called when switching away from this game on screen client
    - Use this if your game creates custom screen resources (timers, listeners, retained state)
    - For simple local/dev games, the engine does fallback cleanup of common `_screen` state even if this method is omitted

### Settings Metadata Schema

Settings are defined in your game's `metadata.settings` array. Each setting object supports:

- **key** (required): Setting identifier used in code (`context.settings.myKey`)
- **label** (required): Display name in settings UI
- **type** (required): Input type - `'boolean'`, `'number'`, `'color'`, `'select'`, or `'text'`
- **default** (required): Default value matching the type
- **tab** (recommended): Tab name in settings UI (typically your game's name)
- **description** (optional): Tooltip/help text displayed next to control
- **applyTo** (optional): `'vr'` or `'screen'` to limit where setting is used (omit for both)
- **min** (for numbers): Minimum allowed value
- **max** (for numbers): Maximum allowed value
- **step** (for numbers): Increment/decrement step size
- **options** (for select): Array of option values `['option1', 'option2']` or objects `[{label: 'Label', value: 'val'}]`

#### Supported Input Types

The settings UI automatically generates appropriate controls based on the `type` field:

**Boolean (Toggle/Checkbox):**
```javascript
{
    key: 'enableFeature',
    label: 'Enable Feature',
    type: 'boolean',
    default: true,
    tab: 'mygame',
    description: 'Turns the feature on or off'
}
```

**Number (Number Input):**
```javascript
{
    key: 'speed',
    label: 'Speed',
    type: 'number',
    default: 1.0,
    min: 0.1,
    max: 5.0,
    step: 0.1,
    tab: 'mygame',
    description: 'How fast things move'
}
```

**Color (Color Picker):**
```javascript
{
    key: 'primaryColor',
    label: 'Primary Color',
    type: 'color',
    default: '#ff0000',
    tab: 'mygame',
    description: 'Main color for objects'
}
```

**Select (Dropdown Menu):**
```javascript
{
    key: 'difficulty',
    label: 'Difficulty',
    type: 'select',
    default: 'medium',
    options: ['easy', 'medium', 'hard'],
    tab: 'mygame',
    description: 'Game difficulty level'
}
// Or with custom labels:
{
    key: 'mode',
    label: 'Mode',
    type: 'select',
    default: 'classic',
    options: [
        { label: 'Classic Mode', value: 'classic' },
        { label: 'Speed Run', value: 'speed' },
        { label: 'Zen Mode', value: 'zen' }
    ],
    tab: 'mygame'
}
```

**Text (Text Input):**
```javascript
{
    key: 'playerName',
    label: 'Player Name',
    type: 'text',
    default: 'Player 1',
    tab: 'mygame',
    description: 'Your display name'
}
```

#### How Settings Work

Settings are defined in `config/defaults.json` and loaded when the server starts. Changes made via the `/settings` page are persisted to runtime config and broadcast to all clients.

When the server starts:
- Loads settings from `config/defaults.json`
- Broadcasts config to all connected clients

When settings change via `/settings` page:
- Server updates live config and saves to runtime file
- Broadcasts `CONFIG_UPDATE` message to all clients
- Clients receive settings via `context.settings`
- Settings reset to defaults on next server restart

### Input Handling in VR

This system uses two complementary input methods for VR:

#### Controller Input (gamepad-wrapper)

Controllers are accessed via `context.controllers` using [gamepad-wrapper](https://www.npmjs.com/package/gamepad-wrapper), which provides:

- **Button detection**: `getButton(XR_BUTTONS.TRIGGER)` returns 0-1 pressure value
- **Edge detection**: `getButtonDown()` fires once on press, `getButtonUp()` on release
- **Axes**: `getAxis(XR_AXES.THUMBSTICK_X)` returns -1 to 1 for thumbsticks
- **Hand gesture support**: Pinch gestures automatically trigger as `XR_BUTTONS.TRIGGER` events

```javascript
// Example: Check trigger press
if (controllers.right.gamepad.getButtonDown(XR_BUTTONS.TRIGGER)) {
    console.log('Trigger pressed!');
}

// Example: Check thumbstick
const x = controllers.left.gamepad.getAxis(XR_AXES.THUMBSTICK_X);
const y = controllers.left.gamepad.getAxis(XR_AXES.THUMBSTICK_Y);
```

**Key feature**: When hand tracking is enabled (controllers put down) on Quest, **pinch gestures automatically map to trigger button presses**. Your game doesn't need special code to support both controllers and basic hand gestures.

#### Hand Tracking (WebXR Hands API)

For advanced hand interactions beyond pinch, use `context.handState` from the [WebXR Hands API](https://developers.meta.com/horizon/documentation/web/webxr-hands/):

- **25 joints per hand** with 3D positions and collision radii
- Available when controllers are put down on Quest
- Enables custom gestures, direct hand-object interaction, finger painting, etc.

```javascript
// Example: Check if hand tracking is active
if (handState && handState.right.tracked) {
    const indexTip = handState.right.joints['index-finger-tip'];
    const thumbTip = handState.right.joints['thumb-tip'];
    
    // Calculate pinch distance for custom gesture
    const distance = Math.sqrt(
        Math.pow(indexTip.position[0] - thumbTip.position[0], 2) +
        Math.pow(indexTip.position[1] - thumbTip.position[1], 2) +
        Math.pow(indexTip.position[2] - thumbTip.position[2], 2)
    );
    
    if (distance < 0.02) {
        console.log('Custom pinch detected!');
    }
}
```

**Structure**: `handState` is `null` when unavailable, or contains:
```javascript
{
    left: { tracked: boolean, joints: { 'joint-name': { position: [x,y,z], radius: number } } },
    right: { tracked: boolean, joints: { 'joint-name': { position: [x,y,z], radius: number } } }
}
```

**Common joint names**: `'wrist'`, `'thumb-tip'`, `'index-finger-tip'`, `'middle-finger-tip'`, `'ring-finger-tip'`, `'pinky-finger-tip'`, plus metacarpal and phalanx joints.

**Best practice**: Use controller input for primary interactions (trigger to shoot, grip to grab). Add hand tracking for secondary features like gestures or direct hand manipulation. The system handles the transition seamlessly.

### Messaging Helpers
- `sendGameMessage(payload)`
    - Sends any message payload to all connected clients with message.type being "GAME_EVENT" and payload being message.message (actual message content)
    - Used for CUSTOM game events to communicate between VR and screen clients
    - VR controller input is accessed via context.controllers in updateVR, not sent as messages
    - Example: `sendGameMessage({ event: 'SHOT', x: 100, y: 200, playerId: 'abc' })`

- `onMessage(msg)` — incoming message handler.
	- Recieves messages sent via sendGameMessage.
    - Use this for in-game events and client communication.

## File Reference

### Core System Files
- `server.js`
	- Host server that relays messages between clients and coordinates registration.
    - Loads settings from `config/defaults.json`
    - Runs on port 3000 (configurable via PORT env var)
    - Supports HTTPS via SSL_KEY and SSL_CERT env vars
    - Run `npm run dev` for development or `npm run dev:https` for HTTPS mode

- `src/vr.js`
	- Handles WebXR session setup, screen calibration, raycasting, and hand tracking.
    - Provides `handState` to games for Quest hand tracking support
    - Manages calibration widgets and screen mesh

- `src/screen.js`
	- Manages the browser screen-side client: canvas creation, calibration messages, and rendering.

- `src/clientManager.js`
	- Networking layer to register clients, send/receive messages, and route events.

- `src/init.js`
	- Common XR + Three.js initialization for the VR client.

- `src/desktop.js`
	- Fallback desktop UI when WebXR is not available.

### Game System Files
- `src/games/index.js`
	- Central game registry - add your games here
    - Exports GAMES Map with all registered games
    - Provides helper functions for getting settings by tab/game

- `src/gameAPI.js`
	- API wrapper that connects game lifecycle methods with VR/screen clients
    - Manages active game switching
    - Injects settings into context
    - Routes messages to current game

- `src/systemSettings.js`
	- System-wide settings metadata (not game-specific)
    - Active game selector (dynamically populated from registered games)
    - Screen geometry mode
    - Hand joints debug visualization

- `config/defaults.json`
	- Default values for all system and game settings
    - Loaded by server on startup

- `config/server-config.json`
    - Runtime settings used to change settings while running server
    - Populated initially by `config/defaults.json`

- `src/settings.js`
	- Settings UI that auto-generates controls from game metadata
    - Dynamically creates tabs for each game
    - Supports boolean, number, color, select, and text inputs

- `src/games/gameTemplate.js`
	- Starter template for creating new games
    - Copy this file to start a new game with all boilerplate included
    - Contains all imports, metadata structure, and lifecycle method stubs

## Development & Testing

### Local Development

```bash
npm install
npm run dev
```

Open locally:
- `http://localhost:3000/` - Home page
- `http://localhost:3000/settings` - Settings UI
- `http://localhost:3000/screen` - Screen client
- `http://localhost:3000/vr` - VR client (requires WebXR device)

### Testing on Meta Quest Over LAN

**For local development on your laptop, you DON'T need HTTPS.** Just run `npm run dev` and access `http://localhost:3000`.

**HTTPS is ONLY needed when testing on Quest over your local network.** WebXR requires a secure context (HTTPS) when accessing from non-localhost origins.

#### Setup HTTPS for Quest Testing

1. **Install mkcert** (creates locally-trusted certificates without browser warnings):

   **Windows:** `choco install mkcert` (requires [Chocolatey](https://chocolatey.org/install))  
   **Mac:** `brew install mkcert`  
   **Linux:** See [mkcert installation](https://github.com/FiloSottile/mkcert#installation)

2. **Find your computer's IP address:**
   - Windows: Run `ipconfig` and look for IPv4 Address (e.g., `192.168.1.100`)
   - Mac/Linux: Run `ifconfig` and look for inet address

3. **Generate a certificate for your IP in the config folder:**
   ```bash
   mkcert -install
   mkcert -cert-file config/YOUR_IP_HERE.pem -key-file config/YOUR_IP_HERE-key.pem YOUR_IP_HERE
   ```
   Example: `mkcert -cert-file config/192.168.1.100.pem -key-file config/192.168.1.100-key.pem 192.168.1.100`

4. **Start the server with HTTPS:**

   **Windows:**
   ```powershell
   $env:SSL_KEY="config/YOUR_IP_HERE-key.pem"; $env:SSL_CERT="config/YOUR_IP_HERE.pem"; npm run dev
   ```

   **Mac/Linux:**
   ```bash
   SSL_KEY=config/YOUR_IP_HERE-key.pem SSL_CERT=config/YOUR_IP_HERE.pem npm run dev
   ```

5. **Access on Quest:** `https://YOUR_IP_HERE:3000/vr`

#### Common Issues

- **Only one Screen client allowed**: Close other `/screen` tabs before opening a new one.
- **Can't connect from Quest**: Make sure your Quest and computer are on the same WiFi network.

## Credits
- Made by and for the [GTXR](https://www.gtxr.club/) club.
- Used resources and info from WebXR First Steps.