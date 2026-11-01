# 🎮 Bazi-Sazi — Web Game Engine Studio

Build, play, publish and share **2D, 3D, VR and multiplayer** games entirely in the browser — on desktop, tablet and phone.
Beginners use drag-and-drop, ready-made behaviours, visual scripting and an AI assistant. Developers get JavaScript/TypeScript with full autocomplete, a debugger-friendly runtime, a profiler and an open JSON project format.

```
┌──────────────────────────── apps/studio (React + Vite) ────────────────────────────┐
│  Home / Explore / Play pages   Editor: Hierarchy · Scene view · Inspector · Assets │
│                                Code (Monaco) · Visual logic (node graph) · AI chat │
│                                Console · Problems (audit) · Profiler · Settings    │
│  player.html  ← tiny standalone player used by every published game                │
└───────────────┬──────────────────────────────────────────────────┬────────────────┘
                │ imports                                          │ HTTP / WebSocket
┌───────────────▼─────────── packages/engine ───────────┐  ┌───────▼──────── apps/server (Fastify) ─────────┐
│ Data model (JSON)  · Component registry (schemas)     │  │ Auth (scrypt + JWT) · Projects · Assets (sha256) │
│ Runtime: three.js renderer · Rapier physics (WASM)    │  │ Publishing + <slug>.domain hosting · Likes/plays │
│ Input (keys/mouse/gamepad/touch/XR) · Audio + SFX     │  │ Multiplayer rooms (WebSocket relay, host model)  │
│ Scripts (JS/TS) · Behaviours · Visual-graph VM        │  │ OpenRouter AI proxy · Rate limits · SQLite       │
│ Multiplayer client · HUD · Particles · Validation     │  └──────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────┘
```

## Quick start

Requirements: **Node.js 22.13+** (24 recommended — the server runs TypeScript natively).

```bash
npm install
cp .env.example .env      # optional in development
npm run dev               # studio on http://localhost:5173, API on :8787
```

Open http://localhost:5173, pick a template, and press **▶ Play**. No sign-up needed: a guest account is created automatically (save it later with a username).

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (HMR) + API server with auto-restart |
| `npm run build` | Production build of the studio and the game player |
| `npm start` | Production server — serves studio, API, multiplayer and every published game on port 8787 |
| `npm test` | Engine + server tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check of all packages |

Published games are reachable at **`http://<slug>.localhost:8787/`** (Chrome, Firefox and Edge resolve `*.localhost` automatically; in dev use port 5173) and at `/play/<slug>` inside the site.

## Features

### Make any kind of game
- **2D and 3D** in one engine (2D = orthographic camera + physics locked to the XY plane).
- **Physics**: Rapier (WASM) rigid bodies, colliders, triggers, continuous collision, raycasts, ground checks.
- **Graphics**: PBR materials, shadows, fog, tone mapping, bloom glow, sprites & sprite-sheet animation, glTF/GLB models with skeletal animation, world text, GPU particles, pixel-art mode.
- **No-code behaviours**: Platformer / Top-down / First-person controllers, Follow camera, Rotator, Oscillator (moving platforms), Collectible, Health, Damage, Spawner, Shooter, Destroy-after, Goal/Portal, HUD text, Tile map (draw levels with characters), Network sync.
- **Visual scripting**: 69 nodes — events (start, frame, input, collision, trigger, click, timer, message, network), flow (branch, sequence, wait, repeat, chance), actions, variables, math, logic, input, scene and network nodes.
- **Code**: JavaScript or TypeScript per script, lifecycle hooks (`start`, `update`, `onCollision`, `onTrigger`, `onMessage`, `onClick`, …), Monaco editor with autocomplete and inline docs for the whole engine API.
- **Prefabs**, multiple **scenes/levels**, game **variables** shown live in HUDs with `{name}` templates.
- **Audio**: uploaded sounds and a built-in synthesizer (coin, jump, laser, explosion, win…), so games have sound without assets.
- **Input everywhere**: keyboard, mouse, gamepads, automatic on-screen joystick/buttons on touch devices, VR controllers — all mapped to named actions you can rebind.
- **VR / WebXR**: one switch adds “Enter VR” for headsets.
- **Multiplayer**: enable it, choose a player prefab, and every player gets an avatar; positions are synced and interpolated; the oldest player is the host that simulates shared objects; `net.send/on/setState` for custom game events. Private rooms with `?room=code`.

