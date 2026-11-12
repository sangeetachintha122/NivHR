export class AIProviderError extends Error {
  constructor(provider, category, httpStatus) {
    super('AI service unavailable');
    this.name = 'AIProviderError';
    this.provider = provider;
    this.category = category;
    this.httpStatus = httpStatus;
    this.statusCode = 503;
    this.code = 'AI_SERVICE_UNAVAILABLE';
  }
}
