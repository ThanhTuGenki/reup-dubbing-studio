import { createClient, getReadiness } from '@reup-dubbing-studio/api-client';
import { z } from 'zod';
import { getSafeRequestId } from './problem-details';

const readyEnvelope = z.object({ data: z.object({ status: z.literal('ok') }), meta: z.object({ requestId: z.string().uuid() }) });
export interface ReadinessResult { status: 'ready'; requestId: string }
export type ControlPlaneErrorKind = 'configuration' | 'timeout' | 'network' | 'http' | 'invalid-response';
export class ControlPlaneError extends Error {
  public override readonly name = 'ControlPlaneError';
  public constructor(public readonly kind: ControlPlaneErrorKind, message: string, public readonly requestId?: string) { super(message); }
}

interface ReadinessOptions { baseUrl: string; signal?: AbortSignal; timeoutMs?: number; fetch?: (request: Request) => Promise<Response> }

export async function checkReadiness({ baseUrl, signal, timeoutMs = 5_000, fetch }: ReadinessOptions): Promise<ReadinessResult> {
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  let compatibleSignal: AbortSignal | undefined;
  try { new Request('about:blank', { signal: controller.signal }); compatibleSignal = controller.signal; } catch { /* jsdom and native fetch can expose different AbortSignal implementations. */ }
  const client = createClient({ baseUrl, ...(fetch ? { fetch } : {}) });
  const timeoutError = new ControlPlaneError('timeout', 'Control Plane không phản hồi kịp thời.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = getReadiness({ client, ...(compatibleSignal ? { signal: compatibleSignal } : {}) });
    const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(timeoutError); reject(timeoutError); }, timeoutMs); });
    const result = await Promise.race([request, deadline]);
    const responseRequestId = result.response.headers.get('X-Request-Id');
    if (result.error) throw new ControlPlaneError('http', 'Control Plane chưa sẵn sàng.', getSafeRequestId(result.error, responseRequestId));
    const parsed = readyEnvelope.safeParse(result.data);
    if (!parsed.success) throw new ControlPlaneError('invalid-response', 'Control Plane trả về phản hồi không hợp lệ.', getSafeRequestId(undefined, responseRequestId));
    return { status: 'ready', requestId: parsed.data.meta.requestId };
  } catch (error) {
    if (error instanceof ControlPlaneError) throw error;
    if (error === timeoutError) throw timeoutError;
    throw new ControlPlaneError('network', 'Không thể kết nối tới Control Plane.');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
