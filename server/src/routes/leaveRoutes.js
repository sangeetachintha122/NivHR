import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  applyForLeaveController,
  cancelMyLeaveController,
  decideLeaveController,
  getMyLeavesController,
  listAllLeavesController,
  reviewLeaveController,
} from '../controllers/leaveController.js';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';
import { createHttpError } from '../services/leaveService.js';

const router = Router();

const leaveReviewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(createHttpError(429, 'Too many AI leave reviews. Please try again later.')),
});

router.use(authenticate);
router.post('/', requireRole('employee'), applyForLeaveController);
router.get('/mine', requireRole('employee'), getMyLeavesController);
router.patch('/:id/cancel', requireRole('employee'), cancelMyLeaveController);
router.get('/', requireRole('hr'), listAllLeavesController);
router.patch('/:id/decision', requireRole('hr'), decideLeaveController);
router.post('/:id/ai-review', requireRole('hr'), leaveReviewRateLimit, reviewLeaveController);

export default router;
