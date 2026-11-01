import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useConsole } from '../store/console';
import { editor, useEditor } from '../store/editor';
import { Icon } from '../ui/Icon';
import { formatKeys } from './actions';
import { useProblems } from './panels/DebugPanels';
import { useSession } from './session';

/** Bottom status bar: save state, problems, live stats, deployment info. */
export function StatusBar() {
  const saveState = useEditor((s) => s.saveState);
  const entities = useEditor((s) => s.project?.scenes.find((x) => x.id === s.sceneId)?.entities.length ?? 0);
  const mode = useEditor((s) => s.project?.settings.mode ?? '3d');
  const scene = useEditor((s) => s.project?.scenes.find((x) => x.id === s.sceneId)?.name);
  const selection = useEditor((s) => s.selection.length);
  const runtime = useSession((s) => s.playRuntime ?? s.editRuntime);
  const errors = useConsole((s) => s.errors);
  const problems = useProblems();
  const problemErrors = problems.filter((p) => p.severity === 'error').length;
  const [fps, setFps] = useState(0);
  const [cfg, setCfg] = useState<{ realtime: string; ephemeral?: boolean } | null>(null);
  useEffect(() => {
    const t = setInterval(() => setFps(runtime?.stats.fps ?? 0), 500);
    return () => clearInterval(t);
  }, [runtime]);
  useEffect(() => {
    api.config().then(setCfg).catch(() => undefined);
  }, []);
  const label = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' }[saveState];
  return (
    <footer className="statusbar">
      <span className="status-item"><span className={`save-dot ${saveState}`} /> {label}</span>
      <button className="status-item" onClick={() => editor().set({ bottomTab: 'problems' })} title="Open message log">
        <Icon name="CircleAlert" size={12} style={{ color: problemErrors ? 'var(--danger)' : undefined }} /> {problemErrors}
        <Icon name="TriangleAlert" size={12} style={{ color: problems.length - problemErrors ? 'var(--warning)' : undefined }} /> {problems.length - problemErrors}
      </button>
      {errors > 0 && (
        <button className="status-item danger" onClick={() => editor().set({ bottomTab: 'console' })}>
          <Icon name="Terminal" size={12} /> {errors} runtime error{errors > 1 ? 's' : ''}
        </button>
      )}
      <span className="status-item hide-phone"><Icon name="Clapperboard" size={12} /> {scene}</span>
      <span className="status-item hide-phone"><Icon name="Boxes" size={12} /> {entities} entities{selection ? ` · ${selection} selected` : ''}</span>
      <span className="spacer" />
      {cfg?.ephemeral && <span className="status-item warn" title="Connect a Turso database to keep data">Demo storage — data is temporary</span>}
      {cfg && <span className="status-item hide-phone" title="Multiplayer transport"><Icon name={cfg.realtime === 'p2p' ? 'Radio' : 'Wifi'} size={12} /> {cfg.realtime === 'p2p' ? 'P2P multiplayer' : 'Server multiplayer'}</span>}
      <span className="status-item hide-phone">{mode.toUpperCase()}</span>
      <span className="status-item"><Icon name="Activity" size={12} /> {fps} fps</span>
      <span className="status-item hide-phone faint">{formatKeys('Mod+K')} commands</span>
    </footer>
  );
}
