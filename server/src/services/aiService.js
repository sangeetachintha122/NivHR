import { AIProviderError } from './aiProviderError.js';
import { getCloudflareFallbackConfig, getGeminiCircuitBreakerConfig } from '../config/aiProvider.js';

const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_TIMEOUT_MS = 20000;
const GENERATION_TIMEOUT_MS = 45000;
const MAX_EMBED_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 2;
const VALID_TASK_TYPES = new Set(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']);
const SAFE_REQUEST_STAGES = new Set([
  'embedding',
  'text_generation',
  'policy_document_embedding',
  'policy_search_planning',
  'policy_query_embedding',
  'policy_answer_generation',
  'policy_full_document_answer',
  'gemini_connectivity_smoke',
]);
export const GEMINI_DEV_SIMULATION_PROMPT = 'DEV_FALLBACK_PROBE_ONLY: Return only {"status":"ready","operations":[{"capability":"attendance_summary","range":{"kind":"relative","period":"today"},"filters":{},"limit":1}]}.';
let developmentSimulationConsumed = false;

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

const notifyTrace = (onTrace, event) => {
  if (typeof onTrace !== 'function') return;
  try {
    onTrace(event);
  } catch {
    // Trace observers must never alter provider decisions or request outcomes.
  }
};

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

const getSafeStage = (stage, method) => SAFE_REQUEST_STAGES.has(stage)
  ? stage
  : method === 'generateContent' ? 'text_generation' : 'embedding';

const logRequestFailure = (failureCategory, httpStatus, method, startedAt, stage, diagnosticCategory) => {
  console.error('AI provider request failed.', {
    provider: 'gemini',
    feature: method === 'generateContent' ? 'text_generation' : 'embedding',
    stage,
    outcome: 'failure',
    fallbackAttempted: false,
    failureCategory,
    ...(diagnosticCategory ? { diagnosticCategory } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    latencyMs: Date.now() - startedAt,
  });
};

const logRequestSuccess = (method, startedAt, stage) => {
  console.info('AI provider request completed.', {
    provider: 'gemini',
    feature: method === 'generateContent' ? 'text_generation' : 'embedding',
    stage,
    outcome: 'success',
    fallbackAttempted: false,
    latencyMs: Date.now() - startedAt,
  });
};

const isTimeoutError = (error, signal) =>
  signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';

const getFetchErrorDiagnostic = (error, signal) => {
  if (isTimeoutError(error, signal)) return { failureCategory: 'timeout', diagnosticCategory: 'timeout' };

  let cause = error;
  let code;
  for (let depth = 0; cause && depth < 4; depth += 1) {
    if (typeof cause.code === 'string') {
      code = cause.code;
      break;
    }
    cause = cause.cause;
  }

  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA', 'ESERVFAIL'].includes(code)) {
    return { failureCategory: 'network_error', diagnosticCategory: 'dns_resolution_failed' };
  }
  if (code?.startsWith('ERR_TLS_') || code?.startsWith('ERR_SSL_') || [
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code)) {
    return { failureCategory: 'network_error', diagnosticCategory: 'tls_error' };
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { failureCategory: 'network_error', diagnosticCategory: 'connection_timeout' };
  }
  if (code === 'ECONNREFUSED') {
    return { failureCategory: 'network_error', diagnosticCategory: 'connection_refused' };
  }
  if (code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'EPIPE') {
    return { failureCategory: 'network_error', diagnosticCategory: 'connection_interrupted' };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { failureCategory: 'network_error', diagnosticCategory: 'network_unreachable' };
  }
  return { failureCategory: 'network_error', diagnosticCategory: 'fetch_error' };
};

const makeRequest = async ({
  apiKey,
  model,
  method,
  body,
  timeoutMs,
  simulate429 = false,
  stage,
  maxAttempts = MAX_ATTEMPTS,
  retryCategories,
  onTrace,
  redirect = 'follow',
}) => {
  const requestStage = getSafeStage(stage, method);
  const url = new URL(`${API_BASE_URL}/${encodeURIComponent(model)}:${method}`);
  url.searchParams.set('key', apiKey);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retry = false;

    try {
      let response;
      try {
        response = simulate429
          ? { status: 429, ok: false, body: null }
          : await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
            redirect,
          });
      } catch (error) {
        const diagnostic = getFetchErrorDiagnostic(error, controller.signal);
        const timedOut = diagnostic.failureCategory === 'timeout';
        logRequestFailure(
          diagnostic.failureCategory,
          undefined,
          method,
          startedAt,
          requestStage,
          diagnostic.diagnosticCategory,
        );
        notifyTrace(onTrace, {
          type: 'provider_request',
          provider: 'gemini',
          stage: requestStage,
          outcome: 'failure',
          failureCategory: diagnostic.failureCategory,
          diagnosticCategory: diagnostic.diagnosticCategory,
          latencyMs: Date.now() - startedAt,
        });
        if ((retryCategories ? retryCategories.includes(diagnostic.failureCategory) : timedOut) && attempt + 1 < maxAttempts) {
          retry = true;
        } else {
          throw new AIServiceUnavailableError(diagnostic.failureCategory);
        }
      }

      if (response && (response.status === 429 || response.status >= 500)) {
        logRequestFailure(response.status === 429 ? 'http_429' : 'http_5xx', response.status, method, startedAt, requestStage);
        await response.body?.cancel().catch(() => {});
        notifyTrace(onTrace, {
          type: 'provider_request',
          provider: 'gemini',
          stage: requestStage,
          outcome: 'failure',
          httpStatus: response.status,
          failureCategory: response.status === 429 ? 'http_429' : 'http_5xx',
          latencyMs: Date.now() - startedAt,
        });
        const failureCategory = response.status === 429 ? 'http_429' : 'http_5xx';
        if ((!retryCategories || retryCategories.includes(failureCategory)) && attempt + 1 < maxAttempts) retry = true;
        else throw new AIServiceUnavailableError(response.status === 429 ? 'http_429' : 'http_5xx', response.status);
      } else if (response && !response.ok) {
        logRequestFailure('http_error', response.status, method, startedAt, requestStage);
        notifyTrace(onTrace, {
          type: 'provider_request',
          provider: 'gemini',
          stage: requestStage,
          outcome: 'failure',
          httpStatus: response.status,
          failureCategory: 'http_4xx',
          latencyMs: Date.now() - startedAt,
        });
        throw new AIServiceUnavailableError('http_4xx', response.status);
      } else if (response?.ok) {
        try {
          const payload = await response.json();
          logRequestSuccess(method, startedAt, requestStage);
          notifyTrace(onTrace, {
            type: 'provider_request',
            provider: 'gemini',
            stage: requestStage,
            outcome: 'success',
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
          });
          return payload;
        } catch (error) {
          const timedOut = isTimeoutError(error, controller.signal);
          logRequestFailure(
            timedOut ? 'timeout' : 'invalid_response',
            undefined,
            method,
            startedAt,
            requestStage,
            timedOut ? 'timeout' : 'invalid_json_response',
          );
          notifyTrace(onTrace, {
            type: 'provider_request',
            provider: 'gemini',
            stage: requestStage,
            outcome: 'failure',
            httpStatus: response.status,
            failureCategory: timedOut ? 'timeout' : 'malformed_response',
            diagnosticCategory: timedOut ? 'timeout' : 'invalid_json_response',
            latencyMs: Date.now() - startedAt,
          });
          if ((retryCategories ? retryCategories.includes(timedOut ? 'timeout' : 'malformed_response') : timedOut)
            && attempt + 1 < maxAttempts) retry = true;
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
    ...(details.stage ? { stage: getSafeStage(details.stage, 'generateContent') } : {}),
    event,
    outcome: event.endsWith('_succeeded') ? 'success' : event.endsWith('_failed') ? 'failure' : 'status',
    ...(details.category ? { category: details.category } : {}),
    ...(Number.isInteger(details.httpStatus) ? { httpStatus: details.httpStatus } : {}),
    ...(Number.isFinite(details.latencyMs) ? { latencyMs: details.latencyMs } : {}),
    ...(typeof details.fallbackAttempted === 'boolean' ? { fallbackAttempted: details.fallbackAttempted } : {}),
  });
};

