import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { parse, RateLimiter } from '../util.ts';

const ChatBody = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
  tools: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(64000).optional(),
});

interface ModelInfo {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

/**
 * Proxy to OpenRouter. Keeps a server key secret when configured; otherwise
 * forwards the user's own key (sent per request, never stored server-side).
 */
export function aiRoutes(app: FastifyInstance, { config }: AppContext): void {
  const OPENROUTER = config.openRouterBaseUrl.replace(/\/+$/, '');
  const limiter = new RateLimiter(config.limits.aiRequestsPerMinute, config.limits.aiRequestsPerMinute / 60);
  let modelCache: { at: number; models: unknown[] } | null = null;

  const keyFor = (header: unknown) => config.openRouterKey || (typeof header === 'string' ? header.trim() : '');

  app.get('/api/ai/status', async () => ({ serverKey: !!config.openRouterKey }));

  app.get('/api/ai/models', async (_req, reply) => {
    if (modelCache && Date.now() - modelCache.at < 3600_000) return { models: modelCache.models };
    try {
      const res = await fetch(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: ModelInfo[] };
      const models = json.data
        .filter((m) => m.supported_parameters?.includes('tools'))
        .map((m) => ({ id: m.id, name: m.name, context: m.context_length, prompt: m.pricing?.prompt, completion: m.pricing?.completion }));
      modelCache = { at: Date.now(), models };
      return { models };
    } catch (err) {
      return reply.code(502).send({ error: `Could not load models from OpenRouter: ${(err as Error).message}` });
    }
  });

  app.post('/api/ai/chat', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    if (!limiter.take(me.sub)) return reply.code(429).send({ error: 'Slow down a little — too many AI requests this minute.' });
    const key = keyFor(req.headers['x-openrouter-key']);
    if (!key) return reply.code(400).send({ error: 'Add your OpenRouter API key in the AI panel settings (openrouter.ai/keys).' });
    const body = parse(ChatBody, req.body, reply);
    if (!body) return;
    try {
      const res = await fetch(`${OPENROUTER}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'http-referer': config.publicUrl,
          'x-title': 'Bazi-Sazi Game Studio',
        },
        body: JSON.stringify({ ...body, user: me.sub }),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await res.text();
      if (!res.ok) {
        let message = text.slice(0, 500);
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* keep raw text */
        }
        return reply.code(res.status === 401 ? 401 : 502).send({ error: `OpenRouter: ${message}` });
      }
      return reply.type('application/json').send(text);
    } catch (err) {
      return reply.code(504).send({ error: `AI request failed: ${(err as Error).message}` });
    }
  });
}
