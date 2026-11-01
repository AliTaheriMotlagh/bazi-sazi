import * as THREE from 'three';
import type { InputMap } from '../types';

const PAD_BUTTONS = 17;
const STICK_DEADZONE = 0.25;

/**
 * Unified input: keyboard, mouse, gamepad, touch and XR controllers are all
 * mapped onto named actions ("jump", "fire"...) so games work everywhere.
 */
export class Input {
  private down = new Set<string>();
  private pressedNow = new Set<string>();
  private releasedNow = new Set<string>();
  private virtual = new Map<string, boolean>();
  private virtualAxis = new THREE.Vector2();
  private padAxis = new THREE.Vector2();
  /** Normalized device coordinates (-1..1) of the pointer over the canvas. */
  readonly pointer = new THREE.Vector2();
  readonly pointerDelta = new THREE.Vector2();
  wheel = 0;
  enabled = true;
  private disposers: (() => void)[] = [];

  constructor(
    private element: HTMLElement,
    public map: InputMap,
  ) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, 'keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.press(e.code);
    });
    on(window, 'keyup', (e) => this.release(e.code));
    on(window, 'blur', () => {
      for (const k of [...this.down]) this.release(k);
    });
    on(element, 'pointerdown', (e) => {
      this.updatePointer(e);
      if (e.pointerType === 'mouse') this.press(`Mouse${e.button}`);
    });
    on(window, 'pointerup', (e) => {
      if (e.pointerType === 'mouse') this.release(`Mouse${e.button}`);
    });
    on(window, 'pointermove', (e) => {
      this.updatePointer(e);
      this.pointerDelta.x += e.movementX;
      this.pointerDelta.y += e.movementY;
    });
    on(element, 'wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    on(element, 'contextmenu', (e) => e.preventDefault());
  }

  private updatePointer(e: PointerEvent): void {
    const r = this.element.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private press(code: string): void {
    if (this.down.has(code)) return;
    this.down.add(code);
    this.pressedNow.add(code);
  }

  private release(code: string): void {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.releasedNow.add(code);
  }

  private codes(action: string): string[] {
    return this.map[action] ?? [action];
  }

  /** Is the action (or raw key code) held down? */
  isDown(action: string): boolean {
    if (this.virtual.get(action)) return true;
    return this.codes(action).some((c) => this.down.has(c));
  }

  /** Did the action start this frame? */
  pressed(action: string): boolean {
    return this.codes(action).some((c) => this.pressedNow.has(c)) || this.pressedNow.has(`virtual:${action}`);
  }

  released(action: string): boolean {
    return this.codes(action).some((c) => this.releasedNow.has(c)) || this.releasedNow.has(`virtual:${action}`);
  }

  /** -1..1 from keys, gamepad stick and touch joystick. */
  axis(name: 'horizontal' | 'vertical'): number {
    const keys = name === 'horizontal' ? +this.isDown('right') - +this.isDown('left') : +this.isDown('up') - +this.isDown('down');
    const analog = name === 'horizontal' ? this.virtualAxis.x + this.padAxis.x : this.virtualAxis.y + this.padAxis.y;
    return THREE.MathUtils.clamp(keys + analog, -1, 1);
  }

  /** Feed from on-screen touch controls or XR controllers. */
  setVirtual(action: string, isDown: boolean): void {
    const was = !!this.virtual.get(action);
    this.virtual.set(action, isDown);
    if (isDown && !was) this.pressedNow.add(`virtual:${action}`);
    if (!isDown && was) this.releasedNow.add(`virtual:${action}`);
  }

  setVirtualAxis(x: number, y: number): void {
    this.virtualAxis.set(x, y);
  }

  /** Called once per frame before game logic. */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected);
    this.padAxis.set(0, 0);
    if (!pad) return;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    this.padAxis.set(Math.abs(ax) > STICK_DEADZONE ? ax : 0, Math.abs(ay) > STICK_DEADZONE ? -ay : 0);
    for (let i = 0; i < Math.min(PAD_BUTTONS, pad.buttons.length); i++) {
      const code = i === 12 ? 'PadUp' : i === 13 ? 'PadDown' : i === 14 ? 'PadLeft' : i === 15 ? 'PadRight' : `Pad${i}`;
      if (pad.buttons[i].pressed) this.press(code);
      else this.release(code);
    }
  }

  /** Called at the end of every frame. */
  endFrame(): void {
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.pointerDelta.set(0, 0);
    this.wheel = 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
