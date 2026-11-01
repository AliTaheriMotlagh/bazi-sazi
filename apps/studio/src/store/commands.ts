import {
  comp,
  createComponent,
  createEntity,
  createAnimator,
  decodeHeights,
  encodeHeights,
  flatHeights,
  originShift,
  paintCells,
  floodCells,
  type AnimatorData,
  createGraph,
  createPrefab,
  createScene,
  createScript,
  getComponentSchema,
  uid,
  type AssetData,
  type AssetType,
  type ComponentData,
  type EntityData,
  type EntityInit,
  type GraphData,
  type ProjectData,
  type ProjectSettings,
  type SceneData,
  type ScriptLanguage,
  type Vec3,
} from '@bazi/engine';
import { editor } from './editor';

/**
 * Editor commands. Each one is a named, undoable operation on project data.
 * The UI, keyboard shortcuts and the AI assistant all call these, so every
 * change is consistent, validated the same way and undoable.
 */

const sceneOf = (draft: ProjectData, sceneId = editor().sceneId): SceneData => {
  const scene = draft.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('Scene not found');
  return scene;
};

export const currentScene = (): SceneData | undefined => {
  const { project, sceneId } = editor();
  return project?.scenes.find((s) => s.id === sceneId);
};

export const findEntity = (ref: string): EntityData | undefined => {
  const scene = currentScene();
  return scene?.entities.find((e) => e.id === ref) ?? scene?.entities.find((e) => e.name === ref);
};

/** An entity and all its descendants (in scene order). */
function withDescendants(entities: EntityData[], ids: string[]): EntityData[] {
  const set = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entities) if (e.parent && set.has(e.parent) && !set.has(e.id)) {
      set.add(e.id);
      grew = true;
    }
  }
  return entities.filter((e) => set.has(e.id));
}

function uniqueName(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  const stem = base.replace(/\s\d+$/, '');
  let i = 2;
  while (existing.includes(`${stem} ${i}`)) i++;
  return `${stem} ${i}`;
}

// ───────────────────────── entities
export function addEntity(init: EntityInit, opts: { select?: boolean; label?: string } = {}): string {
  const scene = currentScene();
  const entity = createEntity({ ...init, name: uniqueName(scene?.entities.map((e) => e.name) ?? [], init.name ?? 'Entity') });
  editor().apply(opts.label ?? `Add ${entity.name}`, (d) => void sceneOf(d).entities.push(entity));
  if (opts.select !== false) editor().select([entity.id]);
  return entity.id;
}

export function deleteEntities(ids: string[]): void {
  if (!ids.length) return;
  editor().apply(ids.length > 1 ? `Delete ${ids.length} entities` : 'Delete entity', (d) => {
    const scene = sceneOf(d);
    const remove = new Set(withDescendants(scene.entities, ids).map((e) => e.id));
    scene.entities = scene.entities.filter((e) => !remove.has(e.id));
  });
  editor().select([]);
}

export function duplicateEntities(ids: string[]): string[] {
  const scene = currentScene();
  if (!scene || !ids.length) return [];
  const roots = ids.filter((id) => !ids.includes(scene.entities.find((e) => e.id === id)?.parent ?? ''));
  const source = withDescendants(scene.entities, roots);
  const map = new Map(source.map((e) => [e.id, uid('e_')]));
  const names = scene.entities.map((e) => e.name);
  const copies = source.map((e) => {
    const c = structuredClone(e);
    c.id = map.get(e.id)!;
    c.parent = e.parent && map.has(e.parent) ? map.get(e.parent)! : e.parent;
    if (roots.includes(e.id)) {
      c.name = uniqueName(names, e.name);
      names.push(c.name);
    }
    return c;
  });
  editor().apply('Duplicate', (d) => void sceneOf(d).entities.push(...copies));
  const newRoots = roots.map((r) => map.get(r)!);
  editor().select(newRoots);
  return newRoots;
}

export function updateEntity(id: string, recipe: (e: EntityData) => void, label = 'Edit entity', key?: string): void {
  editor().apply(label, (d) => {
    const e = sceneOf(d).entities.find((x) => x.id === id);
    if (e) recipe(e);
  }, key);
}

export function setTransform(id: string, part: 'position' | 'rotation' | 'scale', value: Vec3, key?: string): void {
  updateEntity(id, (e) => void (e.transform[part] = value), `Change ${part}`, key ?? `${id}:${part}`);
}

