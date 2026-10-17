import type { IncomingHttpHeaders } from 'node:http';

const SAFE_PREFIX = /^(\/[A-Za-z0-9._~-]+)*$/;

/**
 * The public path the dashboard lives under: the reverse proxy's X-Forwarded-Prefix when it
 * sends a safe one (Traefik's stripPrefix does), otherwise BASE_PATH. Never ends in a slash.
 */
export function publicPrefix(headers: IncomingHttpHeaders, basePath: string): string {
  const raw = headers['x-forwarded-prefix'];
  const forwarded = (Array.isArray(raw) ? raw[0] : (raw ?? '')).trim().replace(/\/+$/, '');
  return forwarded && SAFE_PREFIX.test(forwarded) ? forwarded : basePath;
}
