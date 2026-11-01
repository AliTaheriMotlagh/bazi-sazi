import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, requireUser, signToken, verifyPassword } from '../auth.ts';
import type { AppContext } from '../context.ts';
import { id, parse, RateLimiter } from '../util.ts';

const Credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'only letters, numbers, _ . - allowed'),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
});

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  is_guest: number;
}

export function authRoutes(app: FastifyInstance, { db, config }: AppContext): void {
  const limiter = new RateLimiter(10, 0.2); // brute-force protection per IP
  const issue = (u: { id: string; username: string; is_guest: number }) => ({
    token: signToken({ sub: u.id, name: u.username, guest: !!u.is_guest }, config.jwtSecret, config.tokenTtlSeconds),
    user: { id: u.id, username: u.username, guest: !!u.is_guest },
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (!limiter.take(`reg:${req.ip}`)) return reply.code(429).send({ error: 'Too many attempts, try again later.' });
    const body = parse(Credentials, req.body, reply);
    if (!body) return;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) return reply.code(409).send({ error: 'That username is taken.' });
    const user = { id: id('u_'), username: body.username, is_guest: 0 };
    db.prepare('INSERT INTO users (id, username, password_hash, is_guest, created_at) VALUES (?, ?, ?, 0, ?)').run(user.id, user.username, await hashPassword(body.password), Date.now());
    return issue(user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (!limiter.take(`login:${req.ip}`)) return reply.code(429).send({ error: 'Too many attempts, try again later.' });
    const body = parse(Credentials, req.body, reply);
    if (!body) return;
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(body.username) as UserRow | undefined;
    if (!row || row.is_guest || !(await verifyPassword(body.password, row.password_hash))) return reply.code(401).send({ error: 'Wrong username or password.' });
    return issue(row);
  });

  /** One-click start for people who don't want an account yet. */
  app.post('/api/auth/guest', async (req, reply) => {
    if (!limiter.take(`guest:${req.ip}`)) return reply.code(429).send({ error: 'Too many guest accounts, try again later.' });
    const user = { id: id('u_'), username: `guest-${id().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, is_guest: 1 };
    db.prepare('INSERT INTO users (id, username, password_hash, is_guest, created_at) VALUES (?, ?, ?, 1, ?)').run(user.id, user.username, await hashPassword(id()), Date.now());
    return issue(user);
  });

  /** Turn a guest into a real account, keeping all projects and games. */
  app.post('/api/auth/upgrade', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const body = parse(Credentials, req.body, reply);
    if (!body) return;
    const taken = db.prepare('SELECT id FROM users WHERE username = ?').get(body.username) as { id: string } | undefined;
    if (taken && taken.id !== me.sub) return reply.code(409).send({ error: 'That username is taken.' });
    db.prepare('UPDATE users SET username = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(body.username, await hashPassword(body.password), me.sub);
    return issue({ id: me.sub, username: body.username, is_guest: 0 });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const me = requireUser(req, reply);
    if (!me) return;
    const row = db.prepare('SELECT id, username, is_guest FROM users WHERE id = ?').get(me.sub) as UserRow | undefined;
    if (!row) return reply.code(401).send({ error: 'Account no longer exists.' });
    return { user: { id: row.id, username: row.username, guest: !!row.is_guest } };
  });
}