### Studio
- Responsive editor: three-pane desktop layout with resizable panels, drawers on tablets, tab navigation on phones.
- Scene view with move/rotate/scale gizmos, snapping, click-to-select, focus (`F`), drag-and-drop of files, prefabs and scripts.
- Hierarchy with drag-to-reparent, search, context menus; schema-driven Inspector (every component is editable without code, number fields support drag-scrubbing and math like `2*3`).
- **Undo/redo for everything** (including AI edits) via a command pattern over immer patches. Autosave.
- **Play mode** runs on a deep copy of the project (like Unity/Godot), with pause, single-frame step, slow motion, collider visualization, live entity state in the inspector, console with source links, and a **profiler** (FPS, frame/logic/physics/render time, draw calls, triangles, bodies, ping, memory).
- **Problems panel** audits the project continuously: broken references, missing colliders/cameras/lights, script syntax errors, graph issues, multiplayer setup and performance smells. Errors block publishing.
- **AI assistant** (OpenRouter, any tool-capable model): builds scenes, writes and fixes scripts, creates visual graphs, prefabs, scenes and settings through the same undoable commands as the UI. “Explain / Fix / Improve” buttons in the code editor.
- Import/export projects as JSON files, duplicate projects, light/dark theme.

### Publishing & community
- One-click publish with a custom address, title, description and auto-captured thumbnail; republish to update.
- Each game is hosted on **its own subdomain** (`<slug>.<BASE_DOMAIN>`) and as a sandboxed embed.
- Explore page with search, sorting (popular/new/liked), 2D/3D/multiplayer filters, play counts, likes and share links.

## Project format

A game is plain JSON (`ProjectData` in [packages/engine/src/types.ts](packages/engine/src/types.ts)):

```jsonc
{
  "format": "bazi-sazi", "version": 1, "name": "My Game",
  "settings": { "mode": "2d", "gravity": [0, -30, 0], "multiplayer": { "enabled": false }, "input": { "jump": ["Space"] } },
  "scenes": [{ "name": "Main", "entities": [
    { "name": "Player", "tags": ["player"], "transform": { "position": [0, 1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
      "components": [{ "type": "Sprite", "color": "#4361ee" }, { "type": "RigidBody" }, { "type": "Collider" }, { "type": "PlatformerController" }] }
  ]}],
  "prefabs": [], "scripts": [], "graphs": [], "assets": []
}
```

Because everything is data, the same object is edited by the UI, written by the AI, diffed for undo, validated, saved, published and played.

## Scripting in 30 seconds

```js
// Runs every frame on the entity this script is attached to
function update(dt) {
  if (input.pressed('jump') && self.isGrounded()) self.setVelocity(self.velocity.x, 12);
  if (input.isDown('fire')) game.spawn('Bullet', { position: [self.position.x, self.position.y, 0], velocity: [20, 0, 0] });
}

function onCollision(other) {
  if (other.hasTag('coin')) {
    game.vars.score = (game.vars.score || 0) + 1;   // shown by HUD text "Score: {score}"
    audio.sfx('coin');
    other.destroy();
  }
}
```

Injected names: `self`, `game`, `input`, `audio`, `net`, `params`, `THREE`, `log`, `warn`, `vec3`, `random`, `clamp`, `lerp`. The full typed API is in [packages/engine/src/docs/scriptApi.ts](packages/engine/src/docs/scriptApi.ts).

