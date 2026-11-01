import { Runtime, type ProjectData } from '@bazi/engine';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import './styles.css';

/**
 * Published-game player. The game is chosen by, in order:
 *   ?game=<slug>   /embed/<slug>   <slug>.<base-domain>
 * Runs on the game's own origin (subdomain) or inside a sandboxed iframe, so
 * user scripts can never touch the studio's session.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const veil = $('veil');
const title = $('title');
const subtitle = $('subtitle');
const startBtn = $<HTMLButtonElement>('start');
const spinner = $('spinner');

function resolveSlug(): string | null {
  const params = new URLSearchParams(location.search);
  if (params.get('game')) return params.get('game');
  const m = location.pathname.match(/^\/embed\/([a-z0-9-]+)/);
  if (m) return m[1];
  const parts = location.hostname.split('.');
  if (parts.length >= 2 && parts[0] !== 'www') return parts[0];
  return null;
}

function fail(message: string): void {
  spinner.hidden = true;
  title.textContent = 'Could not load the game';
  subtitle.textContent = message;
}

function playerName(): string {
  try {
    const saved = localStorage.getItem('bz.playerName');
    if (saved) return saved;
    const name = `Player${Math.floor(Math.random() * 9000 + 1000)}`;
    localStorage.setItem('bz.playerName', name);
    return name;
  } catch {
    return 'Player';
  }
}

function addButtons(runtime: Runtime, project: ProjectData): void {
  const bar = document.createElement('div');
  bar.className = 'player-buttons';
  const mk = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const mute = mk('🔊', 'Mute', () => {
    runtime.audio.muted = !runtime.audio.muted;
    mute.textContent = runtime.audio.muted ? '🔇' : '🔊';
  });
  if (document.fullscreenEnabled) mk('⛶', 'Fullscreen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  document.body.appendChild(bar);
  if (project.settings.xr.enabled && 'xr' in navigator) {
    const vr = VRButton.createButton(runtime.renderer);
    vr.style.zIndex = '31';
    document.body.appendChild(vr);
  }
}

async function main(): Promise<void> {
  const slug = resolveSlug();
  if (!slug) return fail('No game was specified.');
  let project: ProjectData;
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(slug)}/data`);
    if (!res.ok) return fail(res.status === 404 ? 'This game does not exist (yet).' : `Server error (${res.status}).`);
    project = (await res.json()) as ProjectData;
  } catch {
    return fail('Network error — check your connection.');
  }
  document.title = project.name;
  title.textContent = project.name;
  subtitle.textContent = project.description || (project.settings.multiplayer.enabled ? 'Online multiplayer game' : '');

  const params = new URLSearchParams(location.search);
  const room = (params.get('room') ?? 'public').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'public';
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const canvas = $<HTMLCanvasElement>('canvas');
  let runtime: Runtime;
  try {
    runtime = await Runtime.create({
      canvas,
      overlay: $('game'),
      project,
      mode: 'play',
      network: project.settings.multiplayer.enabled ? { url: `${wsProto}//${location.host}/ws/play?game=${encodeURIComponent(slug)}&room=${room}`, name: playerName() } : null,
    });
  } catch (err) {
    return fail(`This device could not start the game: ${(err as Error).message}`);
  }
  addButtons(runtime, project);
  spinner.hidden = true;
  startBtn.hidden = false;
  startBtn.focus();
  // A click is required anyway for audio + pointer lock, so make it the start button.
  startBtn.onclick = () => {
    veil.classList.add('hidden');
    runtime.audio.resume();
    runtime.start();
    void fetch(`/api/games/${encodeURIComponent(slug)}/play`, { method: 'POST' }).catch(() => undefined);
  };
}

void main();
