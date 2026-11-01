import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';

export function id(prefix = ''): string {
  return prefix + randomBytes(9).toString('base64url');
}

/** Parse a body with zod; on failure send 400 and return null. */
export function parse<T>(schema: ZodType<T>, value: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  void reply.code(400).send({ error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request' });
  return null;
}

/** Token bucket rate limiter keyed by an arbitrary string. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  private capacity: number;
  private refillPerSecond: number;

  constructor(capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, last: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.last) / 1000) * this.refillPerSecond);
    b.last = now;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    return ok;
  }

  private sweep(): void {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, b] of this.buckets) if (b.last < cutoff) this.buckets.delete(k);
  }
}
