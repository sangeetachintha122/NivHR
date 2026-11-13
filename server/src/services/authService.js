import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { recordActivityEvent } from './activityEventService.js';

const validRoles = new Set(['hr', 'employee']);
const invalidLoginHash = bcrypt.hash('nivhr-invalid-login-placeholder', 10);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required to run the authentication service');
  }
  return secret;
};

export const assertJwtSecret = () => {
  getJwtSecret();
};

export const getSafeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  department: user.department,
  joinDate: user.joinDate,
  isActive: user.isActive ?? true,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const login = async ({ email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
  const passwordHash = user?.passwordHash ?? (await invalidLoginHash);
  const passwordMatches = await bcrypt.compare(password, passwordHash);

  if (!user || user.isActive === false || !passwordMatches) {
    await recordActivityEvent({ eventType: 'login_failed' });
    throw createHttpError(401, 'Invalid email or password');
  }

  if (!validRoles.has(user.role)) {
    throw new Error('User has an unsupported role');
  }

  const token = jwt.sign(
    { role: user.role },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      subject: user._id.toString(),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    },
  );

  await recordActivityEvent({
    eventType: 'login_success',
    actorUserId: user._id,
    subjectUserId: user._id,
    department: user.department,
  });

  return { token, user: getSafeUser(user) };
};

export const verifyToken = (token) =>
  jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });

export const findActiveUserById = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) return null;
  const user = await User.findById(userId);
  return user && user.isActive !== false ? user : null;
};

export { createHttpError };