const tryCloudflareFallback = async (prompt, geminiError, reason, stage) => {
  const configuration = getCloudflareFallbackConfig();
  if (!configuration) {
    logFallbackEvent('fallback_unavailable', {
      category: 'disabled_or_invalid_configuration',
      fallbackAttempted: false,
      stage,
    });
    throw geminiError;
  }

  logFallbackEvent('fallback_attempted', { category: reason, fallbackAttempted: true, stage });

  try {
    const { reserveCloudflareRequest } = await import('./aiUsageService.js');
    const reserved = await reserveCloudflareRequest(configuration.dailyMaxRequests);
    if (!reserved) {
      logFallbackEvent('daily_cap_reached', { category: 'usage_cap', fallbackAttempted: true, stage });
      throw geminiError;
    }
  } catch (error) {
    if (error === geminiError) throw error;
    logFallbackEvent('fallback_unavailable', { category: 'usage_tracking_error', stage });
    throw geminiError;
  }

  const startedAt = Date.now();
  try {
    const { generateCloudflareJson } = await import('./cloudflareAiService.js');
    const result = await generateCloudflareJson(prompt, configuration);
    logFallbackEvent('fallback_succeeded', { latencyMs: Date.now() - startedAt, fallbackAttempted: true, stage });
    return result;
  } catch (error) {
    logFallbackEvent('fallback_failed', {
      category: error instanceof AIProviderError ? error.category : 'provider_error',
      httpStatus: error instanceof AIProviderError ? error.httpStatus : undefined,
      latencyMs: Date.now() - startedAt,
      fallbackAttempted: true,
      stage,
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

export const embedTexts = async (texts, taskType, stage, options = {}) => {
  if (!Array.isArray(texts)) throw new TypeError('texts must be an array');
  if (texts.length === 0) return [];
  if (!texts.every((text) => typeof text === 'string')) throw new TypeError('texts must contain strings');
  if (!VALID_TASK_TYPES.has(taskType)) throw new TypeError('Unsupported embedding task type');
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new TypeError('maxAttempts must be an integer between 1 and 2');
  }

  const configuration = getConfiguration('GEMINI_EMBED_MODEL');
  const startedAt = Date.now();
  const allVectors = [];
  let expectedDimensions;

  for (let offset = 0; offset < texts.length; offset += MAX_EMBED_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + MAX_EMBED_BATCH_SIZE);
    const payload = await makeRequest({
      ...configuration,
      method: 'batchEmbedContents',
      timeoutMs: EMBEDDING_TIMEOUT_MS,
      stage,
      maxAttempts,
      onTrace: options.onTrace,
      redirect: options.disableRedirects === true ? 'error' : 'follow',
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

  notifyTrace(options.onTrace, {
    type: 'embedding_result',
    provider: 'gemini',
    stage: getSafeStage(stage, 'batchEmbedContents'),
    outcome: 'success',
    queryCount: texts.length,
    embeddingModelSource: 'GEMINI_EMBED_MODEL',
    dimensions: expectedDimensions,
    latencyMs: Date.now() - startedAt,
  });

  return allVectors;
};

export const generateJson = async (prompt, stage, options = {}) => {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be a non-empty string');
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new TypeError('maxAttempts must be an integer between 1 and 2');
  }
  const configuration = getConfiguration('GEMINI_TEXT_MODEL');
  const onTrace = options.onTrace;
  const simulateDevelopment429 = process.env.NODE_ENV === 'development'
    && process.env.GEMINI_DEV_SIMULATE_429 === 'once'
    && prompt === GEMINI_DEV_SIMULATION_PROMPT
    && !developmentSimulationConsumed;
  if (simulateDevelopment429) developmentSimulationConsumed = true;
  Object.assign(geminiGenerationBreaker, getGeminiCircuitBreakerConfig());
  const breakerDecision = geminiGenerationBreaker.acquire();
  if (!breakerDecision.allowed) {
    const error = new AIServiceUnavailableError('circuit_open');
    logFallbackEvent('gemini_circuit_bypassed', { provider: 'gemini', category: breakerDecision.reason, stage });
    if (options.disableFallback === true) throw error;
    return tryCloudflareFallback(prompt, error, breakerDecision.reason, stage);
  }

  let payload;
  try {
    payload = await makeRequest({
      ...configuration,
      method: 'generateContent',
      timeoutMs: options.timeoutMs ?? GENERATION_TIMEOUT_MS,
      stage,
      maxAttempts,
      retryCategories: options.retryCategories,
      simulate429: simulateDevelopment429,
      onTrace,
      redirect: options.disableRedirects === true ? 'error' : 'follow',
      body: {
        ...(typeof options.systemInstruction === 'string' && options.systemInstruction.trim()
          ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
          : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...(Number.isFinite(options.temperature) ? { temperature: options.temperature } : {}),
        },
      },
    });
    geminiGenerationBreaker.success(breakerDecision.probe);
  } catch (error) {
    geminiGenerationBreaker.failure(error?.category, breakerDecision.probe);
    if (!isFallbackEligible(error)) throw error;
    if (options.disableFallback === true) throw error;
    return tryCloudflareFallback(prompt, error, error.category, stage);
  }

  const candidate = payload?.candidates?.[0];
  const responseText = candidate?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!responseText) {
    notifyTrace(onTrace, {
      type: 'generation_result',
      provider: 'gemini',
      stage: getSafeStage(stage, 'generateContent'),
      outcome: 'failure',
      finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
      responseLengthChars: 0,
      jsonParsed: false,
      failureCategory: 'empty_response',
    });
    return null;
  }

  const jsonText = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const result = JSON.parse(jsonText);
    notifyTrace(onTrace, {
      type: 'generation_result',
      provider: 'gemini',
      stage: getSafeStage(stage, 'generateContent'),
      outcome: 'success',
      finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
      responseLengthChars: responseText.length,
      jsonParsed: true,
    });
    return result;
  } catch {
    notifyTrace(onTrace, {
      type: 'generation_result',
      provider: 'gemini',
      stage: getSafeStage(stage, 'generateContent'),
      outcome: 'failure',
      finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
      responseLengthChars: responseText.length,
      jsonParsed: false,
      failureCategory: 'malformed_json',
    });
    return null;
  }
};
