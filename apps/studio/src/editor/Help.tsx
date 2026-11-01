import type { ProjectData } from '@bazi/engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { editor, useEditor, type EditorState } from '../store/editor';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/primitives';
import { ACTIONS, actionById, formatKeys, type ActionGroup } from './actions';

// ═══════════════════════════════════════ Interactive tutorial

interface Baseline {
  entities: number;
  history: number;
  scripts: number;
  samples: number;
  played: boolean;
}

interface Step {
  title: string;
  body: string;
  /** CSS selector of the UI to highlight. */
  target?: string;
  /** Optional "do it for me" helper. */
  assist?: { label: string; run(): void };
  done(s: EditorState, base: Baseline, published: boolean): boolean;
}

const sceneEntities = (s: EditorState) => s.project?.scenes.find((x) => x.id === s.sceneId)?.entities ?? [];
const sampleCount = (p: ProjectData | null) => p?.assets.filter((a) => a.url.startsWith('/samples/')).length ?? 0;

const STEPS: Step[] = [
  {
    title: 'Place something',
    body: 'The Place panel on the left holds ready-made objects. Click one (or drag it into the scene).',
    target: '.place',
    done: (s, b) => sceneEntities(s).length > b.entities,
  },
  {
    title: 'Move it',
    body: 'With the object selected, drag the colored arrows of the Move tool (W). Or type a new Position in Details on the right.',
    target: '.scene-canvas',
    assist: { label: 'Select move tool', run: () => editor().set({ tool: 'translate' }) },
    done: (s, b) => s.past.slice(b.history).some((h) => /Transform|position/i.test(h.label)),
  },
  {
    title: 'Give it physics',
    body: 'In Details, press “Add component” and add a Rigid Body — it will fall and collide (a Collider is needed too).',
    target: '.details-add',
    done: (s) => sceneEntities(s).some((e) => e.components.some((c) => c.type === 'RigidBody') && e.components.some((c) => c.type === 'Collider')),
  },
  {
    title: 'Press Play',
    body: 'Play runs a copy of your game in the Game tab. Nothing you do while playing changes your project.',
    target: '.play-btn',
    assist: { label: 'Play now', run: () => actionById('build.play')!.run() },
    done: (s, b) => b.played || s.playState !== 'edit',
  },
  {
    title: 'Use Starter Content',
    body: 'Open the Content Browser (bottom) → Starter Content → 3D Models, and drag a knight or a tower into the scene.',
    target: '.cb-tree',
    assist: { label: 'Open content', run: () => actionById('window.content')!.run() },
    done: (s, b) => sampleCount(s.project) > b.samples,
  },
  {
    title: 'Add some logic',
    body: 'Create a Visual Script (no code) or a Script (JavaScript) from the Add menu. They open as tabs in the middle.',
    target: '.toolbar',
    assist: { label: 'New visual script', run: () => actionById('create.graph')!.run() },
    done: (s, b) => (s.project?.scripts.length ?? 0) + (s.project?.graphs.length ?? 0) > b.scripts,
  },
  {
    title: 'Publish & share',
    body: 'Publish gives your game its own web address. Anyone can play it on a phone, tablet, PC or VR headset.',
    target: '.toolbar .btn.primary',
    assist: { label: 'Open publish', run: () => actionById('build.publish')!.run() },
    done: (_s, _b, published) => published,
  },
];

