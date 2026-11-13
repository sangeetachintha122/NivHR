import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  currentUserController,
  loginController,
  logoutController,
} from '../controllers/authController.js';
import authenticate from '../middleware/authenticate.js';
import { createHttpError } from '../services/authService.js';
import { recordActivityEvent } from '../services/activityEventService.js';

const router = Router();

const configuredWindowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS);
const configuredLimit = Number(process.env.LOGIN_RATE_LIMIT_MAX);

const loginRateLimit = rateLimit({
  windowMs:
    Number.isSafeInteger(configuredWindowMs) && configuredWindowMs > 0
      ? configuredWindowMs
      : 15 * 60 * 1000,
  limit:
    Number.isSafeInteger(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : 20,
  skipSuccessfulRequests: true,
  skip: () => process.env.NODE_ENV === 'development',
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (_req, _res, next) => {
    await recordActivityEvent({ eventType: 'login_rate_limited' });
    return next(createHttpError(429, 'Too many login attempts. Please try again later.'));
  },
});

router.post('/login', loginRateLimit, loginController);
router.get('/me', authenticate, currentUserController);
router.post('/logout', authenticate, logoutController);

export default router;
