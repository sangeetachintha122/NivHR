import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  askPolicyController,
  deletePolicyController,
  listPoliciesController,
  uploadPolicyController,
} from '../controllers/policyController.js';
import authenticate from '../middleware/authenticate.js';
import uploadPolicyFile from '../middleware/policyUpload.js';
import requireRole from '../middleware/requireRole.js';
import { createHttpError } from '../services/policyService.js';

const router = Router();

const askRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(createHttpError(429, 'Too many policy questions. Please try again later.')),
});

router.use(authenticate);
router.post('/ask', askRateLimit, askPolicyController);
router.post('/', requireRole('hr'), uploadPolicyFile, uploadPolicyController);
router.get('/', listPoliciesController);
router.delete('/:id', requireRole('hr'), deletePolicyController);

export default router;
