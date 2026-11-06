const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBEDDING_TIMEOUT_MS = 20000;
const GENERATION_TIMEOUT_MS = 45000;
const MAX_EMBED_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 2;
const VALID_TASK_TYPES = new Set(['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY']);

export class AIServiceUnavailableError extends Error {
  constructor() {
    super('AI service unavailable');
    this.name = 'AIServiceUnavailableError';
    this.statusCode = 503;
    this.code = 'AI_SERVICE_UNAVAILABLE';
  }
}

const getConfiguration = (modelVariable) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env[modelVariable]?.trim();
  if (!apiKey || !model) throw new AIServiceUnavailableError();
  return { apiKey, model: model.replace(/^models\//, '') };
};

const logRequestFailure = (failureCategory, httpStatus) => {
  console.error('Gemini request failed.', {
    failureCategory,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  });
};

const isTimeoutError = (error, signal) =>
  signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError';

const makeRequest = async ({ apiKey, model, method, body, timeoutMs }) => {
  const url = new URL(`${API_BASE_URL}/${encodeURIComponent(model)}:${method}`);
  url.searchParams.set('key', apiKey);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
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
        logRequestFailure(timedOut ? 'timeout' : 'network_error');
        if (timedOut && attempt + 1 < MAX_ATTEMPTS) {
          retry = true;
        } else {
          throw new AIServiceUnavailableError();
        }
      }

      if (response && (response.status === 429 || response.status >= 500)) {
        logRequestFailure(response.status === 429 ? 'http_429' : 'http_5xx', response.status);
        await response.body?.cancel().catch(() => {});
        if (attempt + 1 < MAX_ATTEMPTS) retry = true;
        else throw new AIServiceUnavailableError();
      } else if (response && !response.ok) {
        logRequestFailure('http_error', response.status);
        throw new AIServiceUnavailableError();
      } else if (response?.ok) {
        try {
          return await response.json();
        } catch (error) {
          const timedOut = isTimeoutError(error, controller.signal);
          logRequestFailure(timedOut ? 'timeout' : 'invalid_response');
          if (timedOut && attempt + 1 < MAX_ATTEMPTS) retry = true;
          else throw new AIServiceUnavailableError();
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (retry) continue;
    throw new AIServiceUnavailableError();
  }

  throw new AIServiceUnavailableError();
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
  const payload = await makeRequest({
    ...configuration,
    method: 'generateContent',
    timeoutMs: GENERATION_TIMEOUT_MS,
    body: {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    },
  });

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
