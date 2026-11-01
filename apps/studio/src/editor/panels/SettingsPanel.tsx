import { DEFAULT_INPUT, type Vec3 } from '@bazi/engine';
import { useState } from 'react';
import { updateScene, updateSettings } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { Icon } from '../../ui/Icon';
import { NumberInput, Switch } from '../../ui/primitives';
import { ColorInput, Vec3Input } from './Fields';

function Section({ title, icon, children, open: initial = true }: { title: string; icon: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="section">
      <div className="section-title" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} className="faint" />
        <span className="icon-box"><Icon name={icon} size={13} /></span>
        {title}
      </div>
      {open && <div className="section-content">{children}</div>}
    </div>
  );
}

const Row = ({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) => (
  <div className="prop">
    <span className="prop-label" title={help ?? label}>{label}</span>
    {children}
    {help && <span className="prop-help">{help}</span>}
  </div>
);

function InputMapEditor() {
  const input = useEditor((s) => s.project!.settings.input);
  const [listening, setListening] = useState<string | null>(null);
  const bind = (action: string) => {
    setListening(action);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      cleanup();
      if (e.code !== 'Escape') updateSettings((s) => void (s.input[action] = [...new Set([...(s.input[action] ?? []), e.code])]), 'Bind key');
    };
    const onMouse = (e: MouseEvent) => {
      cleanup();
      updateSettings((s) => void (s.input[action] = [...new Set([...(s.input[action] ?? []), `Mouse${e.button}`])]), 'Bind mouse');
    };
    const cleanup = () => {
      setListening(null);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
    window.addEventListener('keydown', onKey, true);
    setTimeout(() => window.addEventListener('mousedown', onMouse, true), 50);
  };
  return (
    <>
      {Object.entries(input).map(([action, codes]) => (
        <div key={action} className="col" style={{ gap: 4, paddingBottom: 6, borderBottom: '1px dashed var(--border)' }}>
          <div className="row">
            <b style={{ fontSize: 12.5 }}>{action}</b>
            <span className="spacer" />
            <button className="btn sm" onClick={() => bind(action)}>{listening === action ? 'Press a key…' : '+ Key'}</button>
            {!(action in DEFAULT_INPUT) && (
              <button className="btn sm ghost icon" aria-label={`Remove ${action}`} onClick={() => updateSettings((s) => void delete s.input[action], 'Remove action')}>
                <Icon name="Trash" size={13} />
              </button>
            )}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {codes.map((c) => (
              <span key={c} className="tag-chip">
                {c}
                <button onClick={() => updateSettings((s) => void (s.input[action] = s.input[action].filter((x) => x !== c)), 'Unbind key')} aria-label={`Unbind ${c}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      ))}
      <button
        className="btn sm"
        onClick={() => {
          const name = prompt('New action name (e.g. dash, interact)')?.trim();
          if (name) updateSettings((s) => void (s.input[name] = []), 'Add action');
        }}
      >
        <Icon name="Plus" size={13} /> Add action
      </button>
    </>
  );
}

export function SettingsPanel() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor((s) => s.project!.scenes.find((x) => x.id === s.sceneId));
  const s = project.settings;
  const g = s.graphics;
  return (
    <div className="inspector">
      <Section title="Game" icon="Gamepad2">
        <Row label="Name">
          <input className="input" value={project.name} onChange={(e) => editor().apply('Rename project', (d) => void (d.name = e.target.value), 'project-name')} />
        </Row>
        <div className="prop stack">
          <span className="prop-label">Description</span>
          <textarea className="textarea" value={project.description} onChange={(e) => editor().apply('Edit description', (d) => void (d.description = e.target.value), 'project-desc')} />
        </div>
        <Row label="Mode" help="Changing mode keeps your objects but switches cameras and physics.">
          <select className="select" value={s.mode} onChange={(e) => updateSettings((st) => void (st.mode = e.target.value as '2d' | '3d'), 'Change mode')}>
            <option value="2d">2D</option>
            <option value="3d">3D</option>
          </select>
        </Row>
        <Row label="Start scene">
          <select className="select" value={s.startScene} onChange={(e) => updateSettings((st) => void (st.startScene = e.target.value), 'Start scene')}>
            {project.scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
        </Row>
        <Row label="Background"><ColorInput value={s.background} onChange={(v) => updateSettings((st) => void (st.background = v), 'Background', 'bg')} /></Row>
        <Row label="Touch controls">
          <select className="select" value={s.touchControls} onChange={(e) => updateSettings((st) => void (st.touchControls = e.target.value as 'auto'), 'Touch controls')}>
            <option value="auto">Auto (phones & tablets)</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>
        </Row>
      </Section>

      {scene && (
        <Section title={`Scene: ${scene.name}`} icon="Clapperboard">
          <Row label="Ambient color"><ColorInput value={scene.environment.ambientColor} onChange={(v) => updateScene((sc) => void (sc.environment.ambientColor = v), 'Ambient', 'amb-c')} /></Row>
          <Row label="Ambient light"><NumberInput value={scene.environment.ambientIntensity} min={0} step={0.05} onChange={(v) => updateScene((sc) => void (sc.environment.ambientIntensity = v), 'Ambient', 'amb-i')} /></Row>
          <Row label="Fog color"><ColorInput value={scene.environment.fogColor} onChange={(v) => updateScene((sc) => void (sc.environment.fogColor = v), 'Fog', 'fog-c')} /></Row>
          <Row label="Fog density" help="0 = no fog"><NumberInput value={scene.environment.fogDensity} min={0} max={0.5} step={0.005} onChange={(v) => updateScene((sc) => void (sc.environment.fogDensity = v), 'Fog', 'fog-d')} /></Row>
        </Section>
      )}

      <Section title="Physics" icon="Atom">
        <Row label="Enabled"><Switch checked={s.physics.enabled} onChange={(v) => updateSettings((st) => void (st.physics.enabled = v), 'Physics')} /></Row>
        <Row label="Gravity"><Vec3Input value={s.gravity} onChange={(v: Vec3) => updateSettings((st) => void (st.gravity = v), 'Gravity', 'gravity')} /></Row>
        <Row label="Show colliders"><Switch checked={s.physics.debug} onChange={(v) => updateSettings((st) => void (st.physics.debug = v), 'Physics debug')} /></Row>
        <Row label="Step (Hz)"><NumberInput value={Math.round(1 / s.physics.fixedTimestep)} min={20} max={240} step={10} onChange={(v) => updateSettings((st) => void (st.physics.fixedTimestep = 1 / v), 'Physics rate')} /></Row>
      </Section>

      <Section title="Graphics" icon="Sparkles" open={false}>
        <Row label="Shadows"><Switch checked={g.shadows} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, shadows: v }), 'Shadows')} /></Row>
        <Row label="Glow (bloom)"><Switch checked={g.bloom} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, bloom: v }), 'Bloom')} /></Row>
        {g.bloom && <Row label="Glow strength"><NumberInput value={g.bloomStrength} min={0} max={3} step={0.05} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, bloomStrength: v }), 'Bloom', 'bloom-s')} /></Row>}
        <Row label="Filmic colors"><Switch checked={g.toneMapping} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, toneMapping: v }), 'Tone mapping')} /></Row>
        <Row label="Anti-aliasing"><Switch checked={g.antialias} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, antialias: v }), 'Antialias')} /></Row>
        <Row label="Pixel art" help="Crisp, unfiltered textures"><Switch checked={g.pixelArt} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, pixelArt: v }), 'Pixel art')} /></Row>
        <Row label="Max resolution" help="Lower = faster on phones"><NumberInput value={g.maxPixelRatio} min={0.5} max={3} step={0.25} onChange={(v) => updateSettings((st) => void (st.graphics = { ...st.graphics, maxPixelRatio: v }), 'Resolution', 'dpr')} /></Row>
      </Section>

      <Section title="Multiplayer" icon="Users" open={s.multiplayer.enabled}>
        <Row label="Online multiplayer"><Switch checked={s.multiplayer.enabled} onChange={(v) => updateSettings((st) => void (st.multiplayer.enabled = v), 'Multiplayer')} /></Row>
        {s.multiplayer.enabled && (
          <>
            <Row label="Player prefab" help="Spawned for each player. Give it Network Sync.">
              <select className="select" value={s.multiplayer.playerPrefab} onChange={(e) => updateSettings((st) => void (st.multiplayer.playerPrefab = e.target.value), 'Player prefab')}>
                <option value="">(none)</option>
                {project.prefabs.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </Row>
            <Row label="Max players"><NumberInput value={s.multiplayer.maxPlayers} min={2} max={64} step={1} onChange={(v) => updateSettings((st) => void (st.multiplayer.maxPlayers = Math.round(v)), 'Max players')} /></Row>
            <Row label="Sync rate (Hz)"><NumberInput value={s.multiplayer.tickRate} min={5} max={60} step={1} onChange={(v) => updateSettings((st) => void (st.multiplayer.tickRate = Math.round(v)), 'Tick rate')} /></Row>
            <div className="faint" style={{ fontSize: 12 }}>Tip: press Play in two browser tabs to test with yourself. Entities tagged “spawn” are used as spawn points.</div>
          </>
        )}
      </Section>

      <Section title="VR / XR" icon="Glasses" open={false}>
        <Row label="WebXR (VR)" help="Shows “Enter VR” on headsets like Quest"><Switch checked={s.xr.enabled} onChange={(v) => updateSettings((st) => void (st.xr.enabled = v), 'XR')} /></Row>
      </Section>

      <Section title="Input actions" icon="Gamepad2" open={false}>
        <div className="faint" style={{ fontSize: 12 }}>Actions work with keyboard, mouse, gamepads, touch and VR controllers. Use them in scripts: <code>input.pressed('jump')</code>.</div>
        <InputMapEditor />
      </Section>
    </div>
  );
}
