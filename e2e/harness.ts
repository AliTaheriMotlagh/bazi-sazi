import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const API_PORT = 18787;
export const WEB_PORT = 15173;
export const BASE = `http://localhost:${WEB_PORT}`;

export const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  smallPhone: { width: 320, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

/** A Chrome/Chromium to drive, or null (the e2e suite then skips itself). Override with E2E_CHROME. */
export function findChrome(): string | null {
  const candidates = [
    process.env.E2E_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

async function waitFor(url: string, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export interface Stack {
  browser: Browser;
  stop(): Promise<void>;
}

/** Starts the real API server (temporary data dir) and the Vite dev server, plus a browser. */
export async function startStack(): Promise<Stack> {
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome found');
  const dataDir = mkdtempSync(path.join(tmpdir(), 'bazi-e2e-'));
  const children: ChildProcess[] = [];
  const run = (cmd: string, args: string[], env: Record<string, string>) => {
    const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
    children.push(child);
  };
  run('node', ['apps/server/src/index.ts'], { PORT: String(API_PORT), DATA_DIR: dataDir, HOST: '127.0.0.1' });
  run('npx', ['vite', 'apps/studio', '--port', String(WEB_PORT), '--strictPort'], { API_URL: `http://127.0.0.1:${API_PORT}` });
  await waitFor(`http://127.0.0.1:${API_PORT}/api/health`);
  await waitFor(`${BASE}/`);
  const browser = await chromium.launch({ executablePath: chrome, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  return {
    browser,
    async stop() {
      await browser.close();
      for (const c of children) c.kill('SIGTERM');
    },
  };
}

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Console errors and uncaught exceptions seen so far. */
  errors: string[];
}

/** Ignorable noise: WebGL fallbacks in headless Chrome, blocked third-party thumbnails. */
const NOISE = /GPU stall|WebGL|swiftshader|Failed to load resource|favicon|net::ERR|ResizeObserver loop/i;

export async function openSession(stack: Stack, viewport: ViewportName): Promise<Session> {
  const { width, height, ...device } = VIEWPORTS[viewport];
  const context = await stack.browser.newContext({ viewport: { width, height }, ...device });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !NOISE.test(m.text()) && errors.push(`console: ${m.text()}`));
  return { context, page, errors };
}

/** Creates a project from a template on the home page and waits for the editor; dismisses the welcome dialog. */
export async function openEditor(page: Page, templateName = 'Platformer'): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByText(templateName, { exact: false }).first().click();
  await page.waitForURL(/\/edit\//, { timeout: 30_000 });
  await page.waitForSelector('.modal', { timeout: 15_000 });
  await page.locator('.modal button[aria-label=Close]').click();
  await page.waitForSelector('.modal', { state: 'detached' });
  await page.waitForSelector('canvas', { timeout: 20_000 });
}

/** Elements wider than the viewport (a sign of broken responsive layout), ignoring scroll containers. */
export async function horizontalOverflow(page: Page): Promise<{ page: number; offenders: string[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollable = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 && !scrollable(el.parentElement) && getComputedStyle(el).position !== 'fixed') offenders.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]}`);
    }
    return { page: document.documentElement.scrollWidth - vw, offenders: offenders.slice(0, 6) };
  });
}

/** Interactive elements without any accessible name. */
export async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      if (el.closest('.monaco-editor')) continue;
      const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el as HTMLInputElement).placeholder || el.textContent?.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || (el.closest('label')?.textContent?.trim());
      if (!label) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    }
    return out.slice(0, 8);
  });
}

/** Touch targets smaller than `min` px (checked only for visible, enabled controls). */
export async function smallTargets(page: Page, min = 32): Promise<string[]> {
  return page.evaluate((m) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select, [role=tab]')) {
      const r = el.getBoundingClientRect();
      // Links inside a sentence are exempt (WCAG 2.5.8 inline exception).
      if (r.width === 0 || r.height === 0 || el.closest('.monaco-editor, .react-flow, canvas') || (el.tagName === 'A' && el.closest('p, li') && !el.classList.contains('btn'))) continue;
      if (r.height < m - 0.5 || r.width < m - 0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)}"`);
    }
    return out.slice(0, 10);
  }, min);
}
