import { Runtime } from '@bazi/engine';
import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../../api/client';
import { useAuth } from '../../store/auth';
import { logToConsole, useConsole } from '../../store/console';
import { editor, useEditor } from '../../store/editor';
import { Icon } from '../../ui/Icon';
import { Spinner } from '../../ui/primitives';
import { useSession } from '../session';

/**
 * Play mode: runs a deep copy of the project, so nothing that happens while
 * playing can corrupt the edited data (same as Unity/Godot play mode).
 */
export function GameView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [fps, setFps] = useState(0);
  const paused = useEditor((s) => s.playState === 'paused');
  const physicsDebug = useSession((s) => s.physicsDebug);
  const timeScale = useSession((s) => s.timeScale);

  useEffect(() => {
    let runtime: Runtime | null = null;
    let disposed = false;
    const { project, sceneId, projectId } = editor();
    if (!project || !canvas.current) return;
    useConsole.getState().clear();
    logToConsole({ level: 'info', message: `▶ Playing "${project.scenes.find((s) => s.id === sceneId)?.name}"`, source: 'Editor' });
    const user = useAuth.getState().user;
    void Runtime.create({
      canvas: canvas.current,
      overlay: overlay.current!,
      project: structuredClone(project),
      mode: 'play',
      sceneId,
      logger: logToConsole,
      network: project.settings.multiplayer.enabled ? { url: wsUrl(`test:${projectId}`), name: user?.username ?? 'Tester' } : null,
    })
      .then((rt) => {
        if (disposed) return rt.dispose();
        runtime = rt;
        rt.physicsDebug = useSession.getState().physicsDebug;
        rt.start();
        canvas.current?.focus();
        useSession.getState().set({ playRuntime: rt });
        setLoading(false);
      })
      .catch((err) => {
        logToConsole({ level: 'error', message: `Could not start the game: ${(err as Error).message}`, source: 'Editor' });
        editor().set({ playState: 'edit' });
      });
    const fpsTimer = setInterval(() => runtime && setFps(runtime.stats.fps), 500);
    return () => {
      disposed = true;
      clearInterval(fpsTimer);
      runtime?.dispose();
      useSession.getState().set({ playRuntime: null });
      logToConsole({ level: 'info', message: '■ Stopped', source: 'Editor' });
    };
  }, []);

  const runtime = useSession((s) => s.playRuntime);
  useEffect(() => {
    runtime?.setPaused(paused);
  }, [runtime, paused]);
  useEffect(() => {
    if (runtime) runtime.physicsDebug = physicsDebug;
  }, [runtime, physicsDebug]);
  useEffect(() => {
    if (runtime) runtime.time.scale = timeScale;
  }, [runtime, timeScale]);

  return (
    <div className="viewport">
      <canvas ref={canvas} tabIndex={0} aria-label="Game view" />
      <div ref={overlay} className="game-overlay" />
      <div className="viewport-overlay bottom" style={{ zIndex: 8 }}>
        <span className="chip" style={{ background: 'rgba(52, 211, 153, .85)', color: '#052e1f' }}>
          <Icon name={paused ? 'Pause' : 'Play'} size={13} /> {paused ? 'Paused' : 'Playing'}
        </span>
        <span className="chip">{fps} FPS</span>
        {timeScale !== 1 && <span className="chip">{timeScale}× speed</span>}
      </div>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', background: '#0008' }}>
          <div className="row"><Spinner /> Starting game…</div>
        </div>
      )}
    </div>
  );
}
