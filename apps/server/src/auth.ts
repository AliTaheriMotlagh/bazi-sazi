import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export interface TokenPayload {
  sub: string;
  name: string;
  guest: boolean;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** Minimal HS256 JWT. */
export function signToken(payload: Omit<TokenPayload, 'exp'>, secret: string, ttlSeconds: number): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload | null;
  }
}

/** Reads the bearer token (if any) into request.user. */
export function authHook(secret: string) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    req.user = header?.startsWith('Bearer ') ? verifyToken(header.slice(7), secret) : null;
  };
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): TokenPayload | null {
  if (!req.user) {
    void reply.code(401).send({ error: 'Please sign in first.' });
    return null;
  }
  return req.user;
}
