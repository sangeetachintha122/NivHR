import { AIProviderError } from './aiProviderError.js';
import { CLOUDFLARE_AI_MODEL } from '../config/aiProvider.js';

const DEFAULT_TIMEOUT_MS = 30000;

const parseJsonResponse = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AIProviderError('cloudflare', 'malformed_response');
  }
  const jsonText = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new AIProviderError('cloudflare', 'malformed_response');
  }
};

export const generateCloudflareJson = async (prompt, configuration, fetchImpl = fetch) => {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('prompt must be a non-empty string');
  }

  const accountId = configuration?.accountId?.trim();
  const apiToken = configuration?.apiToken?.trim();
  const timeoutMs = configuration?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!accountId || !apiToken || configuration?.model !== CLOUDFLARE_AI_MODEL
    || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new AIProviderError('cloudflare', 'configuration');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_AI_MODEL}`;
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';
      throw new AIProviderError('cloudflare', timedOut ? 'timeout' : 'network_error');
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new AIProviderError('cloudflare', response.status === 429 ? 'http_429' : `http_${Math.floor(response.status / 100)}xx`, response.status);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      const timedOut = controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';
      throw new AIProviderError('cloudflare', timedOut ? 'timeout' : 'malformed_response');
    }

    if (payload?.success !== true || typeof payload?.result?.response !== 'string') {
      throw new AIProviderError('cloudflare', 'malformed_response');
    }
    return parseJsonResponse(payload.result.response);
  } finally {
    clearTimeout(timeout);
  }
};
