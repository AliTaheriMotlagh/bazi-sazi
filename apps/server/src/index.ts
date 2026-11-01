import { buildApp } from './app.ts';
import { config } from './config.ts';

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`\n  🎮 Bazi-Sazi server  →  http://localhost:${config.port}`);
  console.log(`     Games are served at http://<slug>.${config.baseDomain}/`);
  console.log(`     AI: ${config.openRouterKey ? 'server OpenRouter key configured' : 'users bring their own OpenRouter key'}\n`);
} catch (err) {
  console.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