/** Move an entity under a new parent (or to root), optionally before a sibling. */
export function reparent(id: string, parent: string | null, before?: string): void {
  editor().apply('Reparent', (d) => {
    const scene = sceneOf(d);
    if (parent && withDescendants(scene.entities, [id]).some((e) => e.id === parent)) return; // no cycles
    const idx = scene.entities.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [entity] = scene.entities.splice(idx, 1);
    entity.parent = parent;
    const at = before ? scene.entities.findIndex((e) => e.id === before) : -1;
    if (at >= 0) scene.entities.splice(at, 0, entity);
    else scene.entities.push(entity);
  });
}

// ───────────────────────── components
export function addComponent(entityId: string, type: string, props: Record<string, unknown> = {}): void {
  const schema = getComponentSchema(type);
  updateEntity(entityId, (e) => {
    if (!schema?.multiple && e.components.some((c) => c.type === type)) return;
    e.components.push(createComponent(type, props));
  }, `Add ${schema?.label ?? type}`);
}

export function removeComponent(entityId: string, index: number): void {
  updateEntity(entityId, (e) => void e.components.splice(index, 1), 'Remove component');
}

export function moveComponent(entityId: string, index: number, delta: number): void {
  updateEntity(entityId, (e) => {
    const to = index + delta;
    if (to < 0 || to >= e.components.length) return;
    const [c] = e.components.splice(index, 1);
    e.components.splice(to, 0, c);
  }, 'Reorder components');
}

export function setComponentProp(entityId: string, index: number, key: string, value: unknown): void {
  updateEntity(entityId, (e) => {
    const c = e.components[index];
    if (!c) return;
    c[key] = value;
    // A different grid size makes the old sculpt meaningless.
    if (c.type === 'Terrain' && key === 'resolution') c.heights = '';
  }, 'Edit property', `${entityId}:${index}:${key}`);
}

export function resetComponent(entityId: string, index: number): void {
  updateEntity(entityId, (e) => {
    const c = e.components[index];
    if (c) e.components[index] = createComponent(c.type, c.type === 'Script' ? { script: c.script } : {});
  }, 'Reset component');
}

/** Add or merge a component (used by the AI). */
export function upsertComponent(entityId: string, type: string, props: Record<string, unknown>): void {
  updateEntity(entityId, (e) => {
    const c = e.components.find((x) => x.type === type);
    if (c && !getComponentSchema(type)?.multiple) Object.assign(c, props, { type });
    else e.components.push(createComponent(type, props));
  }, `Set ${type}`);
}

// ───────────────────────── scripts & graphs
export function newScript(name: string, opts: { code?: string; language?: ScriptLanguage; attachTo?: string } = {}): string {
  const project = editor().project!;
  const script = createScript(uniqueName(project.scripts.map((s) => s.name), name), opts.code);
  if (opts.language) script.language = opts.language;
  editor().apply(`New script ${script.name}`, (d) => {
    d.scripts.push(script);
    if (opts.attachTo) sceneOf(d).entities.find((e) => e.id === opts.attachTo)?.components.push(comp('Script', { script: script.id }));
  });
  editor().openScript(script.id);
  return script.id;
}

export function updateScript(id: string, patch: { code?: string; name?: string; language?: ScriptLanguage }): void {
  editor().apply('Edit script', (d) => {
    const s = d.scripts.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  }, patch.code !== undefined ? `script:${id}` : undefined);
}

export function deleteScript(id: string): void {
  editor().apply('Delete script', (d) => {
    d.scripts = d.scripts.filter((s) => s.id !== id);
  });
}

export function newGraph(name: string, attachTo?: string): string {
  const project = editor().project!;
  const graph = createGraph(uniqueName(project.graphs.map((g) => g.name), name));
  editor().apply(`New graph ${graph.name}`, (d) => {
    d.graphs.push(graph);
    if (attachTo) sceneOf(d).entities.find((e) => e.id === attachTo)?.components.push(comp('VisualScript', { graph: graph.id }));
  });
  editor().openGraph(graph.id);
  return graph.id;
}

export function updateGraph(id: string, recipe: (g: GraphData) => void, label = 'Edit graph', key?: string): void {
  editor().apply(label, (d) => {
    const g = d.graphs.find((x) => x.id === id);
    if (g) recipe(g);
  }, key);
}

