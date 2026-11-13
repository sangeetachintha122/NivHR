const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, options);

  const requestBody = JSON.parse(options.body);
  const prompt = requestBody.contents?.[0]?.parts?.[0]?.text || '';
  const normalizedPrompt = prompt.toLocaleLowerCase('en');
  const currentQuestionText = prompt.match(/Current HR question \(untrusted\): (.+)$/m)?.[1] || '""';
  const currentQuestion = JSON.parse(currentQuestionText);
  if (!normalizedPrompt.includes('you are the question planner')) {
    throw new Error('Unexpected Gemini request outside validated analytics planning.');
  }
  const attendanceCapability = [
    ['attendance summary scoped', 'attendance_summary'],
    ['late arrivals scoped', 'late_arrivals'],
    ['incomplete checkouts scoped', 'incomplete_checkouts'],
    ['attendance trend scoped', 'attendance_trend'],
    ['department attendance scoped', 'attendance_by_department'],
    ['attendance combined filters scoped', 'attendance_summary'],
    ['attendance mismatched filters scoped', 'attendance_summary'],
  ].find(([phrase]) => normalizedPrompt.includes(phrase));
  const generated = normalizedPrompt.includes('you are the question planner')
    ? /weather|ignore all previous instructions|db\.dropdatabase/.test(normalizedPrompt)
      ? {
        status: 'unsupported',
        message: 'This request is outside supported NivHR analytics.',
      }
      : attendanceCapability
        ? {
          status: 'ready',
          operations: [{
            capability: attendanceCapability[1],
            range: { kind: 'relative', period: 'today' },
            filters: {
              department: process.env.ANALYTICS_SMOKE_DEPARTMENT,
              ...(attendanceCapability[0] === 'attendance combined filters scoped'
                ? { employee: currentQuestion.match(/employee_ref_\d+/i)?.[0] }
                : {}),
              ...(attendanceCapability[0] === 'attendance mismatched filters scoped'
                ? { employee: currentQuestion.match(/employee_ref_\d+/i)?.[0] }
                : {}),
            },
            limit: 20,
          }],
        }
      : {
        status: 'ready',
        operations: [{
          capability: 'employee_count_by_department',
          filters: {},
          limit: 20,
        }],
      }
    : { status: 'unsupported', message: 'This request is outside supported NivHR analytics.' };

  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
