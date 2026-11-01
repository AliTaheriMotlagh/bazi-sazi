import { normalizeProject, Runtime, type ProjectData } from '@bazi/engine';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

/**
 * Entry of the exported, self-contained player (built by scripts/build-standalone.mjs).
 * Reads the project from window.__BAZI_PROJECT__ or the inline JSON block and
 * runs it with no server: multiplayer and online features are off.
 */
declare global {
  interface Window {
    __BAZI_PROJECT__?: ProjectData;
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function readProject(): ProjectData | null {
  if (window.__BAZI_PROJECT__) return window.__BAZI_PROJECT__;
  const el = document.getElementById('bazi-project');
  return el?.textContent ? (JSON.parse(el.textContent) as ProjectData) : null;
}

async function main(): Promise<void> {
  const title = $('title');
  const subtitle = $('subtitle');
  const spinner = $('spinner');
  const start = $<HTMLButtonElement>('start');
  const raw = readProject();
  if (!raw) {
    spinner.hidden = true;
    title.textContent = 'Missing game data';
    return;
  }
  const project = normalizeProject(raw);
  project.settings.multiplayer.enabled = false;
  document.title = project.name;
  title.textContent = project.name;
  subtitle.textContent = project.description;
  let runtime: Runtime;
  try {
    runtime = await Runtime.create({ canvas: $<HTMLCanvasElement>('canvas'), overlay: $('game'), project, mode: 'play', network: null });
  } catch (err) {
    spinner.hidden = true;
    title.textContent = 'This device could not start the game';
    subtitle.textContent = (err as Error).message;
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'player-buttons';
  const mute = document.createElement('button');
  mute.textContent = '🔊';
  mute.title = 'Mute';
  mute.onclick = () => {
    runtime.audio.muted = !runtime.audio.muted;
    mute.textContent = runtime.audio.muted ? '🔇' : '🔊';
  };
  bar.appendChild(mute);
  if (document.fullscreenEnabled) {
    const fs = document.createElement('button');
    fs.textContent = '⛶';
    fs.title = 'Fullscreen';
    fs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    bar.appendChild(fs);
  }
  document.body.appendChild(bar);
  if (project.settings.xr.enabled && 'xr' in navigator) {
    const vr = VRButton.createButton(runtime.renderer);
    vr.style.zIndex = '31';
    document.body.appendChild(vr);
  }
  spinner.hidden = true;
  start.hidden = false;
  start.focus();
  start.onclick = () => {
    $('veil').classList.add('hidden');
    runtime.audio.resume();
    runtime.start();
  };
}

void main();