export function deleteGraph(id: string): void {
  editor().apply('Delete graph', (d) => {
    d.graphs = d.graphs.filter((g) => g.id !== id);
  });
}

// ───────────────────────── assets
export function addAsset(asset: Omit<AssetData, 'id'>): string {
  const project = editor().project!;
  const id = uid('a_');
  editor().apply(`Import ${asset.name}`, (d) => void d.assets.push({ ...asset, id, name: uniqueName(project.assets.map((a) => a.name), asset.name) }));
  return id;
}

/** Use a Starter Content file in this project (reuses the asset if already added). */
export function addSampleAsset(sample: { url: string; type: AssetType; name: string }): string {
  const existing = editor().project!.assets.find((a) => a.url === sample.url);
  return existing?.id ?? addAsset({ name: sample.name, type: sample.type, url: sample.url });
}

export function renameAsset(id: string, name: string): void {
  editor().apply('Rename asset', (d) => {
    const a = d.assets.find((x) => x.id === id);
    if (a) a.name = name;
  });
}

export function deleteAsset(id: string): void {
  editor().apply('Delete asset', (d) => {
    d.assets = d.assets.filter((a) => a.id !== id);
  });
}

// ───────────────────────── prefabs
export function makePrefab(entityId: string, name?: string): string | null {
  const scene = currentScene();
  const root = scene?.entities.find((e) => e.id === entityId);
  if (!scene || !root) return null;
  const tree = structuredClone(withDescendants(scene.entities, [entityId]));
  tree.find((e) => e.id === entityId)!.parent = null;
  const prefabName = name ?? root.name;
  const existing = editor().project!.prefabs.find((p) => p.name === prefabName);
  const prefab = createPrefab(prefabName, tree);
  editor().apply(existing ? `Update prefab ${prefabName}` : `Create prefab ${prefabName}`, (d) => {
    if (existing) {
      const p = d.prefabs.find((x) => x.id === existing.id)!;
      p.entities = tree;
    } else d.prefabs.push(prefab);
  });
  return existing?.id ?? prefab.id;
}

export function instantiatePrefab(prefabId: string, position?: Vec3): string | null {
  const project = editor().project!;
  const prefab = project.prefabs.find((p) => p.id === prefabId);
  if (!prefab) return null;
  const ids = new Map(prefab.entities.map((e) => [e.id, uid('e_')]));
  const copies = prefab.entities.map((e) => {
    const c = structuredClone(e);
    c.id = ids.get(e.id)!;
    c.parent = e.parent ? (ids.get(e.parent) ?? null) : null;
    if (!e.parent && position) c.transform.position = position;
    return c;
  });
  editor().apply(`Place ${prefab.name}`, (d) => void sceneOf(d).entities.push(...copies));
  const root = copies.find((c) => !c.parent)!;
  editor().select([root.id]);
  return root.id;
}

/** The prefab plus every project asset it references, ready to share. */
export function bundlePrefab(prefabId: string): { prefab: import('@bazi/engine').PrefabData; assets: AssetData[] } | null {
  const project = editor().project!;
  const prefab = project.prefabs.find((p) => p.id === prefabId);
  if (!prefab) return null;
  const json = JSON.stringify(prefab);
  return { prefab: structuredClone(prefab), assets: project.assets.filter((a) => json.includes(a.id)).map((a) => ({ id: a.id, name: a.name, type: a.type, url: a.url, size: a.size })) };
}

/** Add a shared prefab to this project: assets are reused by URL, ids are remapped. */
export function importPrefabBundle(bundle: { prefab: import('@bazi/engine').PrefabData; assets: AssetData[] }): string {
  const project = editor().project!;
  let json = JSON.stringify(bundle.prefab);
  const additions: AssetData[] = [];
  for (const a of bundle.assets) {
    const existing = project.assets.find((x) => x.url === a.url) ?? additions.find((x) => x.url === a.url);
    const target = existing ?? { ...a, id: uid('a_') };
    if (!existing) additions.push(target);
    json = json.split(a.id).join(target.id);
  }
  const prefab = JSON.parse(json) as import('@bazi/engine').PrefabData;
  prefab.id = uid('pf_');
  prefab.name = uniqueName(project.prefabs.map((p) => p.name), prefab.name);
  editor().apply(`Import prefab ${prefab.name}`, (d) => {
    d.assets.push(...additions);
    d.prefabs.push(prefab);
  });
  return prefab.id;
}

