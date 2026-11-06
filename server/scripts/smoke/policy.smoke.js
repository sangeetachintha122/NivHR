import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import AuditLog from '../../src/models/AuditLog.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptDirectory, '../..');
const projectRoot = path.resolve(serverDirectory, '..');
const apiBaseUrl = (process.env.API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const samplePath = path.resolve(
  projectRoot,
  process.env.POLICY_SAMPLE_PATH || 'docs/Sample_Policy.pdf',
);

let hrToken;
let employeeToken;
let employeeUserId;
let smokeDocumentId;
let auditReaderAvailable;

const runTest = async (name, operation) => {
  try {
    await operation();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    return false;
  }
};

const request = async (route, options = {}) => {
  try {
    const response = await fetch(`${apiBaseUrl}${route}`, options);
    const body = await response.json().catch(() => null);
    return { response, body };
  } catch {
    throw new Error('Could not reach the configured API');
  }
};

const login = async (email, password, label) => {
  if (!email || !password) throw new Error(`${label} seed credentials are not configured`);
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok || typeof body?.token !== 'string') {
    throw new Error(`${label} login failed with HTTP ${response.status}`);
  }
  return { token: body.token, userId: body.user?.id };
};

const authHeaders = (token) => ({ authorization: `Bearer ${token}` });

const hrLoginOk = await runTest('HR login setup', async () => {
  ({ token: hrToken } = await login(process.env.SEED_HR_EMAIL, process.env.SEED_HR_PASSWORD, 'HR'));
});
const employeeLoginOk = await runTest('Employee login setup', async () => {
  const employee = await login(
    process.env.SEED_EMPLOYEE_EMAIL,
    process.env.SEED_EMPLOYEE_PASSWORD,
    'Employee',
  );
  employeeToken = employee.token;
  employeeUserId = employee.userId;
});

const ensureAuditReader = async () => {
  if (auditReaderAvailable !== undefined) return auditReaderAvailable;
  if (!process.env.MONGO_URI) {
    auditReaderAvailable = false;
    return false;
  }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    auditReaderAvailable = true;
  } catch {
    auditReaderAvailable = false;
  }
  return auditReaderAvailable;
};

const getAuditCursor = async () => {
  if (!employeeUserId || !(await ensureAuditReader())) return null;
  try {
    const latest = await AuditLog.findOne({ userId: employeeUserId, feature: 'policy-ask' })
      .sort({ _id: -1 })
      .select('_id')
      .lean();
    return latest?._id || null;
  } catch {
    auditReaderAvailable = false;
    return null;
  }
};

const readTopAuditScore = async (cursor) => {
  if (!employeeUserId || !(await ensureAuditReader())) return null;
  const query = { userId: employeeUserId, feature: 'policy-ask' };
  if (cursor) query._id = { $gt: cursor };

  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const audit = await AuditLog.findOne(query)
        .sort({ _id: -1 })
        .select('metadata.topSimilarityScore')
        .lean();
      if (audit) {
        return Number.isFinite(audit.metadata?.topSimilarityScore)
          ? audit.metadata.topSimilarityScore
          : null;
      }
    } catch {
      auditReaderAvailable = false;
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
};

