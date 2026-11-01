import { createComponent, Runtime, RAD2DEG, type AssetType, type Vec3 } from '@bazi/engine';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import { applyTerrainBrush, encodeHeights, lineCells, rectCells, worldToCell } from '@bazi/engine';
import { addAsset, addEntity, addSampleAsset, createFromPreset, instantiatePrefab, PRESETS, updateEntity, beginStroke, fillTileMap, paintTileMap, setTerrainHeights, terrainLevels, findEntity } from '../../store/commands';
import { editor, useEditor, type ViewportOptions } from '../../store/editor';
import { logToConsole } from '../../store/console';
import { toast } from '../../store/ui';
import { api } from '../../api/client';
import { Icon } from '../../ui/Icon';
import { Spinner, useMenu } from '../../ui/primitives';
import { ACTIONS } from '../actions';
import { toMenuItem } from '../MenuBar';
import { useSession, viewportBridge } from '../session';

export const DRAG_MIME = 'application/x-bazi';
export interface DragPayload {
  kind: 'asset' | 'prefab' | 'script' | 'graph' | 'sample' | 'preset';
  /** Asset/prefab/script/graph id, sample url, or preset label. */
  id: string;
  type?: string;
  name?: string;
}

const round = (v: number, snap: boolean, step: number) => (snap ? Math.round(v / step) * step : Math.round(v * 1000) / 1000);

/** Live objects owned by the scene view. `camera` is whichever camera is active. */
interface Tools {
  runtime: Runtime;
  orbit: OrbitControls;
  gizmo: TransformControls;
  camera: THREE.Camera;
  persp: THREE.PerspectiveCamera | null;
  ortho: THREE.OrthographicCamera;
  grid: THREE.GridHelper;
  helper: ViewHelper | null;
}

