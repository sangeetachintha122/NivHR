const questions = [
  'How do I request sick leave?',
  'When is a medical certificate required?',
  'Explain all the leave policies available in the company.',
  'What are the department-wise leave capacity rules?',
  'What happens to unused leave at the end of the year?',
  'Can employees take 10 consecutive working days of annual leave?',
];

const failClosed = (message) => {
  console.error(JSON.stringify({ type: 'trace_aborted', reason: message }));
  process.exitCode = 1;
};

if (process.env.NODE_ENV !== 'development') {
  failClosed('NODE_ENV must be development before running the trace.');
  process.exit();
}
if (process.env.POLICY_TRACE_ENABLED !== 'true') {
  failClosed('POLICY_TRACE_ENABLED=true is required.');
  process.exit();
}
if (!process.env.POLICY_TRACE_MONGO_URI) {
  failClosed('A local read-only POLICY_TRACE_MONGO_URI must be supplied in the process environment.');
  process.exit();
}

const credentialNames = [
  'GEMINI_API_KEY',
  'GEMINI_TEXT_MODEL',
  'GEMINI_EMBED_MODEL',
];
const missingCredentials = credentialNames.filter((name) => !process.env[name]?.trim());
if (missingCredentials.length) {
  failClosed(`Required Gemini configuration is missing: ${missingCredentials.join(', ')}.`);
  process.exit();
}

const parseMongoIdentity = (value) => {
  let uri;
  try {
    uri = new URL(value);
  } catch {
    throw new Error('invalid_mongodb_uri');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(uri.protocol)) throw new Error('invalid_mongodb_uri');
  const databaseName = decodeURIComponent(uri.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!databaseName) throw new Error('mongodb_database_required');
  const host = uri.hostname.toLocaleLowerCase('en');
  const port = uri.port || (uri.protocol === 'mongodb+srv:' ? 'srv' : '27017');
  return { uri, databaseName, identity: `${host}:${port}/${databaseName}` };
};

let traceMongo;
try {
  traceMongo = parseMongoIdentity(process.env.POLICY_TRACE_MONGO_URI);
} catch {
  failClosed('POLICY_TRACE_MONGO_URI must be a valid MongoDB URI selecting a database.');
  process.exit();
}

if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(traceMongo.uri.hostname.toLocaleLowerCase('en'))) {
  failClosed('The trace database must use a loopback host; remote databases are refused.');
  process.exit();
}
if (/^(admin|config|local)$/i.test(traceMongo.databaseName) || /prod(?:uction)?/i.test(traceMongo.databaseName)) {
  failClosed('The selected database name is not permitted for a development trace.');
  process.exit();
}

const previousCloudflareEnvironment = Object.fromEntries([
  'CLOUDFLARE_AI_ENABLED',
  'CLOUDFLARE_FALLBACK_ENABLED',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AI_MODEL',
  'CLOUDFLARE_DAILY_MAX_REQUESTS',
  'CLOUDFLARE_REQUEST_TIMEOUT_MS',
].map((name) => [name, process.env[name]]));

for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL',
  'CLOUDFLARE_DAILY_MAX_REQUESTS', 'CLOUDFLARE_REQUEST_TIMEOUT_MS']) delete process.env[name];
process.env.CLOUDFLARE_AI_ENABLED = 'false';
process.env.CLOUDFLARE_FALLBACK_ENABLED = 'false';

const sensitiveUriValues = [process.env.POLICY_TRACE_MONGO_URI, process.env.MONGO_URI]
  .filter((value) => typeof value === 'string' && value.length > 0);
