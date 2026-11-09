import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  currentUserController,
  loginController,
} from '../controllers/authController.js';
import authenticate from '../middleware/authenticate.js';
import { createHttpError } from '../services/authService.js';

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
  handler: (_req, _res, next) =>
    next(createHttpError(429, 'Too many login attempts. Please try again later.')),
});

router.post('/login', loginRateLimit, loginController);
router.get('/me', authenticate, currentUserController);

export default router;
