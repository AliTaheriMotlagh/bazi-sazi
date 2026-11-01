/**
 * Lightweight entry: data model, templates, validation and docs — no three.js,
 * no physics. Use it from pages that don't run games (home, explore, server).
 */
export * from './types';
export * from './util';
export * from './components/registry';
export * from './project/defaults';
export * from './project/templates';
export { royaleArena, villageBuilder, towerDefense, metroLines } from './project/strategyTemplates';
export * from './project/validate';
export * from './project/summary';
export * from './project/migrate';
export { SCRIPT_API_DTS } from './docs/scriptApi';
export { NODES, NODE_CATEGORIES, getNodeDef, type NodeDef, type PinDef, type PinKind, type NodeCategory } from './visual/nodes';
export { compileScript } from './runtime/compile';
export * from './project/tilemap';
export * from './project/terrain';
export * from './project/animation';
export * from './systems/navmesh';
export * from './systems/shaderGraph';
export * from './systems/collab';
export * from './systems/authoritative';
export * from './systems/perf';
