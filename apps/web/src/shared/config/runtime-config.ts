import { z } from 'zod';
import { isLoopbackHostname, stripTrailingSlash } from '../lib/url';

export interface RuntimeConfig { controlPlaneUrl: string }
export class RuntimeConfigError extends Error { public override readonly name = 'RuntimeConfigError'; }

const publicUrl = z.string().trim().min(1);

export function readRuntimeConfig(env: Record<string, string | boolean | undefined> = import.meta.env): RuntimeConfig {
  const production = env.PROD === true || env.MODE === 'production';
  const raw = env.VITE_CONTROL_PLANE_URL ?? (production ? undefined : 'http://localhost:3000/v1');
  const parsed = publicUrl.safeParse(raw);
  if (!parsed.success) throw new RuntimeConfigError('Cấu hình Control Plane bị thiếu hoặc không hợp lệ.');

  let url: URL;
  try { url = new URL(parsed.data); } catch { throw new RuntimeConfigError('Cấu hình Control Plane bị thiếu hoặc không hợp lệ.'); }

  const validScheme = production ? url.protocol === 'https:' : url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
  if (!validScheme || url.username || url.password || url.search || url.hash || stripTrailingSlash(url.pathname) !== '/v1') {
    throw new RuntimeConfigError('Cấu hình Control Plane bị thiếu hoặc không hợp lệ.');
  }
  return { controlPlaneUrl: stripTrailingSlash(url.toString()) };
}
