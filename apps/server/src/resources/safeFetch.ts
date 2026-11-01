import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export interface Downloaded {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Injection points for tests. */
  resolve?: (host: string) => Promise<string[]>;
  request?: typeof httpsRequest;
}

export class DownloadError extends Error {
  readonly statusCode: number;
  readonly expose = true;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(v) === 6) return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('2001:db8');
  return true; // not an IP at all
}

async function publicAddress(host: string, resolve: (h: string) => Promise<string[]>): Promise<string> {
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new DownloadError('That address is not allowed.', 400);
    return host;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new DownloadError(`Could not find the host ${host}.`, 502);
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new DownloadError('That address is not allowed.', 400);
  return addresses[0];
}

const defaultResolve = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/**
 * Downloads a public HTTPS file for the user. Guards against server-side request forgery: only https on the default
 * port, no credentials, every redirect hop re-validated, the connection is pinned to the address that was checked
 * (no DNS rebinding), and the body is capped.
 */
export async function safeDownload(rawUrl: string, options: SafeFetchOptions): Promise<Downloaded> {
  const resolve = options.resolve ?? defaultResolve;
  const doRequest = options.request ?? httpsRequest;
  let url: URL;
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    try {
      url = new URL(current);
    } catch {
      throw new DownloadError('That is not a valid link.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new DownloadError('Only plain https links are allowed.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const address = await publicAddress(host, resolve);
    const result = await new Promise<Downloaded | { redirect: string }>((resolveP, reject) => {
      const req = doRequest(
        url,
        {
          method: 'GET',
          timeout: options.timeoutMs ?? 15_000,
          headers: { 'user-agent': 'BaziSazi/1.0 (asset import)', accept: '*/*' },
          // Connect to the address we validated, not whatever DNS says a moment later.
          lookup: (_h, _o, cb) => {
            const family = isIP(address);
            (cb as unknown as (e: null, a: string, f: number) => void)(null, address, family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            return resolveP({ redirect: new URL(res.headers.location, url).toString() });
          }
          if (status !== 200) {
            res.resume();
            return reject(new DownloadError(`The source answered with HTTP ${status}.`, 502));
          }
          const declared = Number(res.headers['content-length']);
          if (declared > options.maxBytes) {
            res.resume();
            return reject(new DownloadError('That file is too large to import.', 413));
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > options.maxBytes) {
              res.destroy();
              reject(new DownloadError('That file is too large to import.', 413));
            } else chunks.push(chunk);
          });
          res.on('end', () => resolveP({ body: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(), finalUrl: url.toString() }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new DownloadError('The source took too long to answer.', 504)));
      req.on('error', (err) => reject(err instanceof DownloadError ? err : new DownloadError('Could not download that file.', 502)));
      req.end();
    });
    if ('redirect' in result) {
      if (hop >= (options.maxRedirects ?? 3)) throw new DownloadError('Too many redirects.', 502);
      current = result.redirect;
      continue;
    }
    return result;
  }
}