export function Tutorial({ published }: { published: boolean }) {
  const open = useEditor((s) => s.tutorialOpen);
  const state = useEditor((s) => s);
  const [index, setIndex] = useState(0);
  const base = useRef<Baseline | null>(null);
  if (open && !base.current) {
    base.current = { entities: sceneEntities(state).length, history: state.past.length, scripts: state.project!.scripts.length + state.project!.graphs.length, samples: sampleCount(state.project), played: false };
  }
  if (!open && base.current) base.current = null;
  if (base.current && state.playState !== 'edit') base.current.played = true;

  const step = STEPS[index];
  const complete = !!(open && base.current && step && step.done(state, base.current, published));

  // Auto-advance shortly after a step is completed.
  useEffect(() => {
    if (!complete) return;
    const t = setTimeout(() => setIndex((i) => Math.min(STEPS.length, i + 1)), 900);
    return () => clearTimeout(t);
  }, [complete]);

  // Pulse the UI the step talks about.
  useEffect(() => {
    if (!open || !step?.target) return;
    const el = document.querySelector(step.target);
    el?.classList.add('tour-target');
    return () => el?.classList.remove('tour-target');
  }, [open, step]);

  if (!open) return null;
  const close = () => {
    editor().set({ tutorialOpen: false });
    setIndex(0);
  };
  if (!step)
    return (
      <div className="tour" role="dialog" aria-label="Tutorial">
        <div className="tour-head"><Icon name="GraduationCap" size={16} /> <b className="grow">You did it! 🎉</b><button className="btn sm ghost icon" onClick={close} aria-label="Close"><Icon name="X" size={14} /></button></div>
        <p>You placed, moved and simulated objects, played your game, used starter content, added logic and published. Next: try a strategy template, or ask the AI to build something big.</p>
        <button className="btn primary" onClick={close}>Finish</button>
      </div>
    );
  return (
    <div className="tour" role="dialog" aria-label="Tutorial">
      <div className="tour-head">
        <Icon name="GraduationCap" size={16} />
        <b className="grow">Step {index + 1} of {STEPS.length}</b>
        <button className="btn sm ghost icon" onClick={close} aria-label="Close tutorial"><Icon name="X" size={14} /></button>
      </div>
      <div className="tour-progress"><i style={{ width: `${(index / STEPS.length) * 100}%` }} /></div>
      <h3>{complete ? '✓ ' : ''}{step.title}</h3>
      <p>{step.body}</p>
      <div className="row">
        {step.assist && <button className="btn sm" onClick={step.assist.run}>{step.assist.label}</button>}
        <span className="spacer" />
        {index > 0 && <button className="btn sm ghost" onClick={() => setIndex(index - 1)}>Back</button>}
        <button className="btn sm primary" onClick={() => setIndex(index + 1)}>{complete ? 'Next' : 'Skip'}</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ Welcome dialog

const TIPS: [string, string, string][] = [
  ['Plus', 'Place', 'Click or drag objects from the Place panel (left) into the scene.'],
  ['Library', 'Starter Content', '50+ free models, sprites, sounds, music and videos in the Content Browser.'],
  ['SlidersHorizontal', 'Details', 'Select anything to edit it on the right — every setting has a hint.'],
  ['Workflow', 'Logic without code', 'Visual scripts connect events to actions. Or write JavaScript/TypeScript.'],
  ['Sparkles', 'AI assistant', 'Describe what you want; the AI builds it with undoable steps.'],
  ['Command', 'Command palette', `${formatKeys('Mod+K')} finds any command, object, script or scene.`],
];

export function WelcomeDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Welcome to Bazi-Sazi Studio" icon="Sparkles" onClose={onClose} wide soft footer={
      <>
        <a className="btn" href="/learn" target="_blank" rel="noopener"><Icon name="BookOpen" size={14} /> Step-by-step guides</a>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Explore on my own</button>
        <button className="btn primary" onClick={() => (onClose(), editor().set({ tutorialOpen: true }))}><Icon name="GraduationCap" size={14} /> Start the 3-minute tutorial</button>
      </>
    }>
      <div className="welcome-grid">
        {TIPS.map(([icon, title, body]) => (
          <div key={title} className="welcome-tip">
            <span className="welcome-icon"><Icon name={icon} size={18} /></span>
            <div>
              <b>{title}</b>
              <p>{body}</p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════ Keyboard shortcuts

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  const groups = useMemo(() => {
    const map = new Map<ActionGroup, typeof ACTIONS>();
    for (const a of ACTIONS.filter((x) => x.keys?.length)) map.set(a.group, [...(map.get(a.group) ?? []), a]);
    return [...map];
  }, []);
  return (
    <Modal title="Keyboard shortcuts" icon="Keyboard" onClose={onClose} wide>
      <div className="shortcuts">
        {groups.map(([group, list]) => (
          <section key={group}>
            <h4>{group}</h4>
            {list.map((a) => (
              <div key={a.id} className="shortcut-row">
                <span className="grow">{a.label.replace(/^.* › /, '')}</span>
                {a.keys!.map((k) => <span key={k} className="kbd">{formatKeys(k)}</span>)}
              </div>
            ))}
          </section>
        ))}
        <section>
          <h4>Viewport</h4>
          {[['Orbit', 'Left drag'], ['Pan', 'Middle drag'], ['Fly', 'Hold right mouse + WASD / Q E'], ['Fly faster', 'Shift / wheel while flying'], ['Zoom', 'Wheel'], ['Multi-select', 'Shift + click']].map(([l, k]) => (
            <div key={l} className="shortcut-row"><span className="grow">{l}</span><span className="kbd">{k}</span></div>
          ))}
        </section>
      </div>
    </Modal>
  );
}
