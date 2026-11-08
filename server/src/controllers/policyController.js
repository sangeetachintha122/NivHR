import { z } from 'zod';
import {
  answerPolicyQuestion,
  createHttpError,
  deletePolicyDocument,
  ingestPolicyDocument,
  listPolicyDocuments,
} from '../services/policyService.js';

const uploadBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
}).strict();

const questionSchema = z.object({
  question: z.string().trim().min(1).max(500),
}).strict();

export const uploadPolicyController = async (req, res, next) => {
  const parsed = uploadBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return next(createHttpError(400, 'Invalid policy document metadata'));
  if (!req.file) return next(createHttpError(400, 'A policy file is required'));

  try {
    const document = await ingestPolicyDocument({
      file: req.file,
      title: parsed.data.title,
      uploadedBy: req.user.id,
    });
    return res.status(201).json({ document });
  } catch (error) {
    return next(error);
  }
};

export const listPoliciesController = async (_req, res, next) => {
  try {
    const documents = await listPolicyDocuments();
    return res.status(200).json({ documents });
  } catch (error) {
    return next(error);
  }
};

export const deletePolicyController = async (req, res, next) => {
  try {
    const result = await deletePolicyDocument(req.params.id);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const askPolicyController = async (req, res, next) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return next(createHttpError(400, 'Invalid policy question'));

  try {
    const result = await answerPolicyQuestion({ userId: req.user.id, question: parsed.data.question });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
