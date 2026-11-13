import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { askAnalyticsController, getAnalyticsConversationController } from '../controllers/analyticsController.js';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';
import { createHttpError } from '../services/analyticsService.js';

const router = Router();

const analyticsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(createHttpError(429, 'Too many analytics questions. Please try again later.')),
});

router.use(authenticate);
router.get('/conversation/:id', requireRole('hr'), getAnalyticsConversationController);
router.post('/ask', requireRole('hr'), analyticsRateLimit, askAnalyticsController);

export default router;
