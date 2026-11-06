import { createHttpError } from '../services/authService.js';

const supportedRoles = new Set(['hr', 'employee']);

export const requireRole = (...roles) => {
  if (roles.some((role) => !supportedRoles.has(role))) {
    throw new TypeError('requireRole supports only hr and employee roles');
  }

  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(createHttpError(403, 'Forbidden'));
    }
    return next();
  };
};

export default requireRole;