const safeStack = (error) => String(error?.stack || '')
  .split('\n')
  .slice(1, 9)
  .filter((line) => /^\s*at\s/.test(line))
  .map((line) => {
    let sanitized = line
      .replace(/mongodb(?:\+srv)?:\/\/[^\s)]+/gi, '[MONGODB_URI_REDACTED]')
      .replace(/https?:\/\/[^\s)]+/gi, '[URL_REDACTED]')
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
      .replace(/([?&](?:key|token|apiKey|password)=)[^&\s)]+/gi, '$1[REDACTED]');
    for (const secret of sensitiveUriValues) sanitized = sanitized.replaceAll(secret, '[URI_REDACTED]');
    return sanitized;
  });

const safeFailureCategory = (error) => {
  const category = error?.category;
  const allowed = new Set([
    'configuration', 'circuit_open', 'http_429', 'http_5xx', 'http_4xx', 'timeout',
    'network_error', 'malformed_response', 'unavailable', 'provider_error',
  ]);
  return allowed.has(category) ? category : error?.name === 'MongoServerError' ? 'database_error' : 'unknown';
};

const READ_ONLY_ACTIONS = new Set([
  'changeStream', 'collStats', 'connectionStatus', 'dbHash', 'dbStats', 'find', 'indexStats', 'killCursors',
  'listCollections', 'listIndexes', 'planCacheRead', 'querySettings',
]);