/** Tells the user what the black viewport is waiting for: the engine starting, then models/textures downloading. */
function LoadingOverlay({ ready }: { ready: boolean }) {
  const runtime = useSession((s) => s.editRuntime);
  const [state, setState] = useState({ loaded: 0, total: 0 });
  useEffect(() => {
    if (!runtime) return;
    const update = () => setState(runtime.assets.loading);
    update();
    return runtime.assets.onLoadingChange(update);
  }, [runtime]);
  const busy = !ready || state.total > 0;
  if (!busy) return null;
  const pct = ready && state.total ? Math.round((state.loaded / state.total) * 100) : 0;
  return (
    <div className="vp-loading" role="status" aria-live="polite">
      <Spinner />
      <span>{ready ? `Loading models and textures… ${state.loaded}/${state.total}` : 'Starting the engine…'}</span>
      {ready && <div className="vp-loading-bar"><i style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

/** Editor scene view: an edit-mode Runtime + editor camera, grid, gizmos and picking. */
export function SceneView() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const mode = useEditor((s) => s.project?.settings.mode ?? '3d');
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const viewport = useEditor((s) => s.viewport);
  const tools = useRef<Tools | null>(null);

  // Create the runtime once per project mode (2D/3D need different cameras).
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const { project, sceneId } = editor();
    if (!project || !canvas.current) return;
    void Runtime.create({ canvas: canvas.current, project, mode: 'edit', sceneId, logger: logToConsole }).then((runtime) => {
      if (disposed) return runtime.dispose();
      const is2d = project.settings.mode === '2d';
      const ortho = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 4000);
      ortho.userData.orthoSize = 7;
      const persp = is2d ? null : new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
      const camera: THREE.Camera = persp ?? ortho;
      camera.position.set(...((is2d ? [0, 0, 50] : [8, 7, 12]) as Vec3));
      camera.lookAt(0, 0, 0);
      runtime.setEditorCamera(camera);

      const grid = new THREE.GridHelper(200, 200, 0x55607a, 0x2a3142);
      if (is2d) grid.rotation.x = Math.PI / 2;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.55;
      grid.userData.editorOnly = true;
      runtime.scene.add(grid);
      const axes = new THREE.AxesHelper(1.5);
      axes.userData.editorOnly = true;
      runtime.scene.add(axes);

      const orbit = new OrbitControls(camera, canvas.current!);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.15;
      // Unreal-style: left orbit, middle pan, right = fly (handled below).
      if (!is2d) orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: -1 as THREE.MOUSE };
      if (is2d) {
        orbit.enableRotate = false;
        orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        orbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
        orbit.screenSpacePanning = true;
        orbit.zoomToCursor = true;
      }
      const gizmo = new TransformControls(camera, canvas.current!);
      const helper = gizmo.getHelper();
      helper.userData.editorOnly = true;
      runtime.scene.add(helper);
      gizmo.addEventListener('dragging-changed', (e) => {
        orbit.enabled = !(e as unknown as { value: boolean }).value;
        if (!(e as unknown as { value: boolean }).value) commitGizmo();
      });
      const viewHelper = persp ? new ViewHelper(persp, canvas.current!) : null;

      const commitGizmo = () => {
        const obj = gizmo.object;
        const id = obj?.userData.entityId as string | undefined;
        if (!obj || !id) return;
        const s = editor().snap;
        const p: Vec3 = [round(obj.position.x, s, 0.5), round(obj.position.y, s, 0.5), round(obj.position.z, s, 0.5)];
        const r: Vec3 = [round(obj.rotation.x * RAD2DEG, s, 15), round(obj.rotation.y * RAD2DEG, s, 15), round(obj.rotation.z * RAD2DEG, s, 15)];
        const sc: Vec3 = [round(obj.scale.x, s, 0.25), round(obj.scale.y, s, 0.25), round(obj.scale.z, s, 0.25)];
        updateEntity(id, (e) => {
          e.transform.position = p;
          e.transform.rotation = r;
          e.transform.scale = sc;
        }, `Transform ${obj.name}`);
      };

      tools.current = { runtime, orbit, gizmo, camera, persp, ortho, grid, helper: viewHelper };
      useSession.getState().set({ editRuntime: runtime });
      const fly = createFlyControls(canvas.current!, () => tools.current, orbit);
      const onFrame = (dt: number) => {
        fly.update(dt);
        if (viewHelper?.animating) viewHelper.update(dt);
        else if (!fly.active) orbit.update();
        if (viewHelper) viewHelper.center.copy(orbit.target);
      };
      const afterRender = () => {
        if (!viewHelper || tools.current?.camera !== persp) return;
        runtime.renderer.autoClear = false;
        viewHelper.render(runtime.renderer);
        runtime.renderer.autoClear = true;
      };
      runtime.frameHooks.add(onFrame);
      runtime.afterRenderHooks.add(afterRender);
      runtime.start();

      viewportBridge.capture = () => {
        try {
          runtime.render();
          const src = canvas.current!;
          const out = document.createElement('canvas');
          out.width = 480;
          out.height = 270;
          const ctx = out.getContext('2d')!;
          const scale = Math.max(out.width / src.width, out.height / src.height);
          const w = src.width * scale;
          const h = src.height * scale;
          ctx.drawImage(src, (out.width - w) / 2, (out.height - h) / 2, w, h);
          return out.toDataURL('image/webp', 0.72);
        } catch {
          return null;
        }
      };
      viewportBridge.focusSelection = () => {
        const id = editor().selection[0];
        const obj = id && runtime.getObject(id)?.object3d;
        if (!obj) return;
        const target = new THREE.Box3().setFromObject(obj);
        const center = target.isEmpty() ? obj.getWorldPosition(new THREE.Vector3()) : target.getCenter(new THREE.Vector3());
        const size = target.isEmpty() ? 2 : Math.max(1, target.getSize(new THREE.Vector3()).length());
        const cam = tools.current?.camera ?? camera;
        const offset = cam.position.clone().sub(orbit.target).normalize().multiplyScalar(size * 1.8);
        orbit.target.copy(center);
        cam.position.copy(center).add(cam instanceof THREE.OrthographicCamera ? offset.setLength(200) : offset);
      };
      viewportBridge.dropPosition = (x, y) => {
        const r = canvas.current!.getBoundingClientRect();
        const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, tools.current?.camera ?? camera);
        const plane = is2d ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (!hit) return [0, 0, 0];
        const s = editor().snap;
        return [round(hit.x, s, 0.5), round(hit.y + (is2d ? 0 : 0.5), s, 0.5), round(hit.z, s, 0.5)];
      };
      setReady(true);
      cleanup = () => {
        runtime.frameHooks.delete(onFrame);
        runtime.afterRenderHooks.delete(afterRender);
        fly.dispose();
        viewHelper?.dispose();
        gizmo.detach();
        gizmo.dispose();
        orbit.dispose();
        runtime.dispose();
        useSession.getState().set({ editRuntime: null });
      };
    });
    return () => {
      disposed = true;
      setReady(false);
      tools.current = null;
      cleanup();
    };
  }, [mode]);

  // Keep the runtime in sync with project data (diffed inside Runtime.sync).
  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const t = tools.current;
      const { project, sceneId, selection } = editor();
      if (!t || !project) return;
      t.runtime.sync(project, sceneId);
      const obj = selection.length === 1 ? t.runtime.getObject(selection[0])?.object3d : undefined;
      if (obj && !t.gizmo.dragging) {
        if (t.gizmo.object !== obj) t.gizmo.attach(obj);
      } else if (!obj) t.gizmo.detach();
      t.runtime.outlined = selection.map((id) => t.runtime.getObject(id)?.object3d).filter((o): o is THREE.Object3D => !!o);
      applyViewportOptions(t, editor().viewport);
    };
    sync();
    return useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.sceneId !== prev.sceneId || s.selection !== prev.selection) sync();
      if (s.viewport !== prev.viewport && tools.current) {
        if (s.viewport.view !== prev.viewport.view) setView(tools.current, s.viewport.view);
        applyViewportOptions(tools.current, s.viewport);
      }
    });
  }, [ready]);

  // Gizmo mode / snapping.
  useEffect(() => {
    const g = tools.current?.gizmo;
    if (!g) return;
    g.setMode(tool);
    g.setTranslationSnap(snap ? 0.5 : null);
    g.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    g.setScaleSnap(snap ? 0.25 : null);
    const is2d = mode === '2d';
    g.showZ = !is2d || tool === 'rotate';
    g.showX = !(is2d && tool === 'rotate');
    g.showY = !(is2d && tool === 'rotate');
  }, [tool, snap, ready, mode]);

  // Click-to-select (ignores drags so orbiting doesn't change selection).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const t = tools.current;
      if (!down || !t || t.gizmo.dragging) return;
      if (t.helper && t.camera === t.persp && t.helper.handleClick(e)) {
        down = null;
        return;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      down = null;
      if (moved || e.button !== 0) return;
      if ((t.gizmo as unknown as { axis: string | null }).axis) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const id = t.runtime.pick(ndc, t.camera, editor().viewport.gizmos);
      editor().select(id ? [id] : [], e.shiftKey || e.metaKey || e.ctrlKey);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Level tools: paint tiles / sculpt terrain by dragging in the scene view.
  // Registered in the capture phase so the orbit camera, gizmo and click-select stay out of the way.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !ready) return;
    let active: { kind: 'paint' | 'sculpt'; id: string; last: [number, number] | null; start: [number, number] | null } | null = null;
    const ndcOf = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const selected = (type: string) => {
      const { selection } = editor();
      const ent = selection.length === 1 ? findEntity(selection[0]) : undefined;
      return ent?.components.some((c) => c.type === type && c.enabled !== false) ? ent : undefined;
    };
    const cellAt = (e: PointerEvent, ent: NonNullable<ReturnType<typeof findEntity>>): [number, number] | null => {
      const t = tools.current;
      if (!t) return null;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndcOf(e), t.camera);
      const is2d = editor().project?.settings.mode === '2d';
      const p = ent.transform.position;
      const plane = is2d ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -p[2]) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -p[1]);
      const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const size = Number(ent.components.find((c) => c.type === 'TileMap')?.tileSize ?? 1);
      return worldToCell([hit.x, hit.y, hit.z], p, size, is2d);
    };
    const paintAt = (e: PointerEvent, first: boolean) => {
      const { paint } = editor();
      const ent = active && findEntity(active.id);
      if (!paint || !ent || !active) return;
      const cell = cellAt(e, ent);
      if (!cell) return;
      const ch = paint.tool === 'erase' ? '.' : paint.char;
      if (paint.tool === 'fill') {
        if (first) fillTileMap(ent.id, cell[0], cell[1], ch);
      } else if (paint.tool === 'rect') {
        if (first) active.start = cell;
      } else {
        paintTileMap(ent.id, active.last ? lineCells(active.last, cell) : [cell], ch);
        // Growing left/up moves the entity, so remember the cell in the new coordinates.
        const moved = findEntity(ent.id);
        active.last = moved ? cellAt(e, moved) : cell;
      }
    };
    const sculptAt = (e: PointerEvent) => {
      const t = tools.current;
      const { sculpt } = editor();
      const ent = active && findEntity(active.id);
      if (!t || !sculpt || !ent || !active) return;
      const obj = t.runtime.getObject(ent.id)?.object3d;
      if (!obj) return;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndcOf(e), t.camera);
      const hit = ray.intersectObject(obj, true)[0];
      if (!hit) return;
      const info = terrainLevels(ent.id);
      if (!info) return;
      const size = Number(ent.components.find((c) => c.type === 'Terrain')?.size ?? 40);
      const local = obj.worldToLocal(hit.point.clone());
      const brush = e.shiftKey && sculpt.brush === 'raise' ? 'lower' : e.shiftKey && sculpt.brush === 'lower' ? 'raise' : sculpt.brush;
      applyTerrainBrush(info.levels, info.resolution, brush, local.x / size + 0.5, local.z / size + 0.5, sculpt.radius, sculpt.strength);
      setTerrainHeights(ent.id, encodeHeights(info.levels));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || editor().playState !== 'edit') return;
      const { paint, sculpt } = editor();
      const tile = paint?.viewport ? selected('TileMap') : undefined;
      const terrain = sculpt ? selected('Terrain') : undefined;
      const ent = tile ?? terrain;
      if (!ent) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      beginStroke();
      active = { kind: tile ? 'paint' : 'sculpt', id: ent.id, last: null, start: null };
      if (tile) paintAt(e, true);
      else sculptAt(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!active) return;
      if (active.kind === 'paint') paintAt(e, false);
      else sculptAt(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!active) return;
      const { paint } = editor();
      const ent = findEntity(active.id);
      if (active.kind === 'paint' && paint?.tool === 'rect' && active.start && ent) {
        const end = cellAt(e, ent);
        if (end) paintTileMap(ent.id, rectCells(active.start, end), paint.char, 'Paint rectangle');
      }
      active = null;
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [ready]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const pos = viewportBridge.dropPosition(e.clientX, e.clientY);
    const is2d = editor().project?.settings.mode === '2d';
    // Files from the OS: upload, then place.
    if (e.dataTransfer.files.length) {
      for (const file of [...e.dataTransfer.files]) {
        try {
          const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : /\.(glb|gltf)$/i.test(file.name) ? 'model' : null;
          if (!kind) {
            toast(`Unsupported file: ${file.name}`, 'error');
            continue;
          }
          const up = await api.upload(file);
          const id = addAsset({ name: file.name.replace(/\.\w+$/, ''), type: kind, url: up.url, size: up.size });
          placeAsset(id, kind, pos, is2d);
        } catch (err) {
          toast((err as Error).message, 'error');
        }
      }
      return;
    }
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    if (payload.kind === 'prefab') instantiatePrefab(payload.id, pos);
    if (payload.kind === 'sample') {
      const id = addSampleAsset({ url: payload.id, type: (payload.type ?? 'model') as AssetType, name: payload.name ?? 'Sample' });
      placeAsset(id, payload.type ?? 'model', pos, is2d);
    }
    if (payload.kind === 'preset') {
      const preset = PRESETS.find((p) => p.label === payload.id);
      if (preset) {
        const id = createFromPreset(preset);
        updateEntity(id, (en) => void (en.transform.position = is2d ? [pos[0], pos[1], 0] : [pos[0], Math.max(pos[1], en.transform.position[1]), pos[2]]), 'Place');
      }
    }
    if (payload.kind === 'asset') {
      const asset = editor().project?.assets.find((a) => a.id === payload.id);
      if (asset) placeAsset(asset.id, asset.type, pos, is2d);
    }
    if (payload.kind === 'script' || payload.kind === 'graph') {
      const target = tools.current?.runtime.pick(dropNdc(e, canvas.current!), tools.current.camera, true);
      if (!target) return toast('Drop scripts onto an object to attach them');
      updateEntity(target, (en) => void en.components.push(createComponent(payload.kind === 'script' ? 'Script' : 'VisualScript', { [payload.kind]: payload.id })), 'Attach script');
      editor().select([target]);
    }
  };

  return (
    <div
      ref={host}
      className="viewport"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas ref={canvas} className="scene-canvas" tabIndex={0} aria-label="Scene view" />
      <LoadingOverlay ready={ready} />
      <ViewportToolbar mode={mode} />
      {viewport.stats && <StatsOverlay />}
      <div className="viewport-hint hide-phone">
        {mode === '2d' ? 'Drag to pan · Scroll to zoom · Click to select' : 'Left-drag orbit · Middle-drag pan · Hold right mouse + WASD/QE to fly · Scroll zoom'}
      </div>
      {dragOver && <div className="drop-hint">Drop to add to the scene</div>}
    </div>
  );
}

