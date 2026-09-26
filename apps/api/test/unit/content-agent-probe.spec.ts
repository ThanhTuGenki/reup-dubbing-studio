import { HttpContentAgentProbe } from '../../src/modules/settings/infrastructure/content-agent-probe';

describe('HttpContentAgentProbe', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it.each([
    ['ANTHROPIC', 'http://host.docker.internal:8317/v1/messages'],
    ['OPENAI', 'https://proxy.example.test/openai/v1/responses'],
  ] as const)('sends the %s probe to the configured base URL', async (provider, url) => {
    const probe = new HttpContentAgentProbe({ anthropic: 'http://host.docker.internal:8317', openai: 'https://proxy.example.test/openai' });
    await expect(probe.test({ provider, model: 'model-x', apiKey: 'key' })).resolves.toMatchObject({ status: 'CONNECTED' });
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST' }));
  });

  it('keeps the official endpoints by default', async () => {
    await new HttpContentAgentProbe().test({ provider: 'ANTHROPIC', model: 'model-x', apiKey: 'key' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });
});