let mongoose;
let databaseConnected = false;
try {
  const mongooseModule = await import('mongoose');
  mongoose = mongooseModule.default;
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  mongoose.set('bufferCommands', false);

  const { default: PolicyDoc } = await import('../../src/models/PolicyDoc.js');
  const { default: PolicyChunk } = await import('../../src/models/PolicyChunk.js');
  const { answerPolicyQuestion } = await import('../../src/services/policyService.js');
  const { getCloudflareFallbackConfig } = await import('../../src/config/aiProvider.js');

  if (getCloudflareFallbackConfig()) throw new Error('cloudflare_not_disabled');

  await mongoose.connect(process.env.POLICY_TRACE_MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    readPreference: 'primary',
  });
  databaseConnected = true;

  const topology = await mongoose.connection.db.admin().command({ hello: 1 });
  const advertisedHosts = [...(topology.hosts || []), topology.me, topology.primary].filter(Boolean);
  const isLoopbackHost = (host) => /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  if (advertisedHosts.some((host) => !isLoopbackHost(host))) {
    throw new Error('remote_mongodb_topology_refused');
  }

  const authStatus = await mongoose.connection.db.admin().command({ connectionStatus: 1, showPrivileges: true });
  const privileges = authStatus?.authInfo?.authenticatedUserPrivileges;
  const isReadOnly = Array.isArray(privileges) && privileges.length > 0 && privileges.every((privilege) =>
    Array.isArray(privilege.actions) && privilege.actions.every((action) => READ_ONLY_ACTIONS.has(action)));
  if (!isReadOnly) throw new Error('read_only_role_not_verified');

  const documents = await PolicyDoc.find()
    .select('_id title filename chunkCount status embeddingModel embeddingModelName')
    .lean();
  const documentIds = documents.map(({ _id }) => _id);
  const chunks = await PolicyChunk.find()
    .select('docId chunkIndex text +embedding')
    .lean();

  const sectionPatterns = new Map(Array.from({ length: 12 }, (_, index) => {
    const section = index + 1;
    return [section, new RegExp(`(?:^|\\n)\\s*(?:Section\\s*)?${section}(?:\\.|\\s*[–—-])\\s+`, 'i')];
  }));
  const detailedSectionPatterns = {
    3: /(?:^|\n)\s*(?:Section\s+)?3(?:\.|\s*[–—-])\s*Annual Leave\b/i,
    4: /(?:^|\n)\s*(?:Section\s+)?4(?:\.|\s*[–—-])\s*Sick Leave\b/i,
    5: /(?:^|\n)\s*(?:Section\s+)?5(?:\.|\s*[–—-])\s*Casual Leave\b/i,
    6: /(?:^|\n)\s*(?:Section\s+)?6(?:\.|\s*[–—-])\s*Leave Counting, Balance and Approval\b/i,
    12: /(?:^|\n)\s*(?:Section\s+)?12(?:\.|\s*[–—-])\s*Department-wise Leave Capacity\b/i,
  };
  const lineBreakFlags = (text) => {
    const lines = text.split(/\r?\n/);
    let rawNewlineInsideSentence = false;
    let hyphenatedLineBreak = false;
    for (let index = 0; index < lines.length - 1; index += 1) {
      const before = lines[index].trim();
      const after = lines[index + 1].trim();
      if (!before || !after) continue;
      if (/[A-Za-z]-$/.test(before) && /^[a-z]/.test(after)) hyphenatedLineBreak = true;
      const structuralLine = /^(?:\d{1,2}\.\s|Section\s+\d+\b|[-•]\s|--\s+\d+\s+of\s+\d+)/i;
      const structuralBoundary = structuralLine.test(before) || structuralLine.test(after);
      const sentenceBoundary = /[.!?]["')\]]?$/.test(before) && /^[A-Z0-9]/.test(after);
      if (!structuralBoundary && !sentenceBoundary) rawNewlineInsideSentence = true;
    }
    return { rawNewlineInsideSentence, hyphenatedLineBreak };
  };

  console.log(JSON.stringify({
    type: 'trace_database',
    connected: true,
    database: mongoose.connection.name,
    readOnlyVerified: true,
    documentCount: documents.length,
  }));

  for (const document of documents) {
    const documentChunks = chunks
      .filter(({ docId }) => docId.toString() === document._id.toString())
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    const dimensions = [...new Set(documentChunks
      .map(({ embedding }) => Array.isArray(embedding) && embedding.length ? embedding.length : null)
      .filter((dimension) => dimension !== null))];
    const missingEmbeddingCount = documentChunks.filter(({ embedding }) => !Array.isArray(embedding) || embedding.length === 0).length;
    const invalidEmbeddingCount = documentChunks.filter(({ embedding }) =>
      Array.isArray(embedding) && embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))).length;
    const indexes = documentChunks.map(({ chunkIndex }) => chunkIndex);
    const expectedIndexCount = Number.isInteger(document.chunkCount) ? document.chunkCount : documentChunks.length;
    const expectedIndexes = Array.from({ length: expectedIndexCount }, (_, index) => index);
    const missingIndexes = expectedIndexes.filter((index) => !indexes.includes(index));
    const unexpectedIndexes = indexes.filter((index) => !expectedIndexes.includes(index));
    const duplicateIndexes = [...new Set(indexes.filter((index, position) => indexes.indexOf(index) !== position))];
    const combinedText = documentChunks.map(({ text }) => text).join('\n');
    const representedSections = [...sectionPatterns.entries()]
      .filter(([, pattern]) => pattern.test(combinedText))
      .map(([section]) => section);

    console.log(JSON.stringify({
      type: 'policy_document',
      documentId: document._id.toString(),
      filename: document.filename,
      status: document.status ?? 'not_stored_by_current_schema',
      chunkCountRecord: document.chunkCount ?? null,
      chunkCountObserved: documentChunks.length,
      chunkCountMismatch: Number.isInteger(document.chunkCount) && document.chunkCount !== documentChunks.length,
      embeddingModel: document.embeddingModel || document.embeddingModelName || 'not_recorded',
      embeddingDimensions: dimensions,
      missingEmbeddingCount,
      invalidEmbeddingCount,
      inconsistentEmbeddingDimensions: dimensions.length > 1,
      missingChunkIndexes: missingIndexes,
      unexpectedChunkIndexes: unexpectedIndexes,
      duplicateChunkIndexes: duplicateIndexes,
      representedSections,
      missingSections: Array.from({ length: 12 }, (_, index) => index + 1)
        .filter((section) => !representedSections.includes(section)),
      chunks: documentChunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        characterLength: typeof chunk.text === 'string' ? chunk.text.length : 0,
        sections: Object.fromEntries(Object.entries(detailedSectionPatterns)
          .map(([section, pattern]) => [`section${section}`, pattern.test(chunk.text || '')])),
        ...lineBreakFlags(chunk.text || ''),
      })),
    }));
  }

  const allEmbeddingDimensions = [...new Set(chunks
    .map(({ embedding }) => Array.isArray(embedding) && embedding.length ? embedding.length : null)
    .filter((dimension) => dimension !== null))];
  console.log(JSON.stringify({
    type: 'embedding_inventory',
    orphanChunkCount: chunks.filter(({ docId }) => !documents.some(({ _id }) => _id.toString() === docId?.toString())).length,
    dimensionsAcrossDocuments: allEmbeddingDimensions,
    inconsistentAcrossDocuments: allEmbeddingDimensions.length > 1,
    embeddingModelMetadataStored: documents.some(({ embeddingModel, embeddingModelName }) => Boolean(embeddingModel || embeddingModelName)),
    runtimeEmbeddingModelSource: 'GEMINI_EMBED_MODEL (identifier suppressed)',
  }));

  const summaries = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    let lastStage = 'pipeline start';
    let finalTraceOutcome = null;
    let answerJsonParsed;
    const onEvent = (event) => {
      if (event.stage) lastStage = event.stage;
      if (event.type === 'pipeline_result') finalTraceOutcome = event;
      if (event.type === 'generation_result' && event.stage === 'policy_answer_generation') {
        answerJsonParsed = event.jsonParsed;
      }
      if (event.type === 'generation_result' && event.finishReason) {
        event = { ...event, finishReason: ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'].includes(event.finishReason) ? event.finishReason : 'OTHER' };
      }
      console.log(JSON.stringify({ type: 'question_trace', questionIndex: index + 1, question, ...event }));
    };

    try {
      const result = await answerPolicyQuestion({
        userId: new mongoose.Types.ObjectId(),
        question,
        trace: {
          enabled: true,
          maxAttempts: 1,
          disableFallback: true,
          disableRedirects: true,
          suppressAuditLog: true,
          onEvent,
        },
      });
      const outcome = result.found ? 'answer' : 'no-support';
      const reportedStage = finalTraceOutcome?.stage === 'Zod validation' && answerJsonParsed === false
        ? 'JSON parsing'
        : finalTraceOutcome?.stage || (result.found ? 'successful answer' : 'unknown');
      summaries.push({
        question,
        outcome,
        stage: reportedStage,
        reason: finalTraceOutcome?.reason || 'unknown',
      });
    } catch (error) {
      const stage = lastStage;
      const stack = safeStack(error);
      console.log(JSON.stringify({
        type: 'question_exception',
        questionIndex: index + 1,
        exceptionClass: error?.name || 'Error',
        stage,
        failureCategory: safeFailureCategory(error),
        stack,
      }));
      summaries.push({ question, outcome: 'error', stage, reason: safeFailureCategory(error) });
    }
  }

  console.log('\n| Question | Outcome | Stage where evidence disappeared or request failed | Reason |');
  console.log('|---|---|---|---|');
  for (const summary of summaries) {
    console.log(`| ${summary.question} | ${summary.outcome} | ${summary.stage} | ${summary.reason} |`);
  }
} catch (error) {
  console.error(JSON.stringify({
    type: 'trace_aborted',
    exceptionClass: error?.name || 'Error',
    failureCategory: safeFailureCategory(error),
    reason: error?.message === 'read_only_role_not_verified'
      ? 'MongoDB did not prove the configured account has read-only privileges.'
      : error?.message === 'cloudflare_not_disabled'
        ? 'Cloudflare fallback configuration could not be disabled.'
        : 'Read-only trace setup failed closed.',
    stack: safeStack(error),
  }));
  process.exitCode = 1;
} finally {
  if (databaseConnected) await mongoose.disconnect().catch(() => {});
  for (const [name, value] of Object.entries(previousCloudflareEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