function dropNdc(e: React.DragEvent, el: HTMLCanvasElement): THREE.Vector2 {
  const r = el.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

export function placeAsset(assetId: string, type: string, position: Vec3, is2d: boolean): void {
  const asset = editor().project?.assets.find((a) => a.id === assetId);
  const name = asset?.name ?? 'Object';
  if (type === 'image') {
    // Size the sprite from the image's aspect ratio.
    const id = addEntity({ name, position: is2d ? [position[0], position[1], 0] : position, components: [createComponent('Sprite', { image: assetId, billboard: !is2d })] });
    const img = new Image();
    img.onload = () => {
      const aspect = img.width / Math.max(1, img.height);
      updateEntity(id, (e) => {
        const c = e.components.find((x) => x.type === 'Sprite');
        if (c) c.width = Math.round(aspect * 100) / 100;
      }, 'Fit sprite', `fit:${id}`);
    };
    img.src = asset?.url ?? '';
  } else if (type === 'model') addEntity({ name, position, components: [createComponent('Model', { model: assetId })] });
  else if (type === 'audio') addEntity({ name, position, components: [createComponent('AudioSource', { clip: assetId })] });
}


const AXES: Record<ViewportOptions['view'], THREE.Vector3> = {
  perspective: new THREE.Vector3(),
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  right: new THREE.Vector3(1, 0, 0),
};

/** Switch between the perspective camera and orthographic top/front/right views. */
function setView(t: Tools, view: ViewportOptions['view']): void {
  if (!t.persp) return; // 2D scenes are always orthographic
  const target = t.orbit.target.clone();
  let cam: THREE.Camera;
  if (view === 'perspective') {
    cam = t.persp;
    t.orbit.enableRotate = true;
  } else {
    cam = t.ortho;
    const dist = t.camera.position.distanceTo(target);
    t.ortho.userData.orthoSize = Math.max(2, dist * 0.45);
    t.ortho.zoom = 1;
    t.ortho.position.copy(target).addScaledVector(AXES[view], 200);
    t.ortho.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
    t.ortho.lookAt(target);
    t.orbit.enableRotate = false;
  }
  t.camera = cam;
  t.orbit.object = cam;
  t.gizmo.camera = cam;
  t.runtime.setEditorCamera(cam);
  t.orbit.update();
}

const CLAY = new THREE.MeshStandardMaterial({ color: '#c9c9c9', roughness: 0.85, metalness: 0 });
const WIRE = new THREE.MeshBasicMaterial({ color: '#8fb3ff', wireframe: true });

/** Grid, icon visibility and Lit/Clay/Wireframe shading (swaps materials on scene meshes only). */
function applyViewportOptions(t: Tools, o: ViewportOptions): void {
  t.grid.visible = o.grid;
  const override = o.shading === 'clay' ? CLAY : o.shading === 'wireframe' ? WIRE : null;
  for (const go of t.runtime.entities.values()) {
    go.object3d.traverse((obj) => {
      if (obj.userData.editorOnly) {
        if (obj.userData.entityId) obj.visible = o.gizmos;
        return;
      }
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.userData.__mat) mesh.userData.__mat = mesh.material;
      mesh.material = override ?? mesh.userData.__mat;
    });
  }
}

