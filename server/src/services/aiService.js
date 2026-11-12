import { AIProviderError } from './aiProviderError.js';
import { getCloudflareFallbackConfig, getGeminiCircuitBreakerConfig } from '../config/aiProvider.js';

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_TIMEOUT_MS = 20000;
const GENERATION_TIMEOUT_MS = 45000;
const MAX_EMBED_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 2;
const VALID_TASK_TYPES = new Set(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']);

export { AIProviderError };

export class AIServiceUnavailableError extends Error {
  constructor(category = 'unavailable', httpStatus) {
    super('AI service unavailable');
    this.name = 'AIServiceUnavailableError';
    this.statusCode = 503;
    this.code = 'AI_SERVICE_UNAVAILABLE';
    this.provider = 'gemini';
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

export class GeminiQuotaCircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 60000, now = Date.now } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.consecutiveQuotaFailures = 0;
    this.openUntil = 0;
    this.probeInFlight = false;
  }

  acquire() {
    if (!this.openUntil) return { allowed: true, probe: false };
    if (this.now() < this.openUntil) return { allowed: false, reason: 'circuit_open' };
    if (this.probeInFlight) return { allowed: false, reason: 'probe_in_flight' };
    this.probeInFlight = true;
    return { allowed: true, probe: true };
  }

  success(probe) {
    this.consecutiveQuotaFailures = 0;
    this.openUntil = 0;
    if (probe) this.probeInFlight = false;
  }

  failure(category, probe) {
    if (probe) this.probeInFlight = false;
    if (category !== 'http_429') {
      this.consecutiveQuotaFailures = 0;
      return;
    }
    this.consecutiveQuotaFailures += 1;
    if (probe || this.consecutiveQuotaFailures >= this.threshold) {
      this.openUntil = this.now() + this.cooldownMs;
    }
  }
}

const geminiGenerationBreaker = new GeminiQuotaCircuitBreaker({
  ...getGeminiCircuitBreakerConfig(),
});

