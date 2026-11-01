import type { AssetData, PrefabData, ProjectData } from '@bazi/engine/core';

const TOKEN_KEY = 'bz.token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON: a platform error page (e.g. "A server error has occurred") or a proxy message.
    throw new ApiError(res.ok ? 'The server sent an unreadable response.' : `Server error (${res.status}). The API may be misconfigured or still starting — check the deployment logs.`, res.status || 500);
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface User {
  id: string;
  username: string;
  guest: boolean;
}
export interface AuthResult {
  token: string;
  user: User;
}
export interface ProjectSummary {
  id: string;
  name: string;
  mode: '2d' | '3d';
  thumbnail: string | null;
  updatedAt: number;
  publishedSlug: string | null;
}
export interface GameInfo {
  slug: string;
  title: string;
  description: string;
  thumbnail: string | null;
  mode: '2d' | '3d';
  multiplayer: boolean;
  maxPlayers: number;
  plays: number;
  likes: number;
  author: string;
  createdAt: number;
  updatedAt: number;
  liked?: boolean;
}
export interface ProjectRecord {
  id: string;
  data: ProjectData;
  updatedAt: number;
  game: { slug: string; title: string; description: string; updated_at: number } | null;
}
export interface VersionInfo {
  id: string;
  label: string;
  name: string;
  auto: boolean;
  createdAt: number;
  size: number;
}
export interface SharedPrefabInfo {
  id: string;
  name: string;
  description: string;
  mode: '2d' | '3d';
  downloads: number;
  createdAt: number;
  author: string;
}
export interface SharedPrefab {
  name: string;
  mode: '2d' | '3d';
  prefab: PrefabData;
  assets: AssetData[];
}
export interface AiModel {
  id: string;
  name: string;
  context?: number;
  prompt?: string;
  completion?: string;
}

const post = <T>(path: string, json?: unknown, headers?: HeadersInit) => request<T>(path, { method: 'POST', json: json ?? {}, headers });

