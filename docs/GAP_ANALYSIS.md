# Gap analysis vs Unity / Unreal / Godot

Honest list of what Bazi-Sazi does **not** have yet (as of this commit), grouped by how much it matters for a browser-first studio.

## Done recently
Tile painter, sculptable terrain, animation clips + state machine, custom shader presets/GLSL, slope-aware navigation on terrain, project version history, prefab library + remix, offline editing, HTML/ZIP export, quick-match.

## Still missing — big
- **Real-time collaborative editing** (several people in one project). Needs a CRDT/OT layer over the immer-patch command model; versions/restore exist as the single-user substitute.
- **Server-authoritative multiplayer.** Current model is host-authoritative relay (or P2P on serverless). Needs a simulation server running the engine headlessly.
- **WebGPU renderer and a node-based shader graph.** Shaders are presets + hand-written GLSL on WebGL.
- **True navigation meshes.** Navigation is a grid (with terrain slope blocking); no multi-floor or off-mesh links.
- **Native/console targets.** Web only (plus HTML/ZIP export); no Electron/Capacitor wrappers.

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
