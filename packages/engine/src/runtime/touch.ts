import type { Input } from './input';

/** On-screen joystick + buttons for phones and tablets. */
export class TouchControls {
  readonly root: HTMLDivElement;

  constructor(container: HTMLElement, input: Input, buttons: string[] = ['jump', 'fire', 'action']) {
    const root = document.createElement('div');
    root.className = 'bz-touch';
    root.innerHTML = `
      <div class="bz-stick"><div class="bz-knob"></div></div>
      <div class="bz-buttons">${buttons.map((b) => `<button data-action="${b}" aria-label="${b}">${b[0].toUpperCase()}</button>`).join('')}</div>`;
    container.appendChild(root);
    this.root = root;

    const stick = root.querySelector<HTMLDivElement>('.bz-stick')!;
    const knob = root.querySelector<HTMLDivElement>('.bz-knob')!;
    let stickPointer: number | null = null;
    const moveStick = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = e.clientX - (r.left + radius);
      let dy = e.clientY - (r.top + radius);
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.setVirtualAxis(dx / radius, -dy / radius);
    };
    stick.addEventListener('pointerdown', (e) => {
      stickPointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    stick.addEventListener('pointermove', (e) => e.pointerId === stickPointer && moveStick(e));
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickPointer) return;
      stickPointer = null;
      knob.style.transform = '';
      input.setVirtualAxis(0, 0);
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);

    root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      const action = btn.dataset.action!;
      const set = (v: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        btn.classList.toggle('active', v);
        input.setVirtual(action, v);
      };
      btn.addEventListener('pointerdown', set(true));
      btn.addEventListener('pointerup', set(false));
      btn.addEventListener('pointercancel', set(false));
      btn.addEventListener('pointerleave', set(false));
    });
  }

  static shouldShow(mode: 'auto' | 'always' | 'never'): boolean {
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
  }

  dispose(): void {
    this.root.remove();
  }
}
