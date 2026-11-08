const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, options);

  if (url.pathname.endsWith(':batchEmbedContents')) {
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      embeddings: body.requests.map(() => ({ values: [0.5, 0.5, 0.5] })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  const text = JSON.stringify({
    summary: 'Policy evidence is not configured in this isolated smoke test.',
    recommendation: 'insufficient_information',
    policyChecks: [{
      rule: 'Policy evidence availability',
      status: 'unknown',
      explanation: 'No policy evidence fixture is included in this test.',
      citations: [],
    }],
    considerations: [],
    missingInformation: ['Relevant policy evidence.'],
    suggestedQuestions: [],
    disclaimer: 'AI-generated advisory analysis. HR must make the final decision.',
  });
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
