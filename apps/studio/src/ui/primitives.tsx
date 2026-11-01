import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../store/ui';
import { Icon } from './Icon';

// ───────────────────────── Modal
export function Modal({ title, onClose, children, footer, wide, icon }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {icon && <Icon name={icon} size={18} />}
          <h2 className="grow">{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="X" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── Menu / popover
export interface MenuItem {
  label?: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  separator?: boolean;
  heading?: string;
  disabled?: boolean;
  onSelect?(): void;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
  search?: boolean;
}

/** Floating menu anchored at a point; closes on outside click / Escape. */
export function Menu({ state, onClose }: { state: MenuState; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const [query, setQuery] = useState('');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(state.x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)) });
  }, [state.x, state.y]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('pointerdown', down), 0);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const items = q ? state.items.filter((i) => i.label?.toLowerCase().includes(q)) : state.items;
  return createPortal(
    <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {state.search && (
        <input
          className="input"
          autoFocus
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const first = items.find((i) => i.onSelect && !i.disabled);
              if (first) {
                first.onSelect!();
                onClose();
              }
            }
          }}
          style={{ marginBottom: 4 }}
        />
      )}
      {items.map((item, i) =>
        item.separator ? (
          q ? null : <div key={i} className="menu-sep" />
        ) : item.heading ? (
          q ? null : <div key={i} className="menu-label">{item.heading}</div>
        ) : (
          <button
            key={i}
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            {item.icon && <Icon name={item.icon} size={15} />}
            <span className="grow truncate">{item.label}</span>
            {item.hint && <span className="hint">{item.hint}</span>}
          </button>
        ),
      )}
      {items.length === 0 && <div className="empty">Nothing found</div>}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const open = (e: { clientX: number; clientY: number } | DOMRect, items: MenuItem[], search = false) => {
    const point = 'clientX' in e ? { x: e.clientX, y: e.clientY } : { x: e.left, y: e.bottom + 4 };
    setMenu({ ...point, items, search });
  };
  const element = menu ? <Menu state={menu} onClose={() => setMenu(null)} /> : null;
  return { open, element };
}

// ───────────────────────── Toasts
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'CircleAlert' : t.kind === 'success' ? 'Check' : 'Info'} size={15} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Inputs
export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

/** Number input with drag-to-scrub on its label (like pro engines). */
export function NumberInput({ value, onChange, step = 0.1, min, max, className, scrubRef }: { value: number; onChange(v: number): void; step?: number; min?: number; max?: number; className?: string; scrubRef?: React.RefObject<HTMLElement | null> }) {
  const [text, setText] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = evaluate(raw);
    if (v !== null) onChange(clamp(v));
    else setText(format(value));
  };
  useEffect(() => {
    const el = scrubRef?.current;
    if (!el) return;
    let startX = 0;
    let start = 0;
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      onChange(clamp(round(start + delta, step)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    const down = (e: PointerEvent) => {
      startX = e.clientX;
      start = value;
      document.body.style.cursor = 'ew-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  });
  return (
    <input
      className={`input ${className ?? ''}`}
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        focused.current = false;
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = clamp(round(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1), step));
          onChange(next);
          setText(format(next));
        }
      }}
    />
  );
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1000) / 1000);
}

function round(v: number, step: number): number {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
  return Number(v.toFixed(decimals));
}

/** Accept simple math in number fields: "2*3", "10/4+1". */
function evaluate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/^[-+*/().\d\s]+$/.test(s)) return null;
  try {
    const v = Function(`"use strict";return (${s})`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Icon name="LoaderCircle" size={size} className="spin" />;
}
