import { createComponent, Runtime, RAD2DEG, type Vec3 } from '@bazi/engine';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { addAsset, addEntity, instantiatePrefab, updateEntity } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { logToConsole } from '../../store/console';
import { toast } from '../../store/ui';
import { api } from '../../api/client';
import { Icon } from '../../ui/Icon';
import { useSession, viewportBridge } from '../session';

export const DRAG_MIME = 'application/x-bazi';
export interface DragPayload {
  kind: 'asset' | 'prefab' | 'script' | 'graph';
  id: string;
}

const round = (v: number, snap: boolean, step: number) => (snap ? Math.round(v / step) * step : Math.round(v * 1000) / 1000);

/** Editor scene view: an edit-mode Runtime + editor camera, grid, gizmos and picking. */
export function SceneView() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const mode = useEditor((s) => s.project?.settings.mode ?? '3d');
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const tools = useRef<{ runtime: Runtime; orbit: OrbitControls; gizmo: TransformControls; camera: THREE.Camera; box: THREE.BoxHelper } | null>(null);

  // Create the runtime once per project mode (2D/3D need different cameras).
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const { project, sceneId } = editor();
    if (!project || !canvas.current) return;
    void Runtime.create({ canvas: canvas.current, project, mode: 'edit', sceneId, logger: logToConsole }).then((runtime) => {
      if (disposed) return runtime.dispose();
      const is2d = project.settings.mode === '2d';
      const camera: THREE.Camera = is2d ? new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 2000) : new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
      camera.userData.orthoSize = 7;
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
      const box = new THREE.BoxHelper(new THREE.Object3D(), 0x7c5cff);
      box.userData.editorOnly = true;
      box.visible = false;
      runtime.scene.add(box);

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

      tools.current = { runtime, orbit, gizmo, camera, box };
      useSession.getState().set({ editRuntime: runtime });
      const onFrame = () => {
        orbit.update();
        if (box.visible) box.update();
      };
      runtime.frameHooks.add(onFrame);
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
        const offset = camera.position.clone().sub(orbit.target).normalize().multiplyScalar(size * 1.8);
        orbit.target.copy(center);
        if (is2d) camera.position.set(center.x, center.y, camera.position.z);
        else camera.position.copy(center).add(offset);
      };
      viewportBridge.dropPosition = (x, y) => {
        const r = canvas.current!.getBoundingClientRect();
        const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, camera);
        const plane = is2d ? new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (!hit) return [0, 0, 0];
        const s = editor().snap;
        return [round(hit.x, s, 0.5), round(hit.y + (is2d ? 0 : 0.5), s, 0.5), round(hit.z, s, 0.5)];
      };
      setReady(true);
      cleanup = () => {
        runtime.frameHooks.delete(onFrame);
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
      if (obj) {
        t.box.setFromObject(obj);
        t.box.visible = true;
      } else t.box.visible = false;
    };
    sync();
    return useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.sceneId !== prev.sceneId || s.selection !== prev.selection) sync();
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
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      down = null;
      if (moved || e.button !== 0) return;
      if ((t.gizmo as unknown as { axis: string | null }).axis) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const id = t.runtime.pick(ndc, t.camera, true);
      editor().select(id ? [id] : [], e.shiftKey || e.metaKey || e.ctrlKey);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, []);

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
      <canvas ref={canvas} tabIndex={0} aria-label="Scene view" />
      <div className="viewport-overlay">
        <span className="chip">
          <Icon name={mode === '2d' ? 'Square' : 'Box'} size={13} /> {mode.toUpperCase()} scene
        </span>
        <span className="spacer" />
        <span className="chip hide-phone" title="Orbit: left drag • Pan: right drag • Zoom: wheel">
          {mode === '2d' ? 'Drag to pan · Scroll to zoom' : 'Drag to orbit · Right-drag pan · Scroll zoom'}
        </span>
      </div>
      {dragOver && <div className="drop-hint">Drop to add to the scene</div>}
    </div>
  );
}

function dropNdc(e: React.DragEvent, el: HTMLCanvasElement): THREE.Vector2 {
  const r = el.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function placeAsset(assetId: string, type: string, position: Vec3, is2d: boolean): void {
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