## Architecture notes

| Concern | Approach |
|---|---|
| Logic model | Scripts, built-in behaviours and visual graphs all implement one `Behaviour` hook interface (strategy pattern); errors are isolated per hook and reported once. |
| Components | Declarative schemas ([registry.ts](packages/engine/src/components/registry.ts)) generate the inspector, defaults, validation and AI documentation. Adding a component = schema + builder/behaviour. |
| Editor state | Zustand store; every mutation is a named command producing immer patches → undo/redo, autosave, AI changes all share one path ([commands.ts](apps/studio/src/store/commands.ts)). |
| Edit vs play | The edit viewport reconciles live objects with data (`Runtime.sync`, rebuilding only changed entities). Play mode instantiates a fresh runtime from a deep copy. |
| Physics | Fixed timestep with accumulator; script-driven moves are detected and teleported into bodies, so beginners can just set `self.position`. |
| Bundles | `@bazi/engine/core` (data, templates, validation) is separate from the runtime (three.js + WASM), keeping public pages light. Monaco, React Flow and the editor are lazy-loaded. |
| Multiplayer | Relay rooms with server-side shared state, host election, per-connection rate limits and message size caps. Transforms are batched per tick and interpolated client-side. |

## Security model

- Passwords hashed with scrypt; HS256 JWTs (timing-safe verify); brute-force rate limits on auth.
- **User code isolation**: published games run on their own subdomain origin or in a `sandbox` iframe without `allow-same-origin`, so game scripts can never read the studio session.
- Uploads are whitelisted by type, content-addressed (sha256) and served with `CSP: sandbox` + `nosniff`.
- Input validation with zod on every write endpoint; request size limits; WebSocket payload and rate limits.
- AI keys: either a server-side key (never exposed) or the user's own key kept only in their browser. AI requests require sign-in and are rate limited.
- Certificates for game subdomains are only issued for games that exist (`/api/tls-check`).

## Deploying to production

```bash
cp .env.example .env        # set JWT_SECRET, BASE_DOMAIN=games.example.com, PUBLIC_URL, DOMAIN
docker compose up -d --build                     # app on :8787
docker compose --profile https up -d --build     # + Caddy with automatic HTTPS for *.games.example.com
```

DNS: point both `games.example.com` and `*.games.example.com` at the server. Data (SQLite database + uploaded files) lives in the `bazi-data` volume — back it up.

### AI configuration

The assistant talks to any OpenAI-compatible endpoint, by default OpenRouter:

- `OPENROUTER_API_KEY` — optional server-wide key. Without it, each user pastes their own key in the AI panel's settings.
- `OPENROUTER_BASE_URL` — change it to route through a proxy/gateway **if openrouter.ai is not reachable from your server's region** (it returns HTTP 403 in some countries).

## Testing

`npm test` runs 28 tests: every template must build and pass the audit, script compilation (JS/TS) and error reporting, the visual-scripting VM (data flow, branching, loops, delays, tag filters), and server integration (auth, projects, publishing, slugs, likes/plays, uploads, subdomain routing, TLS checks and a real multi-client WebSocket multiplayer session).

## Roadmap — not built yet

Being honest about the gap to Unity/Unreal/Godot. These would be the next most valuable additions:

- Visual tile-map painter, terrain editor, and a 2D/3D level grid brush
- Animation timeline / state-machine editor; skeletal animation blending
- Navigation meshes and pathfinding for AI enemies
- Shader graph / custom materials; WebGPU renderer path
- Real-time collaborative editing (multiple people in one project) and project version history
- Server-authoritative multiplayer option (currently host-authoritative relay) and matchmaking
- Asset store / sharing prefabs between projects, remixing published games
- Offline/PWA editing and export to standalone HTML/ZIP or native wrappers
- Accessibility audit of the node editor and localization (RTL/Persian UI)
