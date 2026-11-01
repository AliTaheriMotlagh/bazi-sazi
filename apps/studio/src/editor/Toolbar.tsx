import { useEditor } from '../store/editor';
import { Icon } from '../ui/Icon';
import { useMenu } from '../ui/primitives';
import { ACTIONS, actionById, formatKeys, togglePlay } from './actions';
import { toMenuItem } from './MenuBar';
import { editorHost, session } from './session';

function Tool({ id, compact }: { id: string; compact?: boolean }) {
  const a = actionById(id)!;
  // Subscribe to the state checked()/enabled() read; a primitive key keeps zustand from looping.
  useEditor((s) => `${s.tool}|${s.snap}|${s.past.length}|${s.future.length}|${s.selection.length}`);
  const active = a.checked?.() ?? false;
  return (
    <button className={`btn sm ${compact === false ? '' : 'icon'} ${active ? 'active' : ''}`} disabled={a.enabled ? !a.enabled() : false} onClick={a.run} title={`${a.label}${a.keys ? ` (${formatKeys(a.keys[0])})` : ''}`} aria-label={a.label} aria-pressed={a.checked ? active : undefined}>
      <Icon name={a.icon ?? 'Square'} size={15} />
    </button>
  );
}

/** Main toolbar (Unreal's level-editor toolbar): save, history, transform tools, play controls, add, publish. */
export function Toolbar({ onToggleLeft, onToggleRight, published }: { onToggleLeft(): void; onToggleRight(): void; published: boolean }) {
  const playState = useEditor((s) => s.playState);
  const device = useEditor((s) => s.device);
  const playing = playState !== 'edit';
  const menu = useMenu();
  const deviceIcon = device === 'free' ? 'Maximize' : device === 'desktop' ? 'Monitor' : device === 'tablet' ? 'Tablet' : 'Smartphone';
  return (
    <header className="toolbar" role="toolbar" aria-label="Editor toolbar">
      <button className="btn ghost icon show-tablet hide-phone" onClick={onToggleLeft} aria-label="Toggle outliner and place panel">
        <Icon name="Layers" />
      </button>
      <button className="btn ghost icon show-phone" onClick={actionById('window.palette')!.run} aria-label="All commands">
        <Icon name="Menu" />
      </button>
      <div className="group">
        <span className="hide-phone"><Tool id="file.save" /></span>
        <Tool id="edit.undo" />
        <Tool id="edit.redo" />
      </div>
      <div className="group">
        <Tool id="tool.move" />
        <Tool id="tool.rotate" />
        <Tool id="tool.scale" />
        <span className="hide-phone"><Tool id="tool.snap" /></span>
      </div>
      <button
        className="btn sm hide-phone"
        onClick={(e) =>
          menu.open(
            e.currentTarget.getBoundingClientRect(),
            ACTIONS.filter((a) => a.group === 'Create' && (!a.enabled || a.enabled())).map(toMenuItem),
            true,
          )
        }
      >
        <Icon name="Plus" size={15} /> Add <Icon name="ChevronDown" size={12} />
      </button>
      <span className="spacer" />
      <div className="group play-group">
        <button className={`btn sm play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay} title={`${playing ? 'Stop' : 'Play'} (${formatKeys('Mod+P')})`}>
          <Icon name={playing ? 'Square' : 'Play'} size={15} /> <span className="hide-phone">{playing ? 'Stop' : 'Play'}</span>
        </button>
        <button className={`btn sm icon ${playState === 'paused' ? 'active' : ''}`} disabled={!playing} onClick={actionById('build.pause')!.run} title="Pause" aria-label="Pause">
          <Icon name="Pause" size={15} />
        </button>
        <button className="btn sm icon hide-phone" disabled={playState !== 'paused'} onClick={() => session().playRuntime?.step()} title="Step one frame" aria-label="Step one frame">
          <Icon name="StepForward" size={15} />
        </button>
        <button
          className="btn sm icon hide-phone"
          title="Preview device"
          aria-label="Preview device"
          onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), ACTIONS.filter((a) => a.id.startsWith('device.') || a.id === 'build.colliders').map(toMenuItem))}
        >
          <Icon name={deviceIcon} size={15} />
        </button>
      </div>
      <span className="spacer" />
      <button className="btn sm ghost hide-phone" onClick={actionById('window.palette')!.run} title={`Command palette (${formatKeys('Mod+K')})`}>
        <Icon name="Search" size={14} /> <span className="kbd">{formatKeys('Mod+K')}</span>
      </button>
      <button className="btn sm hide-phone" onClick={actionById('window.ai')!.run} title="AI assistant">
        <Icon name="Sparkles" size={14} /> AI
      </button>
      <button className="btn sm primary" onClick={() => editorHost.openPublish()} title="Publish & share">
        <Icon name="Rocket" size={14} /> <span className="hide-phone">{published ? 'Update' : 'Publish'}</span>
      </button>
      <button className="btn ghost icon show-tablet hide-phone" onClick={onToggleRight} aria-label="Toggle details">
        <Icon name="SlidersHorizontal" />
      </button>
      {menu.element}
    </header>
  );
}