export function renamePrefab(id: string, name: string): void {
  editor().apply('Rename prefab', (d) => {
    const p = d.prefabs.find((x) => x.id === id);
    if (p) p.name = name;
  });
}

export function deletePrefab(id: string): void {
  editor().apply('Delete prefab', (d) => {
    d.prefabs = d.prefabs.filter((p) => p.id !== id);
  });
}

// ───────────────────────── scenes & settings
export function addScene(name: string): string {
  const project = editor().project!;
  const scene = createScene(uniqueName(project.scenes.map((s) => s.name), name), project.settings.mode);
  editor().apply(`Add scene ${scene.name}`, (d) => void d.scenes.push(scene));
  editor().setScene(scene.id);
  return scene.id;
}

export function duplicateScene(id: string): void {
  const project = editor().project!;
  const src = project.scenes.find((s) => s.id === id);
  if (!src) return;
  const copy: SceneData = { ...structuredClone(src), id: uid('s_'), name: uniqueName(project.scenes.map((s) => s.name), `${src.name} copy`) };
  editor().apply('Duplicate scene', (d) => void d.scenes.push(copy));
  editor().setScene(copy.id);
}

export function renameScene(id: string, name: string): void {
  editor().apply('Rename scene', (d) => {
    const s = d.scenes.find((x) => x.id === id);
    if (s) s.name = name;
  });
}

export function deleteScene(id: string): void {
  const project = editor().project!;
  if (project.scenes.length <= 1) return;
  editor().apply('Delete scene', (d) => {
    d.scenes = d.scenes.filter((s) => s.id !== id);
    if (d.settings.startScene === id) d.settings.startScene = d.scenes[0].id;
  });
  if (editor().sceneId === id) editor().setScene(editor().project!.scenes[0].id);
}

export function updateSettings(recipe: (s: ProjectSettings, p: ProjectData) => void, label = 'Project settings', key?: string): void {
  editor().apply(label, (d) => recipe(d.settings, d), key);
}

export function updateScene(recipe: (s: SceneData) => void, label = 'Scene settings', key?: string): void {
  editor().apply(label, (d) => recipe(sceneOf(d)), key);
}

// ───────────────────────── creation presets (Create menu)
export interface Preset {
  label: string;
  group: string;
  icon: string;
  modes?: ('2d' | '3d')[];
  build(): EntityInit;
}

const physicsBox = (): ComponentData[] => [comp('RigidBody'), comp('Collider')];
/** Starter Content model as a project asset id. */
const sampleModel = (file: string) => addSampleAsset({ url: `/samples/models/${file}.glb`, type: 'model', name: file });

