import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  currentUserController,
  loginController,
} from '../controllers/authController.js';
import authenticate from '../middleware/authenticate.js';
import { createHttpError } from '../services/authService.js';

const router = Router();

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(createHttpError(429, 'Too many login attempts. Please try again later.')),
});

router.post('/login', loginRateLimit, loginController);
router.get('/me', authenticate, currentUserController);

export default router;
