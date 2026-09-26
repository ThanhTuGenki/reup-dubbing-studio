import {
  contentAgentEndpoint, DEFAULT_CONTENT_AGENT_BASE_URLS, type ContentAgentBaseUrls,
} from '../../../platform/config/config';
import type { ContentAgentProbe } from '../application/ports';
import type { ConnectionTestResult } from '../domain/settings';
import { SettingsError } from '../domain/settings-errors';

export class HttpContentAgentProbe implements ContentAgentProbe {
  constructor(private readonly baseUrls: ContentAgentBaseUrls = DEFAULT_CONTENT_AGENT_BASE_URLS) {}

  async test(input: Parameters<ContentAgentProbe['test']>[0]): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const anthropic = input.provider === 'ANTHROPIC';
      const response = await fetch(
        contentAgentEndpoint(input.provider, this.baseUrls),
        {
          method: 'POST',
          signal: controller.signal,
          headers: anthropic
            ? { 'content-type': 'application/json', 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
            : { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify(anthropic
            ? { model: input.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
            : { model: input.model, max_output_tokens: 1, input: 'ping' }),
        },
      );
      if (!response.ok) throw new Error('provider rejected probe');
      return {
        status: 'CONNECTED', latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(), message: 'Content Agent connection succeeded',
      };
    } catch {
      throw new SettingsError('CONNECTION_TEST_FAILED', 'Content Agent connection failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}
