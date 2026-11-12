const SAFE_TOP_LEVEL_KEYS = new Set(['success', 'result', 'errors', 'messages']);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const normalizedContentType = (response) => {
  const rawContentType = response.headers.get('content-type');
  if (!rawContentType) return 'missing';
  const mediaType = rawContentType.split(';', 1)[0].trim().toLowerCase();
  return /^[a-z\d.+-]+\/[a-z\d.+-]+$/.test(mediaType) ? mediaType : 'other';
};

const diagnosticBase = (response) => ({
  httpStatus: Number.isInteger(response.status) ? response.status : null,
  contentType: normalizedContentType(response),
  topLevelJsonKeys: [],
  otherTopLevelKeyCount: 0,
  selectedFieldTypes: {
    success: 'unavailable',
    result: 'unavailable',
    'result.response': 'unavailable',
  },
  expectedResponseFieldExists: false,
  outputLength: null,
  parserFailureCategory: 'envelope_unreadable',
});

export const inspectCloudflareResponse = async (response) => {
  const diagnostics = diagnosticBase(response);
  let payload;
  try {
    payload = await response.json();
  } catch {
    diagnostics.parserFailureCategory = 'envelope_not_json';
    return diagnostics;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    diagnostics.parserFailureCategory = 'unexpected_envelope_type';
    return diagnostics;
  }

  const topLevelKeys = Object.keys(payload);
  diagnostics.topLevelJsonKeys = topLevelKeys
    .filter((key) => SAFE_TOP_LEVEL_KEYS.has(key))
    .sort();
  diagnostics.otherTopLevelKeyCount = topLevelKeys.filter((key) => !SAFE_TOP_LEVEL_KEYS.has(key)).length;
  diagnostics.selectedFieldTypes = {
    success: typeOf(payload.success),
    result: typeOf(payload.result),
    'result.response': typeOf(payload.result?.response),
  };

  if (payload.success !== true) {
    diagnostics.parserFailureCategory = 'success_flag_invalid';
    return diagnostics;
  }
  if (!payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
    diagnostics.parserFailureCategory = 'result_field_invalid';
    return diagnostics;
  }

  diagnostics.expectedResponseFieldExists = Object.hasOwn(payload.result, 'response');
  if (!diagnostics.expectedResponseFieldExists) {
    diagnostics.parserFailureCategory = 'response_field_missing';
    return diagnostics;
  }

  const output = payload.result.response;
  if (output !== null && typeof output === 'object' && !Array.isArray(output)) {
    diagnostics.parserFailureCategory = 'none';
    return diagnostics;
  }
  if (typeof output !== 'string') {
    diagnostics.parserFailureCategory = 'response_field_type_unsupported';
    return diagnostics;
  }
  diagnostics.outputLength = output.length;
  if (!output.trim()) {
    diagnostics.parserFailureCategory = 'response_empty';
    return diagnostics;
  }

  const jsonText = output
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    JSON.parse(jsonText);
    diagnostics.parserFailureCategory = 'none';
  } catch {
    diagnostics.parserFailureCategory = 'response_not_json';
  }
  return diagnostics;
};
