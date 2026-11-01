import { it } from 'vitest';
import { BASE, openSession, startStack } from './harness';

it('debug first load', async () => {
  const stack = await startStack();
  const { page } = await openSession(stack, 'phone');
  const log: string[] = [];
  page.on('pageerror', (e) => log.push('PAGEERR ' + e.message.slice(0, 300)));
  page.on('console', (m) => ['error'].includes(m.type()) && log.push('console: ' + m.text().slice(0, 300)));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.getByText('Platformer', { exact: false }).first().click();
  await page.waitForTimeout(15000);
  const info = await page.evaluate(() => ({ url: location.href, html: document.getElementById('root')?.innerHTML.slice(0, 200), text: document.body.innerText.slice(0, 200) }));
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-alitaheri-Desktop-bazi-sazi/e905015a-08f6-447f-8644-d48ec5d94662/scratchpad/shots/e2e-first.png' });
  console.log(JSON.stringify(info), log.slice(0, 8));
  await stack.stop();
}, 120_000);
