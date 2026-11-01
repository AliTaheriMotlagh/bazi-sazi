# Gap analysis vs Unity / Unreal / Godot

Honest list of what Bazi-Sazi does **not** have yet (as of this commit), grouped by how much it matters for a browser-first studio.

## Done recently
Tile painter, sculptable terrain, animation clips + state machine, custom shader presets/GLSL, slope-aware navigation on terrain, project version history, prefab library + remix, offline editing, HTML/ZIP export, quick-match.

## Added in round 5 (engine `systems/`, all unit-tested)
- **Navigation mesh** (`navmesh.ts`): convex polygons, funnel-smoothed any-angle paths, cost areas, off-mesh links, floors (layers); `GridPathfinder.toNavMesh()` builds one from the existing grid. Not yet used by the runtime's `moveTo` — gameplay still calls the grid pathfinder.
- **Shader graph** (`shaderGraph.ts`): typed node graph → GLSL, selectable as the Shader component's `graph` effect (JSON field). There is no visual graph editor yet, and the renderer is still WebGL (no WebGPU).
- **Live collaboration** (`collab.ts`, server `/ws/collab`, studio `collab/`): server-sequenced, id-addressed ops with optimistic clients; owner + invited collaborators (`project_collaborators`); menu actions *Live collaboration* / *Invite a collaborator*. Not yet: cursors/selection UI, reconnect, conflict UI. Remote structural edits clear your undo stack.
- **Server-authoritative multiplayer** (`authoritative.ts`, server `/ws/sim`): fixed-tick server, input validation/rate cap, client prediction + reconciliation, snapshot interpolation. The server runs the built-in arena movement model; per-game server scripts and a client hookup in the runtime are not done.
- **Native wrappers**: Electron, Tauri and Capacitor project files in the export ZIP (`export/native.ts`). The wrappers were generated and unit-tested, but not built with their toolchains.

## Still missing — big
- Wiring the authoritative sim and navmesh into `Runtime` / game scripts (the building blocks and server rooms exist).
- A visual shader-graph editor and a WebGPU renderer.
- Browser-level (Playwright) tests for the editor UIs; the logic under them is covered by unit and integration tests.

## Still missing — editor features other engines have
- Skeletal retargeting, IK, blend trees (1D/2D), animation events on the timeline, root motion.
- Lightmap baking, light probes, reflection probes, decals, LOD groups, occlusion culling, instancing UI.
- Terrain: texture splatting/painting, foliage/tree scattering, holes, heightmap import/export.
- Physics: joints/constraints, character controller with slopes/steps, ragdolls, vehicles, cloth.
- UI: a visual UI/canvas editor (layout, anchors, themes); only HUD text/HUD components exist.
- Audio: mixer/buses, 3D falloff curves, reverb zones.
- Particle editor with curves/sub-emitters; VFX graph.
- Profiler with GPU timings, frame debugger, memory snapshots.
- Localization (RTL/Persian UI), input rebinding UI, save-game API helpers, build variants.
- Package/plugin system; asset pipeline (texture compression, model optimization), CLI for CI builds.

## Accessibility status
Node editor: inputs, nodes and pins have accessible names; a keyboard/screen-reader **Connections** panel can list, create and delete wires without dragging; edge animation respects `prefers-reduced-motion`; a global `:focus-visible` ring was added. Not yet audited with a real screen reader or contrast tooling; the 3D viewport itself is not keyboard operable beyond the fly camera.
