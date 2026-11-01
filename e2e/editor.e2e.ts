import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { BASE, findChrome, horizontalOverflow, openEditor, openSession, startStack, unnamedControls, type Stack } from './harness';

const chrome = findChrome();
const suite = chrome ? describe : describe.skip;

const tab = (page: Page, name: string) => page.locator('.mobile-tabs button').filter({ has: page.getByText(name, { exact: true }) });
const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

suite('editor on a phone', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => stack?.stop());

  it('every section opens, keeps the live scene visible and fits the screen', async () => {
    const { context, page, errors } = await openSession(stack, 'phone');
    try {
      await openEditor(page);
      const full = await box(page, '.phone-preview');
      for (const name of ['Objects', 'Details', 'Content', 'AI']) {
        await tab(page, name).click();
        await expect.poll(async () => (await box(page, '.phone-sheet')).height, { timeout: 10_000 }).toBeGreaterThan(150);
        const preview = await box(page, '.phone-preview');
        // The scene stays on screen above the sheet, so every change is visible as it happens.
        expect(preview.height, `${name}: preview too small`).toBeGreaterThan(90);
        expect(preview.height, `${name}: preview should shrink`).toBeLessThan(full.height);
        expect(await page.locator('.phone-preview canvas').first().isVisible()).toBe(true);
        const overflow = await horizontalOverflow(page);
        expect(overflow.offenders, name).toEqual([]);
        expect(await tab(page, name).getAttribute('aria-current')).toBe('page');
      }
      await tab(page, 'Scene').click();
      expect(await page.locator('.phone-sheet').count()).toBe(0);
      expect(await unnamedControls(page)).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('editing a property updates the scene immediately and can be undone from the toolbar', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await openEditor(page);
      await tab(page, 'Objects').click();
      await page.getByText('Player', { exact: true }).first().tap();
      await page.getByLabel('Name', { exact: true }).waitFor({ state: 'visible' });
      const x = page.locator('.phone-sheet .prop', { hasText: 'Position' }).locator('input').first();
      const before = await x.inputValue();
      await x.fill('3');
      await x.blur();
      await expect.poll(() => x.inputValue(), { timeout: 10_000 }).toBe('3');
      // Undo is reachable on a phone (it used to be hidden) and restores the value.
      await page.getByRole('button', { name: 'Undo' }).tap();
      await expect.poll(() => x.inputValue(), { timeout: 10_000 }).toBe(before);
      await page.getByRole('button', { name: 'Redo' }).tap();
      await expect.poll(() => x.inputValue(), { timeout: 10_000 }).toBe('3');
    } finally {
      await context.close();
    }
  });

  it('the preview can be resized by dragging the handle', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await openEditor(page);
      await tab(page, 'Details').click();
      const before = (await box(page, '.phone-preview')).height;
      const handle = await box(page, '.phone-stage .splitter');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 160, { steps: 6 });
      await page.mouse.up();
      expect((await box(page, '.phone-preview')).height).toBeGreaterThan(before + 100);
    } finally {
      await context.close();
    }
  });

  it('the command menu opens every feature (☰) and the add button jumps to Objects', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await openEditor(page);
      await page.getByRole('button', { name: 'All commands' }).tap();
      await (page.getByRole('dialog').or(page.locator('.palette'))).waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add objects' }).tap();
      expect(await tab(page, 'Objects').getAttribute('aria-current')).toBe('page');
    } finally {
      await context.close();
    }
  });

  it('code editor: compact header, no sideways overflow, quick-key bar types into Monaco', async () => {
    const { context, page, errors } = await openSession(stack, 'phone');
    try {
      await openEditor(page);
      await tab(page, 'Content').click();
      await page.getByText('Scripts', { exact: false }).first().tap();
      await page.locator('.cb-bar .btn.primary').tap();
      await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
      // Opening code gives it the whole stage.
      expect(await page.locator('.phone-sheet').count()).toBe(0);
      expect(await tab(page, 'Code').getAttribute('aria-current')).toBe('page');
      expect((await box(page, '.script-bar')).height).toBeLessThan(60); // header stays on one row
      expect((await horizontalOverflow(page)).offenders).toEqual([]);
      expect(await page.locator('.iPadShowKeyboard').first().isVisible().catch(() => false)).toBe(false);
      // The key bar sits above the bottom navigation and inserts characters at the cursor.
      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.press('Control+End');
      await page.getByRole('button', { name: 'Curly braces' }).dispatchEvent('pointerdown');
      const text = await page.evaluate(() => (window as unknown as { monaco?: never }).monaco ? '' : document.querySelector('.monaco-editor .view-lines')!.textContent ?? '');
      expect(text).toContain('{}');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('shows what an object costs (triangles, draw calls, textures) with a verdict and tips', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await openEditor(page, 'Royale');
      await tab(page, 'Objects').click();
      await page.getByText('Blue King Tower', { exact: false }).first().tap().catch(async () => page.locator('.tree-row').nth(3).tap());
      const card = page.locator('.perf').first();
      await card.waitFor({ state: 'visible', timeout: 15_000 });
      await expect.poll(() => card.textContent()).toMatch(/triangles/);
      await card.getByRole('button').click();
      expect(await card.locator('.perf-tips li').count()).toBeGreaterThan(0);
      expect((await horizontalOverflow(page)).offenders).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('free resources: search from the Content tab, filter, add to project and see it in the browser', async () => {
    const { context, page } = await openSession(stack, 'phone');
    const imports: unknown[] = [];
    await page.route('**/api/resources/search*', (route) =>
      route.fulfill({
        json: {
          hasMore: false,
          providers: [{ id: 'commons', label: 'Wikimedia Commons', ok: true }],
          items: [{ id: 'commons:1', provider: 'commons', title: 'Explosion sound', kind: 'audio', thumb: null, preview: 'https://example.com/x.ogg', license: 'CC BY 3.0', licenseGroup: 'attribution', author: 'Jane', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X', downloadUrl: 'https://upload.wikimedia.org/x.ogg' }],
        },
      }),
    );
    await page.route('**/api/resources/import', (route) => {
      imports.push(route.request().postDataJSON());
      return route.fulfill({ json: { url: '/files/abc.ogg', size: 1234, mime: 'audio/ogg', name: 'Explosion sound', type: 'audio', libraryId: 'lib_1', created: true, credit: { title: 'Explosion sound', author: 'Jane', license: 'CC BY 3.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X' } } });
    });
    try {
      await openEditor(page);
      await tab(page, 'Content').click();
      await page.getByRole('button', { name: 'Free resources' }).tap();
      const dialog = page.getByRole('dialog', { name: 'Free resources' });
      await (dialog).waitFor({ state: 'visible' });
      // Full-screen sheet on phones.
      expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(389);
      expect((await horizontalOverflow(page)).offenders).toEqual([]);
      await dialog.getByRole('button', { name: /Add to project/ }).tap();
      await (dialog.getByRole('button', { name: 'Added' })).waitFor({ state: 'visible' });
      expect(imports[0]).toMatchObject({ url: 'https://upload.wikimedia.org/x.ogg', kind: 'audio', meta: { provider: 'commons', id: 'commons:1', license: 'CC BY 3.0' } });
      await page.keyboard.press('Escape');
      await (dialog).waitFor({ state: 'hidden' });
      // The asset (with its credit) is now part of the project.
      const credit = await page.evaluate(() => (window as unknown as { __bazi: { editor: () => { project: { assets: { name: string }[] } } } }).__bazi.editor().project.assets.find((a) => a.name === 'Explosion sound'));
      expect(credit).toMatchObject({ url: '/files/abc.ogg', type: 'audio', credit: { license: 'CC BY 3.0', author: 'Jane' } });
    } finally {
      await context.close();
    }
  });

  it('dialogs trap focus and close with Escape', async () => {
    const { context, page } = await openSession(stack, 'phone');
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Sign in' }).click();
      const dialog = page.getByRole('dialog');
      await (dialog).waitFor({ state: 'visible' });
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await (dialog).waitFor({ state: 'hidden' });
      // Focus returns to the control that opened it.
      expect(await page.evaluate(() => document.activeElement?.textContent)).toContain('Sign in');
    } finally {
      await context.close();
    }
  });

  it('welcome dialog buttons are fully visible on a 320px screen', async () => {
    const { context, page } = await openSession(stack, 'smallPhone');
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await page.getByText('Platformer', { exact: false }).first().click();
      await page.waitForSelector('.modal .modal-foot');
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.modal-foot .btn')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + 0.5; }).map((b) => b.textContent),
      );
      expect(clipped).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

suite('editor on a tablet and desktop', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => stack?.stop());

  it('desktop: panels, menu, palette, resources shortcut and welcome dialog', async () => {
    const { context, page, errors } = await openSession(stack, 'desktop');
    try {
      await openEditor(page);
      for (const sel of ['.menubar', '.toolbar', '.status-bar, .statusbar', '.doc-tabs']) expect(await page.locator(sel).first().isVisible(), sel).toBe(true);
      expect((await horizontalOverflow(page)).offenders).toEqual([]);
      await page.keyboard.press('Control+k');
      await (page.getByPlaceholder(/command|search/i).first()).waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+r');
      await (page.getByRole('dialog', { name: 'Free resources' })).waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('tablet: panels open as drawers and the scene fills the screen', async () => {
    const { context, page } = await openSession(stack, 'tablet');
    try {
      await openEditor(page);
      expect((await horizontalOverflow(page)).offenders).toEqual([]);
      await page.getByRole('button', { name: 'Toggle outliner and place panel' }).tap();
      await (page.locator('.drawer.open')).waitFor({ state: 'visible' });
    } finally {
      await context.close();
    }
  });
});
