import { performance } from 'node:perf_hooks';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import { generateJson } from './aiService.js';
import { getConversationContext, loadAnalyticsConversation, saveAnalyticsTurn } from './analyticsConversationService.js';
import {
  AnalyticsClarificationError,
  executeAnalyticsPlan,
} from './analyticsQueryService.js';
import {
  buildAnalyticsPlanPrompt,
  validateAnalyticsPlanOrRecover,
} from './analyticsPlanService.js';
import { anonymizeAnalyticsInputs, restoreAnalyticsEmployeeReferences } from './analyticsPrivacyService.js';

const EXAMPLE_QUESTIONS = Object.freeze([
  'How many active employees are in each department?',
  'Who was late this month and which department had the most late arrivals?',
  'Compare this month’s attendance and approved leave by department.',
  'How many failed login attempts occurred this month?',
  'Who created or updated employee records last week?',
]);

const missingDataPattern = /\bdesignation\b|\b(?:before|prior to) event tracking\b|\bcomplete (?:historical )?(?:activity|action) history\b/i;
const MAX_ANALYTICS_EMPLOYEES = 10000;

export const UNSUPPORTED_RESPONSE = Object.freeze({
  supported: false,
  message: 'I could not safely map that request to stored NivHR analytics. Try asking about employees, attendance, leave, or department capacity.',
  examples: EXAMPLE_QUESTIONS,
});

export const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const recordAnalyticsAudit = async ({ userId, intent, status, startedAt }) => {
  try {
    await AuditLog.create({
      userId,
      feature: 'analytics',
      intent: intent || 'unavailable',
      status,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  } catch {
    console.error('Analytics audit logging failed.');
  }
};

const publicResult = ({ groups: _groups, _activityMetadata: _metadata, ...result }) => result;

export const deterministicAnalyticsAnswer = (results) =>
  results.map(({ title, summary }) => `${title}: ${summary}`).join(' ');

const notAvailable = (message, state = 'unavailable') => ({
  supported: false,
  state,
  message,
  examples: EXAMPLE_QUESTIONS,
});

const answerAnalyticsQuestionCore = async ({ userId, question, now = new Date(), conversationHistory = [] }) => {
  const startedAt = performance.now();
  let intent = 'question-planning';
  let auditStatus = 'error';
  try {
    // These data categories are not available in the current database schema.
    // This guard prevents a planner mistake from answering them with unrelated records.
    if (missingDataPattern.test(question)) {
      auditStatus = 'unavailable';
      return notAvailable('NivHR does not store employee designation, and activity from before event tracking began cannot be reconstructed.');
    }

    const employeeDirectory = await User.find({ role: 'employee' })
      .select('_id name email')
      .sort({ _id: 1 })
      .limit(MAX_ANALYTICS_EMPLOYEES + 1)
      .lean();
    if (employeeDirectory.length > MAX_ANALYTICS_EMPLOYEES) {
      throw new AnalyticsClarificationError('There are too many employee records to safely prepare this analytics question. Please narrow the request or contact an administrator.');
    }
    // Keep prior user questions for follow-up context. Assistant replies can contain database labels,
    // so they are intentionally not fed back into Gemini.
    const priorUserQuestions = conversationHistory.filter(({ role }) => role === 'user');
    const anonymized = anonymizeAnalyticsInputs(question, priorUserQuestions, employeeDirectory);
    const rawPlan = await generateJson(buildAnalyticsPlanPrompt(anonymized.question, now, anonymized.history));
    const validatedPlan = validateAnalyticsPlanOrRecover(rawPlan, question);
    const plan = restoreAnalyticsEmployeeReferences(validatedPlan, anonymized.employeeNames);
    if (!plan) {
      auditStatus = 'unsupported';
      return UNSUPPORTED_RESPONSE;
    }
    if (plan.status !== 'ready') {
      auditStatus = plan.status;
      const safeMessages = {
        clarification: 'Please clarify which stored HR information or time period you want to analyze.',
        unavailable: 'That information is not available in the stored NivHR records.',
        unsupported: UNSUPPORTED_RESPONSE.message,
      };
      return notAvailable(safeMessages[plan.status] || UNSUPPORTED_RESPONSE.message, plan.status);
    }

    const computedResults = await executeAnalyticsPlan(plan, { now });
    if (!computedResults.length) {
      auditStatus = 'unsupported';
      return UNSUPPORTED_RESPONSE;
    }
    intent = computedResults.length === 1 ? computedResults[0].capability : 'multi-operation';

    const answer = deterministicAnalyticsAnswer(computedResults);

    const results = computedResults.map(publicResult);
    auditStatus = 'success';
    return {
      supported: true,
      intent,
      answer,
      title: results[0].title,
      summary: answer,
      chart: results[0].chart,
      table: results[0].table,
      results,
    };
  } catch (error) {
    if (error instanceof AnalyticsClarificationError) {
      auditStatus = 'clarification';
      return notAvailable('Please clarify which stored HR information or time period you want to analyze.', 'clarification');
    }
    if (error?.statusCode === 400 || error?.statusCode === 422) {
      auditStatus = 'unsupported';
      return UNSUPPORTED_RESPONSE;
    }
    throw error;
  } finally {
    void recordAnalyticsAudit({ userId, intent, status: auditStatus, startedAt });
  }
};

export const answerAnalyticsQuestion = async ({ userId, question, conversationId, now = new Date() }) => {
  const conversation = await loadAnalyticsConversation({ userId, conversationId });
  const history = getConversationContext(conversation.messages);
  const result = await answerAnalyticsQuestionCore({ userId, question, now, conversationHistory: history });
  const answer = result.supported ? result.answer : result.message;
  let conversationHistory = history;
  try {
    conversationHistory = await saveAnalyticsTurn(conversation, question, answer, now);
  } catch {
    console.error('Analytics conversation history could not be saved.');
  }
  return {
    ...result,
    conversationId: conversation._id.toString(),
    conversationHistory,
  };
};
