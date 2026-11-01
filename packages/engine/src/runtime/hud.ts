/** Screen-space DOM overlay: HUD texts, banner messages and the loading/pause veil. */
export class Hud {
  readonly root: HTMLDivElement;
  private slots = new Map<string, HTMLDivElement>();
  private banner: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'bz-hud';
    this.banner = document.createElement('div');
    this.banner.className = 'bz-banner';
    this.root.appendChild(this.banner);
    container.appendChild(this.root);
  }

  /** Create/update a text slot. */
  set(key: string, text: string, style: { anchor?: string; fontSize?: number; color?: string } = {}): void {
    let el = this.slots.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'bz-hud-text';
      this.root.appendChild(el);
      this.slots.set(key, el);
    }
    el.dataset.anchor = style.anchor ?? el.dataset.anchor ?? 'top-left';
    if (style.fontSize) el.style.fontSize = `${style.fontSize}px`;
    if (style.color) el.style.color = style.color;
    if (el.textContent !== text) el.textContent = text;
    this.layout();
  }

  remove(key: string): void {
    this.slots.get(key)?.remove();
    this.slots.delete(key);
    this.layout();
  }

  /** Stack texts that share an anchor so they don't overlap. */
  private layout(): void {
    const counts = new Map<string, number>();
    for (const el of this.slots.values()) {
      const a = el.dataset.anchor!;
      const i = counts.get(a) ?? 0;
      counts.set(a, i + 1);
      el.style.setProperty('--i', String(i));
    }
  }

  /** Big centered message. seconds = 0 keeps it until cleared. */
  message(text: string, seconds = 2.5): void {
    this.banner.textContent = text;
    this.banner.classList.toggle('show', !!text);
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    if (text && seconds > 0) this.bannerTimer = setTimeout(() => this.banner.classList.remove('show'), seconds * 1000);
  }

  clear(): void {
    for (const el of this.slots.values()) el.remove();
    this.slots.clear();
    this.message('');
  }

  dispose(): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.root.remove();
  }
}

/** Styles for HUD + touch controls, injected once. */
export const RUNTIME_CSS = `
.bz-hud{position:absolute;inset:0;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#fff;z-index:5}
.bz-hud-text{position:absolute;font-size:22px;font-weight:700;text-shadow:0 2px 6px rgba(0,0,0,.6);white-space:pre;--i:0}
.bz-hud-text[data-anchor=top-left]{left:16px;top:calc(14px + var(--i)*1.5em)}
.bz-hud-text[data-anchor=top-center]{left:50%;transform:translateX(-50%);top:calc(14px + var(--i)*1.5em)}
.bz-hud-text[data-anchor=top-right]{right:16px;top:calc(14px + var(--i)*1.5em);text-align:right}
.bz-hud-text[data-anchor=center]{left:50%;top:calc(50% + var(--i)*1.5em);transform:translate(-50%,-50%)}
.bz-hud-text[data-anchor=bottom-left]{left:16px;bottom:calc(14px + var(--i)*1.5em)}
.bz-hud-text[data-anchor=bottom-center]{left:50%;transform:translateX(-50%);bottom:calc(14px + var(--i)*1.5em)}
.bz-hud-text[data-anchor=bottom-right]{right:16px;bottom:calc(14px + var(--i)*1.5em);text-align:right}
.bz-banner{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) scale(.8);font-size:clamp(28px,6vw,64px);font-weight:800;opacity:0;transition:all .25s ease;text-shadow:0 4px 18px rgba(0,0,0,.6);text-align:center;white-space:pre-wrap}
.bz-banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.bz-touch{position:absolute;inset:0;pointer-events:none;z-index:6;touch-action:none;user-select:none;-webkit-user-select:none}
.bz-stick{position:absolute;left:24px;bottom:24px;width:132px;height:132px;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.25);pointer-events:auto;touch-action:none}
.bz-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.45)}
.bz-buttons{position:absolute;right:20px;bottom:28px;display:flex;gap:14px;flex-direction:row-reverse;align-items:flex-end}
.bz-buttons button{pointer-events:auto;width:66px;height:66px;border-radius:50%;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;font:700 20px Inter,system-ui,sans-serif;touch-action:none}
.bz-buttons button:nth-child(2){margin-bottom:46px}
.bz-buttons button.active{background:rgba(255,255,255,.4)}
`;

let injected = false;
export function injectRuntimeCss(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = RUNTIME_CSS;
  document.head.appendChild(style);
}