export const PRESETS: Preset[] = [
  { label: 'Empty', group: 'Basic', icon: 'Square', build: () => ({ name: 'Empty' }) },
  { label: 'Cube', group: '3D Shapes', icon: 'Box', modes: ['3d'], build: () => ({ name: 'Cube', position: [0, 0.5, 0], components: [comp('Mesh'), comp('Collider')] }) },
  { label: 'Sphere', group: '3D Shapes', icon: 'Circle', modes: ['3d'], build: () => ({ name: 'Sphere', position: [0, 0.5, 0], components: [comp('Mesh', { shape: 'sphere', color: '#f72585' }), comp('Collider')] }) },
  { label: 'Plane / Floor', group: '3D Shapes', icon: 'RectangleHorizontal', modes: ['3d'], build: () => ({ name: 'Floor', scale: [10, 1, 10], components: [comp('Mesh', { shape: 'plane', color: '#8d99ae' }), comp('Collider')] }) },
  { label: 'Cylinder', group: '3D Shapes', icon: 'Cylinder', modes: ['3d'], build: () => ({ name: 'Cylinder', position: [0, 0.5, 0], components: [comp('Mesh', { shape: 'cylinder', color: '#06d6a0' }), comp('Collider')] }) },
  { label: 'Physics Crate', group: '3D Shapes', icon: 'Package', modes: ['3d'], build: () => ({ name: 'Crate', position: [0, 3, 0], components: [comp('Mesh', { color: '#d4a373' }), ...physicsBox()] }) },
  { label: '3D Model', group: '3D Shapes', icon: 'Shapes', modes: ['3d'], build: () => ({ name: 'Model', components: [comp('Model')] }) },
  { label: 'Sprite', group: '2D', icon: 'Image', build: () => ({ name: 'Sprite', components: [comp('Sprite', { color: '#4cc9f0' })] }) },
  { label: 'Solid Block', group: '2D', icon: 'Square', modes: ['2d'], build: () => ({ name: 'Block', components: [comp('Sprite', { color: '#8d5a3b' }), comp('Collider')] }) },
  { label: 'Terrain', group: '3D Shapes', icon: 'Mountain', modes: ['3d'], build: () => ({ name: 'Terrain', components: [comp('Terrain')] }) },
  { label: 'Tile Map', group: '2D', icon: 'Grid3x3', build: () => ({ name: 'Tile Map', components: [comp('TileMap')] }) },
  { label: 'Platformer Player', group: 'Characters', icon: 'Footprints', build: () => ({ name: 'Player', tags: ['player'], position: [0, 1, 0], components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'capsule' }) : comp('Sprite', { color: '#4361ee', width: 0.8, height: 1.1 }), comp('RigidBody', { lockRotation: true }), comp('Collider', { friction: 0 }), comp('PlatformerController')] }) },
  { label: 'Top-Down Player', group: 'Characters', icon: 'Move', build: () => ({ name: 'Player', tags: ['player'], position: [0, editor().project?.settings.mode === '3d' ? 1 : 0, 0], components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'capsule' }) : comp('Sprite', { color: '#4cc9f0' }), comp('RigidBody', { lockRotation: true, gravityScale: editor().project?.settings.mode === '3d' ? 1 : 0 }), comp('Collider'), comp('TopDownController')] }) },
  { label: 'First-Person Player', group: 'Characters', icon: 'Eye', modes: ['3d'], build: () => ({ name: 'Player', tags: ['player'], position: [0, 1.2, 0], components: [comp('RigidBody', { lockRotation: true }), comp('Collider', { shape: 'capsule', size: [0.8, 1.8, 0.8] }), comp('FirstPersonController')] }) },
  { label: 'Coin', group: 'Gameplay', icon: 'Coins', build: () => ({ name: 'Coin', tags: ['coin'], components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'torus', color: '#ffd166', metalness: 0.8 }) : comp('Sprite', { color: '#ffd166', width: 0.5, height: 0.5 }), comp('Collider', { isTrigger: true }), comp('Collectible'), comp('Rotator')] }) },
  { label: 'Hazard', group: 'Gameplay', icon: 'Swords', build: () => ({ name: 'Hazard', tags: ['hazard'], components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'cone', color: '#ef476f' }) : comp('Sprite', { color: '#ef476f', height: 0.5 }), comp('Collider', { isTrigger: true }), comp('Damage')] }) },
  { label: 'Goal', group: 'Gameplay', icon: 'Flag', build: () => ({ name: 'Goal', components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'cylinder', color: '#06d6a0' }) : comp('Sprite', { color: '#06d6a0', width: 0.6, height: 1.6 }), comp('Collider', { isTrigger: true }), comp('Goal')] }) },
  { label: 'Spawner', group: 'Gameplay', icon: 'CopyPlus', build: () => ({ name: 'Spawner', components: [comp('Spawner')] }) },
  // Strategy: units, defenses and economy (uses Starter Content models).
  { label: 'Soldier (blue)', group: 'Strategy', icon: 'Swords', modes: ['3d'], build: () => ({ name: 'Soldier', components: [comp('Model', { model: sampleModel('knight_blue') }), comp('UnitAI', { team: 'blue', speed: 1.6, damage: 2 }), comp('Health', { max: 12, invulnerableTime: 0, showBar: true, damageNumbers: true })] }) },
  { label: 'Enemy (red)', group: 'Strategy', icon: 'Swords', modes: ['3d'], build: () => ({ name: 'Enemy', rotation: [0, 180, 0], components: [comp('Model', { model: sampleModel('knight_red') }), comp('UnitAI', { team: 'red', speed: 1.6, damage: 2 }), comp('Health', { max: 12, invulnerableTime: 0, showBar: true, damageNumbers: true })] }) },
  { label: 'Archer (blue)', group: 'Strategy', icon: 'Target', modes: ['3d'], build: () => ({ name: 'Archer', components: [comp('Model', { model: sampleModel('archer_blue') }), comp('UnitAI', { team: 'blue', speed: 1.7, attackRange: 4.5, projectile: 'arrow' }), comp('Health', { max: 7, invulnerableTime: 0, showBar: true, damageNumbers: true })] }) },
  { label: 'Defense Tower', group: 'Strategy', icon: 'Castle', modes: ['3d'], build: () => ({ name: 'Tower', components: [comp('Model', { model: sampleModel('tower_blue'), animation: 'Idle' }), comp('Collider', { shape: 'cylinder', size: [1.8, 3, 1.8], offset: [0, 1.5, 0] }), comp('UnitAI', { team: 'blue', speed: 0, aggroRange: 7, attackRange: 6.5, damage: 2, attackCooldown: 0.8, projectile: 'arrow' }), comp('Health', { max: 40, invulnerableTime: 0, showBar: true })] }) },
  { label: 'Gold Mine', group: 'Strategy', icon: 'Pickaxe', modes: ['3d'], build: () => ({ name: 'Gold Mine', components: [comp('Model', { model: sampleModel('gold_mine'), animation: 'Work' }), comp('Collider', { shape: 'box', size: [1.6, 1.5, 1.6], offset: [0, 0.75, 0] }), comp('ResourceGenerator')] }) },
  { label: 'Card Deck (deploy)', group: 'Strategy', icon: 'Layers', build: () => ({ name: 'Card Deck', components: [comp('SpawnMenu')] }) },
  { label: 'Build Menu (grid)', group: 'Strategy', icon: 'Hammer', build: () => ({ name: 'Build Menu', components: [comp('SpawnMenu', { mode: 'build', gridSize: 2, items: 'House:30:🏠', label: 'Gold', currency: 'gold', start: 100, max: 0, regen: 0 })] }) },
  { label: 'Click-to-move Agent', group: 'Strategy', icon: 'Footprints', build: () => ({ name: 'Agent', position: [0, editor().project?.settings.mode === '3d' ? 0.5 : 0, 0], components: [editor().project?.settings.mode === '3d' ? comp('Mesh', { shape: 'capsule', color: '#38bdf8' }) : comp('Sprite', { color: '#38bdf8' }), comp('NavAgent')] }) },
  { label: 'Route Builder (metro)', group: 'Strategy', icon: 'Route', build: () => ({ name: 'Routes', components: [comp('RouteBuilder')] }) },
  { label: 'Station', group: 'Strategy', icon: 'TrainFront', build: () => ({ name: 'Station', tags: ['station'], components: [comp('Sprite', { color: '#ffffff', width: 0.9, height: 0.9 })] }) },
  { label: 'Strategy Camera', group: 'Camera & Light', icon: 'Move3d', build: () => ({ name: 'RTS Camera', position: editor().project?.settings.mode === '3d' ? [0, 16, 14] : [0, 0, 10], rotation: editor().project?.settings.mode === '3d' ? [-50, 0, 0] : [0, 0, 0], components: [comp('Camera'), comp('StrategyCamera')] }) },
  { label: 'Video Screen', group: 'Effects & UI', icon: 'Film', build: () => ({ name: 'Video', position: [0, editor().project?.settings.mode === '3d' ? 1.5 : 0, 0], components: [comp('Video', { video: addSampleAsset({ url: '/samples/video/aurora_loop.mp4', type: 'video', name: 'aurora_loop' }) })] }) },
  { label: 'Camera', group: 'Camera & Light', icon: 'Video', build: () => ({ name: 'Camera', position: [0, editor().project?.settings.mode === '3d' ? 3 : 0, 10], components: [comp('Camera', { primary: false })] }) },
  { label: 'Directional Light', group: 'Camera & Light', icon: 'Sun', modes: ['3d'], build: () => ({ name: 'Sun', position: [4, 8, 4], rotation: [-50, 30, 0], components: [comp('Light')] }) },
  { label: 'Point Light', group: 'Camera & Light', icon: 'Lightbulb', build: () => ({ name: 'Point Light', position: [0, 2, 0], components: [comp('Light', { kind: 'point', intensity: 2, distance: 10 })] }) },
  { label: 'Spot Light', group: 'Camera & Light', icon: 'Flashlight', modes: ['3d'], build: () => ({ name: 'Spot Light', position: [0, 5, 0], rotation: [-90, 0, 0], components: [comp('Light', { kind: 'spot', intensity: 3, distance: 20 })] }) },
  { label: 'Particles', group: 'Effects & UI', icon: 'Sparkles', build: () => ({ name: 'Particles', components: [comp('Particles')] }) },
  { label: 'World Text', group: 'Effects & UI', icon: 'Type', build: () => ({ name: 'Text', components: [comp('Text')] }) },
  { label: 'HUD Text', group: 'Effects & UI', icon: 'PanelTop', build: () => ({ name: 'HUD', components: [comp('HudText')] }) },
  { label: 'Sound', group: 'Effects & UI', icon: 'Volume2', build: () => ({ name: 'Sound', components: [comp('AudioSource', { preset: 'coin', autoplay: false })] }) },
];