/** Unreal-style fly camera: hold the right mouse button, look with the mouse, move with WASD / Q E. */
function createFlyControls(el: HTMLCanvasElement, tools: () => Tools | null, orbit: OrbitControls) {
  const keys = new Set<string>();
  let active = false;
  let speed = 6;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const onDown = (e: PointerEvent) => {
    const t = tools();
    if (e.button !== 2 || !t || t.camera !== t.persp) return;
    active = true;
    viewportBridge.flying = true;
    orbit.enabled = false;
    euler.setFromQuaternion(t.camera.quaternion);
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const t = tools();
    if (!active || !t) return;
    euler.y -= e.movementX * 0.003;
    euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * 0.003, -1.5, 1.5);
    t.camera.quaternion.setFromEuler(euler);
  };
  const onUp = (e: PointerEvent) => {
    const t = tools();
    if (e.button !== 2 || !active || !t) return;
    active = false;
    viewportBridge.flying = false;
    keys.clear();
    // Re-centre the orbit pivot in front of the camera.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(t.camera.quaternion);
    orbit.target.copy(t.camera.position).addScaledVector(forward, Math.max(2, t.camera.position.distanceTo(orbit.target)));
    orbit.enabled = true;
  };
  const onKey = (e: KeyboardEvent) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'keydown') keys.add(e.code);
    else keys.delete(e.code);
  };
  const onWheel = (e: WheelEvent) => {
    if (!active) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    speed = THREE.MathUtils.clamp(speed * (e.deltaY > 0 ? 0.85 : 1.18), 0.5, 200);
  };
  const noMenu = (e: Event) => e.preventDefault();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('contextmenu', noMenu);
  el.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const v = new THREE.Vector3();
  return {
    get active() {
      return active;
    },
    update(dt: number) {
      const t = tools();
      if (!active || !t || !keys.size) return;
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
      v.set(+keys.has('KeyD') - +keys.has('KeyA'), +keys.has('KeyE') - +keys.has('KeyQ'), +keys.has('KeyS') - +keys.has('KeyW'));
      if (v.lengthSq() === 0) return;
      v.normalize().multiplyScalar(speed * boost * dt).applyQuaternion(t.camera.quaternion);
      t.camera.position.add(v);
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('contextmenu', noMenu);
      el.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    },
  };
}