const getConfiguration = (modelVariable) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env[modelVariable]?.trim();
  if (!apiKey || !model) throw new AIServiceUnavailableError('configuration');
  return { apiKey, model: model.replace(/^models\//, '') };
};

const logRequestFailure = (failureCategory, httpStatus, method, startedAt) => {
  console.error('AI provider request failed.', {
    provider: 'gemini',
    feature: method === 'generateContent' ? 'text_generation' : 'embedding',
    outcome: 'failure',
    fallbackAttempted: false,
    failureCategory,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    latencyMs: Date.now() - startedAt,
  });
};

const logRequestSuccess = (method, startedAt) => {
  console.info('AI provider request completed.', {
    provider: 'gemini',
    feature: method === 'generateContent' ? 'text_generation' : 'embedding',
    outcome: 'success',
    fallbackAttempted: false,
    latencyMs: Date.now() - startedAt,
  });
};

const isTimeoutError = (error, signal) =>
  signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';

const makeRequest = async ({ apiKey, model, method, body, timeoutMs }) => {
  const url = new URL(`${API_BASE_URL}/${encodeURIComponent(model)}:${method}`);
  url.searchParams.set('key', apiKey);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retry = false;

    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = isTimeoutError(error, controller.signal);
        logRequestFailure(timedOut ? 'timeout' : 'network_error', undefined, method, startedAt);
        if (timedOut && attempt + 1 < MAX_ATTEMPTS) {
          retry = true;
        } else {
          throw new AIServiceUnavailableError(timedOut ? 'timeout' : 'network_error');
        }
      }

      if (response && (response.status === 429 || response.status >= 500)) {
        logRequestFailure(response.status === 429 ? 'http_429' : 'http_5xx', response.status, method, startedAt);
        await response.body?.cancel().catch(() => {});
        if (attempt + 1 < MAX_ATTEMPTS) retry = true;
        else throw new AIServiceUnavailableError(response.status === 429 ? 'http_429' : 'http_5xx', response.status);
      } else if (response && !response.ok) {
        logRequestFailure('http_error', response.status, method, startedAt);
        throw new AIServiceUnavailableError('http_4xx', response.status);
      } else if (response?.ok) {
        try {
          const payload = await response.json();
          logRequestSuccess(method, startedAt);
          return payload;
        } catch (error) {
          const timedOut = isTimeoutError(error, controller.signal);
          logRequestFailure(timedOut ? 'timeout' : 'invalid_response', undefined, method, startedAt);
          if (timedOut && attempt + 1 < MAX_ATTEMPTS) retry = true;
          else throw new AIServiceUnavailableError(timedOut ? 'timeout' : 'malformed_response');
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (retry) continue;
    throw new AIServiceUnavailableError('unavailable');
  }

  throw new AIServiceUnavailableError('unavailable');
};

const isFallbackEligible = (error) => error instanceof AIServiceUnavailableError
  && ['http_429', 'http_5xx', 'timeout', 'network_error'].includes(error.category);

const logFallbackEvent = (event, details = {}) => {
  console.info('AI provider routing event.', {
    provider: details.provider || 'cloudflare',
    feature: 'text_generation',
    event,
    outcome: event.endsWith('_succeeded') ? 'success' : event.endsWith('_failed') ? 'failure' : 'status',
    ...(details.category ? { category: details.category } : {}),
    ...(Number.isInteger(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(Number.isFinite(details.latencyMs) ? { latencyMs: details.latencyMs } : {}),
    ...(typeof details.fallbackAttempted === 'boolean' ? { fallbackAttempted: details.fallbackAttempted } : {}),
  });
};

const tryCloudflareFallback = async (prompt, geminiError, reason) => {
  const configuration = getCloudflareFallbackConfig();
  if (!configuration) {
    logFallbackEvent('fallback_unavailable', { category: 'disabled_or_invalid_configuration', fallbackAttempted: false });
    throw geminiError;
  }

  logFallbackEvent('fallback_attempted', { category: reason, fallbackAttempted: true });

  try {
    const { reserveCloudflareRequest } = await import('./aiUsageService.js');
    const reserved = await reserveCloudflareRequest(configuration.dailyMaxRequests);
    if (!reserved) {
      logFallbackEvent('daily_cap_reached', { category: 'usage_cap', fallbackAttempted: true });
      throw geminiError;
    }
  } catch (error) {
    if (error === geminiError) throw error;
    logFallbackEvent('fallback_unavailable', { category: 'usage_tracking_error' });
    throw geminiError;
  }

  const startedAt = Date.now();
  try {
    const { generateCloudflareJson } = await import('./cloudflareAiService.js');
    const result = await generateCloudflareJson(prompt, configuration);
    logFallbackEvent('fallback_succeeded', { latencyMs: Date.now() - startedAt, fallbackAttempted: true });
    return result;
  } catch (error) {
    logFallbackEvent('fallback_failed', {
      category: error instanceof AIProviderError ? error.category : 'provider_error',
      httpStatus: error instanceof AIProviderError ? error.httpStatus : undefined,
      latencyMs: Date.now() - startedAt,
      fallbackAttempted: true,
    });
    throw geminiError;
  }
};

const validateEmbeddingResponse = (payload, expectedCount) => {
  const embeddings = payload?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new AIServiceUnavailableError();
  }

  const vectors = embeddings.map((embedding) => embedding?.values);
  const dimensions = vectors[0]?.length;
  if (!Number.isInteger(dimensions) || dimensions < 1) throw new AIServiceUnavailableError();

  if (vectors.some((vector) =>
    !Array.isArray(vector) ||
    vector.length !== dimensions ||
    vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  )) {
    throw new AIServiceUnavailableError();
  }

  return vectors;
};

export const embedTexts = async (texts, taskType) => {
  if (!Array.isArray(texts)) throw new TypeError('texts must be an array');
  if (texts.length === 0) return [];
  if (!texts.every((text) => typeof text === 'string')) throw new TypeError('texts must contain strings');
  if (!VALID_TASK_TYPES.has(taskType)) throw new TypeError('Unsupported embedding task type');

  const configuration = getConfiguration('GEMINI_EMBED_MODEL');
  const allVectors = [];
  let expectedDimensions;

  for (let offset = 0; offset < texts.length; offset += MAX_EMBED_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + MAX_EMBED_BATCH_SIZE);
    const payload = await makeRequest({
      ...configuration,
      method: 'batchEmbedContents',
      timeoutMs: EMBEDDING_TIMEOUT_MS,
      body: {
        requests: batch.map((text) => ({
          model: `models/${configuration.model}`,
          content: { parts: [{ text }] },
          taskType,
        })),
      },
    });
    const vectors = validateEmbeddingResponse(payload, batch.length);
    const dimensions = vectors[0].length;
    if (expectedDimensions !== undefined && dimensions !== expectedDimensions) {
      throw new AIServiceUnavailableError();
    }
    expectedDimensions = dimensions;
    allVectors.push(...vectors);
  }

  return allVectors;
};

export const generateJson = async (prompt) => {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be a non-empty string');
  const configuration = getConfiguration('GEMINI_TEXT_MODEL');
  Object.assign(geminiGenerationBreaker, getGeminiCircuitBreakerConfig());
  const breakerDecision = geminiGenerationBreaker.acquire();
  if (!breakerDecision.allowed) {
    const error = new AIServiceUnavailableError('circuit_open');
    logFallbackEvent('gemini_circuit_bypassed', { provider: 'gemini', category: breakerDecision.reason });
    return tryCloudflareFallback(prompt, error, breakerDecision.reason);
  }

  let payload;
  try {
    payload = await makeRequest({
      ...configuration,
      method: 'generateContent',
      timeoutMs: GENERATION_TIMEOUT_MS,
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      },
    });
    geminiGenerationBreaker.success(breakerDecision.probe);
  } catch (error) {
    geminiGenerationBreaker.failure(error?.category, breakerDecision.probe);
    if (!isFallbackEligible(error)) throw error;
    return tryCloudflareFallback(prompt, error, error.category);
  }

  const responseText = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!responseText) return null;

  const jsonText = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
};
