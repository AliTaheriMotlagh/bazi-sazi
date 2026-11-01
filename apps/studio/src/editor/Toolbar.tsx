import { Link } from 'react-router-dom';
import { editor, useEditor, type GizmoTool } from '../store/editor';
import { useUi } from '../store/ui';
import { Icon } from '../ui/Icon';
import { useSession } from './session';

const TOOLS: [GizmoTool, string, string][] = [
  ['translate', 'Move3d', 'Move (W)'],
  ['rotate', 'Rotate3d', 'Rotate (E)'],
  ['scale', 'Scale3d', 'Scale (R)'],
];

export function togglePlay(): void {
  const { playState, set } = editor();
  set({ playState: playState === 'edit' ? 'playing' : 'edit' });
}

export function Toolbar({ onSave, onPublish, onToggleLeft, onToggleRight, published }: { onSave(): void; onPublish(): void; onToggleLeft(): void; onToggleRight(): void; published: boolean }) {
  const name = useEditor((s) => s.project?.name ?? '');
  const saveState = useEditor((s) => s.saveState);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const playState = useEditor((s) => s.playState);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const { theme, setTheme } = useUi();
  const playing = playState !== 'edit';
  const step = () => {
    useSession.getState().playRuntime?.step();
  };

  return (
    <header className="toolbar">
      <Link to="/" className="btn ghost icon" title="Back to projects" aria-label="Back to projects">
        <Icon name="ArrowLeft" />
      </Link>
      <button className="btn ghost icon show-tablet" onClick={onToggleLeft} aria-label="Toggle hierarchy and assets">
        <Icon name="Layers" />
      </button>
      <span className={`save-dot ${saveState}`} title={saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Unsaved changes'} />
      <span className="title truncate hide-phone">{name}</span>
      <div className="group hide-phone">
        <button className="btn sm icon" disabled={!canUndo} onClick={() => editor().undo()} title={`Undo ${undoLabel ?? ''} (Ctrl+Z)`} aria-label="Undo"><Icon name="Undo2" size={15} /></button>
        <button className="btn sm icon" disabled={!canRedo} onClick={() => editor().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="Redo2" size={15} /></button>
      </div>
      <div className="group">
        {TOOLS.map(([id, icon, label]) => (
          <button key={id} className={`btn sm icon ${tool === id ? 'active' : ''}`} onClick={() => editor().set({ tool: id })} title={label} aria-label={label} aria-pressed={tool === id}>
            <Icon name={icon} size={15} />
          </button>
        ))}
        <button className={`btn sm icon ${snap ? 'active' : ''}`} onClick={() => editor().set({ snap: !snap })} title="Snap to grid" aria-label="Snap" aria-pressed={snap}>
          <Icon name="Magnet" size={15} />
        </button>
      </div>
      <span className="spacer" />
      <div className="group">
        <button className={`btn sm play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay} title={playing ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)'}>
          <Icon name={playing ? 'Square' : 'Play'} size={15} /> <span className="hide-phone">{playing ? 'Stop' : 'Play'}</span>
        </button>
        {playing && (
          <>
            <button className={`btn sm icon ${playState === 'paused' ? 'active' : ''}`} onClick={() => editor().set({ playState: playState === 'paused' ? 'playing' : 'paused' })} title="Pause" aria-label="Pause"><Icon name="Pause" size={15} /></button>
            <button className="btn sm icon" disabled={playState !== 'paused'} onClick={step} title="Step one frame" aria-label="Step"><Icon name="StepForward" size={15} /></button>
          </>
        )}
      </div>
      <span className="spacer" />
      <button className="btn ghost icon hide-phone" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'SunMedium' : 'Moon'} /></button>
      <button className="btn icon hide-phone" onClick={onSave} title="Save (Ctrl+S)" aria-label="Save"><Icon name="Save" size={15} /></button>
      <button className="btn primary" onClick={onPublish} title="Publish & share">
        <Icon name="Rocket" size={15} /> <span className="hide-phone">{published ? 'Update' : 'Publish'}</span>
      </button>
      <button className="btn ghost icon show-tablet hide-phone" onClick={onToggleRight} aria-label="Toggle inspector">
        <Icon name="SlidersHorizontal" />
      </button>
    </header>
  );
}