const runPolicyQuestion = async ({ label, question, expectedFound }) => {
  if (!employeeToken) throw new Error('Employee login setup failed');
  const auditCursor = await getAuditCursor();
  let result;
  try {
    result = await request('/api/policies/ask', {
      method: 'POST',
      headers: { ...authHeaders(employeeToken), 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  } finally {
    const topScore = await readTopAuditScore(auditCursor);
    console.log(`TOP RETRIEVAL SCORE ${label}: ${topScore === null ? 'unavailable' : topScore.toFixed(6)}`);
  }

  const { response, body } = result;
  if (!response.ok || body?.found !== expectedFound) {
    throw new Error(`Expected found=${expectedFound}, received HTTP ${response.status}`);
  }
  if (expectedFound && (!body?.answer || !Array.isArray(body.sources) || body.sources.length === 0)) {
    throw new Error('Expected a grounded answer with citations');
  }
  if (!expectedFound && (!Array.isArray(body.sources) || body.sources.length !== 0)) {
    throw new Error('Expected not-found with empty sources');
  }
};

const results = [];
results.push(await runTest('Unauthenticated policy ask returns 401', async () => {
  const { response } = await request('/api/policies/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'How many sick days do I get?' }),
  });
  if (response.status !== 401) throw new Error(`Expected 401, received ${response.status}`);
}));

results.push(await runTest('Employee policy upload returns 403', async () => {
  if (!employeeToken) throw new Error('Employee login setup failed');
  const { response } = await request('/api/policies', {
    method: 'POST',
    headers: authHeaders(employeeToken),
  });
  if (response.status !== 403) throw new Error(`Expected 403, received ${response.status}`);
}));

results.push(await runTest('HR uploads the sample policy', async () => {
  if (!hrToken) throw new Error('HR login setup failed');
  const fileBuffer = await readFile(samplePath).catch(() => {
    throw new Error('Sample policy file is missing at the configured project-relative path');
  });
  const filename = path.basename(samplePath);
  const title = `NivHR Policy Smoke Test - ${filename}`;
  const { response: listResponse, body: listBody } = await request('/api/policies', {
    headers: authHeaders(hrToken),
  });
  if (!listResponse.ok || !Array.isArray(listBody?.documents)) {
    throw new Error(`Could not inspect existing policy documents (HTTP ${listResponse.status})`);
  }

  for (const document of listBody.documents) {
    if (document.title === title && document.filename === filename) {
      const { response: deleteResponse } = await request(`/api/policies/${document.id}`, {
        method: 'DELETE',
        headers: authHeaders(hrToken),
      });
      if (!deleteResponse.ok) throw new Error('Could not replace the previous smoke-test document');
    }
  }

  const form = new FormData();
  const mimeType = path.extname(filename).toLowerCase() === '.pdf' ? 'application/pdf' : 'text/plain';
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  form.append('title', title);
  const { response, body } = await request('/api/policies', {
    method: 'POST',
    headers: authHeaders(hrToken),
    body: form,
  });
  if (response.status !== 201 || typeof body?.document?.id !== 'string') {
    throw new Error(`Upload failed with HTTP ${response.status}`);
  }
  smokeDocumentId = body.document.id;
}));

const policyQuestions = [
  { label: 'Sick leave days', question: 'How many sick leave days are available?', expectedFound: true },
  { label: 'Medical certificate requirement', question: 'Is a medical certificate required for sick leave?', expectedFound: true },
  { label: 'Annual leave carry-forward', question: 'Can annual leave be carried forward to the next year?', expectedFound: true },
  { label: 'Annual leave notice period', question: 'How much notice is required to apply for annual leave?', expectedFound: true },
  { label: 'Working hours', question: 'What are the standard working hours?', expectedFound: true },
  { label: 'Dress code on Mars', question: 'What is the dress code for employees working on Mars?', expectedFound: false },
  { label: 'Cryptocurrency trading policy', question: 'What is the company policy on cryptocurrency trading?', expectedFound: false },
];

for (const policyQuestion of policyQuestions) {
  results.push(await runTest(`${policyQuestion.label} returns found=${policyQuestion.expectedFound}`, () =>
    runPolicyQuestion(policyQuestion)));
}

results.push(await runTest('Employee can list policy documents', async () => {
  if (!employeeToken) throw new Error('Employee login setup failed');
  const { response, body } = await request('/api/policies', {
    headers: authHeaders(employeeToken),
  });
  if (!response.ok || !Array.isArray(body?.documents)) {
    throw new Error(`Policy list failed with HTTP ${response.status}`);
  }
}));

results.push(await runTest('Employee policy delete returns 403', async () => {
  if (!employeeToken) throw new Error('Employee login setup failed');
  const documentId = smokeDocumentId || '000000000000000000000000';
  const { response } = await request(`/api/policies/${documentId}`, {
    method: 'DELETE',
    headers: authHeaders(employeeToken),
  });
  if (response.status !== 403) throw new Error(`Expected 403, received ${response.status}`);
}));

const failedTests = results.filter((passed) => !passed).length;
if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
if (!hrLoginOk || !employeeLoginOk || failedTests > 0) process.exitCode = 1;
