export const CLOUDFLARE_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const readInteger = (name, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
};

export const getGeminiCircuitBreakerConfig = () => ({
  threshold: readInteger('GEMINI_CIRCUIT_BREAKER_THRESHOLD', 3, 1, 100) ?? 3,
  cooldownMs: readInteger('GEMINI_CIRCUIT_BREAKER_COOLDOWN_MS', 60000, 1000, 3600000) ?? 60000,
});

export const getCloudflareFallbackConfig = () => {
  if (process.env.CLOUDFLARE_AI_ENABLED !== 'true'
    || process.env.CLOUDFLARE_FALLBACK_ENABLED !== 'true') return null;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const model = process.env.CLOUDFLARE_AI_MODEL?.trim() || CLOUDFLARE_AI_MODEL;
  const timeoutMs = readInteger('CLOUDFLARE_REQUEST_TIMEOUT_MS', 30000, 1000, 120000);
  const dailyMaxRequests = readInteger('CLOUDFLARE_DAILY_MAX_REQUESTS', 100, 1, 1000000);
  const breaker = getGeminiCircuitBreakerConfig();

  if (!accountId || !/^[a-f\d]{32}$/i.test(accountId) || !apiToken
    || model !== CLOUDFLARE_AI_MODEL || timeoutMs === null || dailyMaxRequests === null
    || breaker.threshold === null || breaker.cooldownMs === null) return null;

  return { accountId, apiToken, model: CLOUDFLARE_AI_MODEL, timeoutMs, dailyMaxRequests };
};
