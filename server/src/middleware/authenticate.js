import {
  createHttpError,
  findActiveUserById,
  getSafeUser,
  verifyToken,
} from '../services/authService.js';

const unauthorized = () => createHttpError(401, 'Authentication required');

const authenticate = async (req, _res, next) => {
  const authorization = req.get('authorization');
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+([^\s]+)$/i)
    : null;

  if (!match) return next(unauthorized());

  let payload;
  try {
    payload = verifyToken(match[1]);
  } catch {
    return next(unauthorized());
  }

  if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string') {
    return next(unauthorized());
  }

  try {
    const user = await findActiveUserById(payload.sub);
    if (!user) return next(unauthorized());

    req.currentUser = user;
    req.user = {
      id: user._id.toString(),
      role: user.role,
      ...getSafeUser(user),
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

export default authenticate;