export function createFromPreset(preset: Preset, parent: string | null = null): string {
  const init = preset.build();
  return addEntity({ ...init, parent }, { label: `Create ${preset.label}` });
}

// ───────────────────────── animation controllers
export function newAnimator(name = 'Animator', attachTo?: string): string {
  const project = editor().project!;
  const animator = createAnimator(uniqueName((project.animators ?? []).map((a) => a.name), name));
  editor().apply(`New animator ${animator.name}`, (d) => {
    (d.animators ??= []).push(animator);
    if (attachTo) sceneOf(d).entities.find((e) => e.id === attachTo)?.components.push(comp('Animator', { controller: animator.id }));
  });
  editor().openAnimator(animator.id);
  return animator.id;
}

export function updateAnimator(id: string, recipe: (a: AnimatorData) => void, label = 'Edit animation', key?: string): void {
  editor().apply(label, (d) => {
    const a = d.animators?.find((x) => x.id === id);
    if (a) recipe(a);
  }, key);
}

export function deleteAnimator(id: string): void {
  editor().apply('Delete animator', (d) => {
    d.animators = (d.animators ?? []).filter((a) => a.id !== id);
  });
}

// ───────────────────────── level tools
const tileMapOf = (e: EntityData | undefined) => e?.components.find((c) => c.type === 'TileMap');

