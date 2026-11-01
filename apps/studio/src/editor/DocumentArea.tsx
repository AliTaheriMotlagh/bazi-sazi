import { Suspense, lazy } from 'react';
import { editor, useEditor, type DocKey } from '../store/editor';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/primitives';
import { GameView } from './viewport/GameView';
import { SceneView } from './viewport/SceneView';

// Heavy editors load on first use.
const ScriptEditor = lazy(() => import('./panels/ScriptEditor'));
const LogicEditor = lazy(() => import('./panels/LogicEditor'));
const AnimationEditor = lazy(() => import('./panels/AnimationEditor'));

function useDocInfo(key: DocKey): { label: string; icon: string } {
  // Select a primitive so the tab only re-renders when its own title changes.
  const label = useEditor((s) => {
    if (key === 'scene') return s.project?.scenes.find((x) => x.id === s.sceneId)?.name ?? 'Scene';
    if (key === 'game') return 'Game';
    const id = key.slice(key.indexOf(':') + 1);
    const name = key.startsWith('script:') ? s.project?.scripts.find((x) => x.id === id)?.name : key.startsWith('anim:') ? s.project?.animators?.find((x) => x.id === id)?.name : s.project?.graphs.find((x) => x.id === id)?.name;
    return name ?? '(deleted)';
  });
  const icon = key === 'scene' ? 'Clapperboard' : key === 'game' ? 'Gamepad2' : key.startsWith('script:') ? 'FileCode' : key.startsWith('anim:') ? 'Clapperboard' : 'Workflow';
  return { label, icon };
}

function Tab({ k }: { k: DocKey }) {
  const active = useEditor((s) => s.activeDoc === k);
  const playing = useEditor((s) => s.playState !== 'edit');
  const { label, icon } = useDocInfo(k);
  return (
    <div className={`doc-tab ${active ? 'active' : ''} ${k === 'game' ? 'game' : ''}`} role="tab" aria-selected={active} onClick={() => editor().set({ activeDoc: k })} onAuxClick={(e) => e.button === 1 && editor().closeDoc(k)}>
      <Icon name={icon} size={13} />
      <span className="truncate">{label}</span>
      {k === 'game' && playing && <span className="live-dot" />}
      {k !== 'scene' && k !== 'game' && (
        <button className="doc-close" aria-label={`Close ${label}`} onClick={(e) => (e.stopPropagation(), editor().closeDoc(k))}>
          <Icon name="X" size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * The center of the editor: document tabs for the scene, the running game,
 * scripts and visual graphs. The scene view stays mounted so the camera and
 * renderer survive tab switches.
 */
export function DocumentArea() {
  const docs = useEditor((s) => s.docs);
  const active = useEditor((s) => s.activeDoc);
  const playing = useEditor((s) => s.playState !== 'edit');
  return (
    <div className="docs">
      <div className="doc-tabs" role="tablist">
        {docs.map((k) => (
          <Tab key={k} k={k} />
        ))}
      </div>
      <div className="doc-body">
        <div className="doc-pane" hidden={active !== 'scene'}>
          <SceneView />
        </div>
        {playing && (
          <div className="doc-pane" hidden={active !== 'game'}>
            <GameView />
          </div>
        )}
        <Suspense fallback={<div className="empty"><Spinner /></div>}>
          {docs
            .filter((k) => k.startsWith('script:') || k.startsWith('graph:') || k.startsWith('anim:'))
            .map((k) => (
              <div key={k} className="doc-pane" hidden={active !== k}>
                {k.startsWith('script:') ? <ScriptEditor id={k.slice(7)} /> : k.startsWith('anim:') ? <AnimationEditor id={k.slice(5)} /> : <LogicEditor id={k.slice(6)} />}
              </div>
            ))}
        </Suspense>
      </div>
    </div>
  );
}
