import 'dotenv/config';

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const results = [];
const run = async (label, operation) => {
  try { await operation(); console.log(`PASS ${label}`); results.push(true); }
  catch (error) { console.log(`FAIL ${label}: ${error.message}`); results.push(false); }
};
const request = async (path, token, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { response, body: await response.json().catch(() => null) };
};
const login = async (email, password) => {
  const { response, body } = await request('/api/auth/login', null, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Login failed with HTTP ${response.status}`);
  return body.token;
};

let hrToken;
let employeeToken;
let pending;
let approved;
let rejected;
let beforeBalance;

await run('HR and employee login setup', async () => {
  if (!process.env.SEED_HR_EMAIL || !process.env.SEED_HR_PASSWORD || !process.env.SEED_EMPLOYEE_EMAIL || !process.env.SEED_EMPLOYEE_PASSWORD) throw new Error('Seed credentials are not configured');
  [hrToken, employeeToken] = await Promise.all([
    login(process.env.SEED_HR_EMAIL, process.env.SEED_HR_PASSWORD),
    login(process.env.SEED_EMPLOYEE_EMAIL, process.env.SEED_EMPLOYEE_PASSWORD),
  ]);
});

await run('Find smoke leave requests', async () => {
  if (!hrToken) throw new Error('Login setup failed');
  const { response, body } = await request('/api/leaves?limit=100', hrToken);
  if (!response.ok) throw new Error(`Leave list failed with HTTP ${response.status}`);
  const all = body.leaves || [];
  const mine = await request('/api/leaves/mine?limit=100', employeeToken);
  const employeeId = mine.body?.leaves?.[0]?.employeeId;
  pending = all.find((leave) => leave.status === 'pending' && leave.employeeId === employeeId);
  approved = all.find((leave) => leave.status === 'approved');
  rejected = all.find((leave) => leave.status === 'rejected');
  if (!pending || !approved || !rejected) throw new Error('Need seed-employee pending and existing approved and rejected requests');
  beforeBalance = mine.body.balances;
});

await run('Unauthenticated review returns 401', async () => {
  const { response } = await request('/api/leaves/000000000000000000000000/ai-review', null, { method: 'POST' });
  if (response.status !== 401) throw new Error(`Received HTTP ${response.status}`);
});
await run('Employee review returns 403', async () => {
  if (!employeeToken || !pending) throw new Error('Smoke data unavailable');
  const { response } = await request(`/api/leaves/${pending.id}/ai-review`, employeeToken, { method: 'POST' });
  if (response.status !== 403) throw new Error(`Received HTTP ${response.status}`);
});
await run('Invalid ID returns 400', async () => {
  const { response } = await request('/api/leaves/nope/ai-review', hrToken, { method: 'POST' });
  if (response.status !== 400) throw new Error(`Received HTTP ${response.status}`);
});
await run('Missing leave returns 404', async () => {
  const { response } = await request('/api/leaves/000000000000000000000000/ai-review', hrToken, { method: 'POST' });
  if (response.status !== 404) throw new Error(`Received HTTP ${response.status}`);
});
for (const [label, leave] of [['Approved leave is refused', approved], ['Rejected leave is refused', rejected]]) {
  await run(label, async () => {
    if (!leave || !hrToken) throw new Error('Smoke data unavailable');
    const { response } = await request(`/api/leaves/${leave.id}/ai-review`, hrToken, { method: 'POST' });
    if (response.status !== 409) throw new Error(`Received HTTP ${response.status}`);
  });
}
await run('HR review returns validated advisory analysis without changing leave or balance', async () => {
  if (!pending || !hrToken || !employeeToken) throw new Error('Smoke data unavailable');
  const { response, body } = await request(`/api/leaves/${pending.id}/ai-review`, hrToken, { method: 'POST' });
  const analysis = body?.analysis;
  if (!response.ok || !analysis || !['appears_compliant', 'needs_attention', 'insufficient_information'].includes(analysis.recommendation) || !Array.isArray(analysis.policyChecks) || !analysis.disclaimer) throw new Error(`Invalid review response (HTTP ${response.status})`);
  const afterLeave = await request(`/api/leaves?status=pending&limit=100`, hrToken);
  if (!afterLeave.body?.leaves?.some((leave) => leave.id === pending.id)) throw new Error('Leave status changed');
  const afterMine = await request('/api/leaves/mine?limit=100', employeeToken);
  if (JSON.stringify(afterMine.body?.balances) !== JSON.stringify(beforeBalance)) throw new Error('Leave balance changed');
});

if (results.some((passed) => !passed)) process.exitCode = 1;