export const api = {
  register: (username: string, password: string) => post<AuthResult>('/api/auth/register', { username, password }),
  login: (username: string, password: string) => post<AuthResult>('/api/auth/login', { username, password }),
  guest: () => post<AuthResult>('/api/auth/guest'),
  upgrade: (username: string, password: string) => post<AuthResult>('/api/auth/upgrade', { username, password }),
  me: () => request<{ user: User }>('/api/auth/me'),

  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects'),
  createProject: (data: ProjectData, thumbnail?: string) => post<{ id: string; data: ProjectData }>('/api/projects', { data, thumbnail }),
  project: (id: string) => request<ProjectRecord>(`/api/projects/${id}`),
  saveProject: (id: string, data: ProjectData, thumbnail?: string | null) =>
    request<{ ok: true; updatedAt: number }>(`/api/projects/${id}`, { method: 'PUT', json: { data, thumbnail: thumbnail ?? undefined } }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: 'DELETE' }),
  publish: (id: string, body: { slug: string; title: string; description: string; thumbnail?: string }) => post<{ ok: true; slug: string }>(`/api/projects/${id}/publish`, body),
  unpublish: (id: string) => request<{ ok: true }>(`/api/projects/${id}/publish`, { method: 'DELETE' }),
  slugAvailable: (slug: string, project: string) => request<{ available: boolean; reason?: string }>(`/api/slug-available?slug=${encodeURIComponent(slug)}&project=${project}`),

  versions: (id: string) => request<{ versions: VersionInfo[] }>(`/api/projects/${id}/versions`),
  addCollaborator: (id: string, username: string) => post<{ collaborator: { id: string; username: string } }>(`/api/projects/${id}/collaborators`, { username }),
  saveVersion: (id: string, label: string) => post<{ ok: true }>(`/api/projects/${id}/versions`, { label }),
  restoreVersion: (id: string, versionId: string) => post<{ ok: true; updatedAt: number; data: ProjectData }>(`/api/projects/${id}/versions/${versionId}/restore`),
  remix: (slug: string) => post<{ id: string }>(`/api/games/${slug}/remix`),
  prefabs: (q = '', mode = '') => request<{ prefabs: SharedPrefabInfo[] }>(`/api/prefabs?q=${encodeURIComponent(q)}&mode=${mode}`),
  sharePrefab: (body: { name: string; description: string; mode: '2d' | '3d'; data: { prefab: PrefabData; assets: AssetData[] } }) => post<{ id: string }>('/api/prefabs', body),
  sharedPrefab: (id: string) => request<SharedPrefab>(`/api/prefabs/${id}`),
  deleteSharedPrefab: (id: string) => request<{ ok: true }>(`/api/prefabs/${id}`, { method: 'DELETE' }),

  games: (q: { q?: string; sort?: string; mode?: string; multiplayer?: boolean }) => {
    const p = new URLSearchParams();
    if (q.q) p.set('q', q.q);
    if (q.sort) p.set('sort', q.sort);
    if (q.mode) p.set('mode', q.mode);
    if (q.multiplayer) p.set('multiplayer', '1');
    return request<{ games: GameInfo[] }>(`/api/games?${p}`);
  },
  myGames: () => request<{ games: GameInfo[] }>('/api/games/mine'),
  game: (slug: string) => request<{ game: GameInfo }>(`/api/games/${slug}`),
  like: (slug: string) => post<{ liked: boolean; likes: number }>(`/api/games/${slug}/like`),
  rooms: (slug: string) => request<{ rooms: { name: string; players: number; max: number }[] }>(`/api/rooms/${slug}`),

  upload: (file: File) =>
    request<{ url: string; size: number; mime: string }>(`/api/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'content-type': file.type || 'application/octet-stream' },
    }),

  /** Deployment capabilities (cached): multiplayer transport, game URL style, storage. */
  config: () => (configCache ??= request<DeployConfig>('/api/config').catch((err) => {
    configCache = null;
    throw err;
  })),
  aiStatus: () => request<{ serverKey: boolean }>('/api/ai/status'),
  aiModels: () => request<{ models: AiModel[] }>('/api/ai/models'),
  aiChat: (body: unknown, userKey?: string) => post<AiResponse>('/api/ai/chat', body, userKey ? { 'x-openrouter-key': userKey } : undefined),
};

export interface DeployConfig {
  realtime: 'ws' | 'p2p';
  realtimeUrl: string | null;
  gameHost: 'subdomain' | 'path';
  storage: { database: string; files: string };
  ephemeral?: boolean;
}
let configCache: Promise<DeployConfig> | null = null;

export interface AiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: AiToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface AiResponse {
  choices: { message: AiMessage; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
}

let subdomains = true;
void Promise.resolve()
  .then(() => api.config())
  .then((c) => (subdomains = c.gameHost === 'subdomain'))
  .catch(() => undefined);

/** Public URL of a published game: its own subdomain, or /embed/<slug> where subdomains aren't set up. */
export function gameUrl(slug: string): string {
  const { protocol, host } = location;
  if (!subdomains) return `${protocol}//${host}/embed/${slug}`;
  return `${protocol}//${slug}.${host.replace(/^www\./, '')}/`;
}

/** Network options for the engine based on how this deployment does multiplayer. */
export async function networkFor(game: string, room: string, name: string): Promise<{ transport: 'ws' | 'p2p'; url?: string; room?: string; name: string }> {
  const cfg = await api.config().catch(() => null);
  if (cfg?.realtime === 'p2p') return { transport: 'p2p', room: `${game}/${room}`, name };
  const base = cfg?.realtimeUrl ? cfg.realtimeUrl.replace(/\/$/, '') + '/ws/play' : null;
  const url = base ? `${base}?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}` : wsUrl(game, room);
  return { transport: 'ws', url, name };
}

export function embedUrl(slug: string, room?: string): string {
  return `/embed/${slug}${room ? `?room=${encodeURIComponent(room)}` : ''}`;
}

export function wsUrl(game: string, room = 'public'): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/play?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}`;
}
