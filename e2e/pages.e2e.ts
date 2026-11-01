import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, findChrome, horizontalOverflow, openSession, smallTargets, startStack, unnamedControls, VIEWPORTS, type Stack, type ViewportName } from './harness';

const chrome = findChrome();
const suite = chrome ? describe : describe.skip;

const PAGES = [
  ['home', '/', 'h1'],
  ['explore', '/explore', '.site-nav'],
  ['learn', '/learn', '.learn'],
  ['resources', '/resources', '.res-grid'],
  ['unknown route falls back to home', '/definitely-not-a-page', 'h1'],
] as const;

suite('public pages on every screen size', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => stack?.stop());

  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    describe(viewport, () => {
      for (const [name, url, ready] of PAGES) {
        it(`${name}: renders, fits the screen, has named controls and no errors`, async () => {
          const { context, page, errors } = await openSession(stack, viewport);
          try {
            await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
            await page.waitForSelector(ready, { timeout: 15_000 });
            const overflow = await horizontalOverflow(page);
            expect(overflow.page, `page scrolls sideways; offenders: ${overflow.offenders.join(', ')}`).toBeLessThanOrEqual(1);
            expect(overflow.offenders).toEqual([]);
            expect(await unnamedControls(page)).toEqual([]);
            expect(errors).toEqual([]);
            if (viewport === 'phone') expect(await smallTargets(page, 30)).toEqual([]);
          } finally {
            await context.close();
          }
        });
      }

      it('navigation reaches every section (also on phones)', async () => {
        const { context, page } = await openSession(stack, viewport);
        try {
          await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
          for (const [label, path] of [['Play games', '/explore'], ['Resources', '/resources'], ['Learn', '/learn'], ['Create', '/']] as const) {
            await page.locator('.site-nav .nav-links').getByText(label, { exact: true }).click();
            await page.waitForURL(`${BASE}${path}`);
          }
        } finally {
          await context.close();
        }
      });
    });
  }

  it('the theme toggle switches the colour scheme and keeps text readable', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.getByRole('button', { name: 'Toggle theme' }).click();
      const after = await page.evaluate(() => document.documentElement.dataset.theme);
      expect(after).not.toBe(before);
      // WCAG: body text vs. background contrast of at least 4.5:1.
      const ratio = await page.evaluate(() => {
        const lum = (rgb: string) => {
          const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
            const c = Number(v) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const cs = getComputedStyle(document.body);
        const [a, b] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    } finally {
      await context.close();
    }
  });

  it('Resources page: filters, results and external links behave', async () => {
    const { context, page } = await openSession(stack, 'phone');
    const searches: URL[] = [];
    await page.route('**/api/resources/search*', (route) => {
      searches.push(new URL(route.request().url()));
      return route.fulfill({
        json: {
          hasMore: false,
          providers: [{ id: 'polyhaven', label: 'Poly Haven', ok: true }, { id: 'sketchfab', label: 'Sketchfab', ok: false, error: 'down' }],
          items: [
            { id: 'polyhaven:rock', provider: 'polyhaven', title: 'Mossy Rock', kind: 'texture', thumb: null, license: 'CC0', licenseGroup: 'cc0', sourceUrl: 'https://polyhaven.com/a/rock', downloadUrl: 'polyhaven-texture:rock' },
            { id: 'catalog:kenney', provider: 'catalog', title: 'Kenney — game assets', kind: 'other', thumb: null, license: 'CC0', licenseGroup: 'cc0', sourceUrl: 'https://kenney.nl/assets', description: 'CC0 packs' },
          ],
        },
      });
    });
    try {
      await page.goto(`${BASE}/resources`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.res-card');
      expect(await page.locator('.res-card').count()).toBe(2);
      // Provider outage is explained, not hidden.
      await expect.poll(() => page.locator('.res-note').textContent()).toContain('Sketchfab');
      // Public page has no "Add to project" (no open project) but links out safely.
      expect(await page.getByRole('button', { name: /Add to project/ }).count()).toBe(0);
      const link = page.locator('.res-card a').first();
      expect(await link.getAttribute('target')).toBe('_blank');
      expect(await link.getAttribute('rel')).toContain('noopener');
      // Filters become query parameters.
      await page.getByRole('button', { name: 'Sounds & music' }).click();
      await page.getByRole('button', { name: 'CC0 only' }).click();
      await page.getByRole('searchbox').fill('explosion');
      await page.waitForFunction(() => document.querySelector('.res-grid[aria-busy=false]'));
      await expect.poll(() => searches.at(-1)?.searchParams.get('q')).toBe('explosion');
      const last = searches.at(-1)!;
      expect(last.searchParams.get('kind')).toBe('audio');
      expect(last.searchParams.get('license')).toBe('cc0');
    } finally {
      await context.close();
    }
  });
});