/**
 * Paint tiles on a TileMap entity. If the grid grows left/up, the entity moves
 * by the same amount so every existing tile stays where it was in the world.
 */
let strokeSeq = 0;
/** Each mouse stroke is one undo step: call at pointer-down. */
export const beginStroke = (): number => ++strokeSeq;

export function paintTileMap(entityId: string, cells: Array<[number, number]>, char: string, label = 'Paint tiles'): void {
  if (!cells.length) return;
  const mode2d = editor().project?.settings.mode === '2d';
  updateEntity(entityId, (e) => {
    const map = tileMapOf(e);
    if (!map) return;
    const size = Number(map.tileSize ?? 1);
    const current = String(map.map ?? '');
    const res = paintCells(current, cells, char);
    if (res.map === current) return;
    map.map = res.map;
    if (res.shiftCols || res.shiftRows) e.transform.position = originShift(e.transform.position, res.shiftCols, res.shiftRows, size, mode2d);
  }, label, `paint:${entityId}:${strokeSeq}`);
}

export function fillTileMap(entityId: string, col: number, row: number, char: string): void {
  const e = findEntity(entityId);
  const map = tileMapOf(e);
  if (!map) return;
  const cells = floodCells(String(map.map ?? ''), col, row);
  if (cells.length) paintTileMap(entityId, cells, char, 'Fill tiles');
}

/** Write terrain heights (hex string) without rebuilding the whole component. */
export function setTerrainHeights(entityId: string, heights: string, key = `sculpt:${entityId}:${strokeSeq}`): void {
  updateEntity(entityId, (e) => {
    const t = e.components.find((c) => c.type === 'Terrain');
    if (t) t.heights = heights;
  }, 'Sculpt terrain', key);
}

export function terrainLevels(entityId: string): { levels: Uint8Array; resolution: number } | null {
  const t = findEntity(entityId)?.components.find((c) => c.type === 'Terrain');
  if (!t) return null;
  const resolution = Math.max(8, Math.min(128, Math.round(Number(t.resolution ?? 48))));
  return { levels: decodeHeights(String(t.heights ?? ''), resolution), resolution };
}

export function resetTerrain(entityId: string): void {
  const info = terrainLevels(entityId);
  if (info) setTerrainHeights(entityId, flatHeights(info.resolution), `reset:${entityId}`);
}

export { encodeHeights };
