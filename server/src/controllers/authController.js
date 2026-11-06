import { z } from 'zod';
import { createHttpError, getSafeUser, login } from '../services/authService.js';

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1),
  })
  .strict();

export const loginController = async (req, res, next) => {
  const parsedBody = loginSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return next(createHttpError(400, 'Invalid request body'));
  }

  try {
    const result = await login(parsedBody.data);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const currentUserController = (req, res) =>
  res.status(200).json({ user: getSafeUser(req.currentUser) });