/** In-viewport toolbar (view, shading, show flags) — like Unreal's viewport options bar. */
function ViewportToolbar({ mode }: { mode: '2d' | '3d' }) {
  const vp = useEditor((s) => s.viewport);
  const menu = useMenu();
  const items = (prefix: string[]) => ACTIONS.filter((a) => prefix.some((p) => a.id.startsWith(p))).map(toMenuItem);
  const viewLabel = vp.view === 'perspective' ? 'Perspective' : vp.view[0].toUpperCase() + vp.view.slice(1);
  return (
    <div className="viewport-overlay vp-toolbar">
      {mode === '3d' && (
        <button className="chip" onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), items(['view.perspective', 'view.top', 'view.front', 'view.right']))}>
          <Icon name={vp.view === 'perspective' ? 'Box' : 'Square'} size={13} /> {viewLabel} <Icon name="ChevronDown" size={11} />
        </button>
      )}
      <button className="chip" onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), items(['shading.']))}>
        <Icon name={vp.shading === 'lit' ? 'Sun' : vp.shading === 'clay' ? 'Brush' : 'Grid2x2'} size={13} /> {vp.shading === 'lit' ? 'Lit' : vp.shading === 'clay' ? 'Clay' : 'Wireframe'} <Icon name="ChevronDown" size={11} />
      </button>
      <button className="chip" onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), items(['view.grid', 'view.gizmos', 'view.stats']))}>
        <Icon name="Eye" size={13} /> Show <Icon name="ChevronDown" size={11} />
      </button>
      <span className="chip hide-phone">{mode.toUpperCase()}</span>
      {menu.element}
    </div>
  );
}

function StatsOverlay() {
  const runtime = useSession((s) => s.editRuntime);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  if (!runtime) return null;
  const s = runtime.stats;
  return (
    <div className="vp-stats mono">
      <div>{s.fps} fps · {s.frameMs.toFixed(1)} ms</div>
      <div>{s.drawCalls} draw calls</div>
      <div>{s.triangles.toLocaleString()} triangles</div>
      <div>{s.entities} entities</div>
    </div>
  );
}
