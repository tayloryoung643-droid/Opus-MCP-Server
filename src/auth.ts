import { Request, Response, NextFunction } from 'express';
import { unauthorized } from './errors.js';
import { CONFIG } from './config.js';

export interface AuthenticatedRequest extends Request {
  authenticated?: boolean;
}

export function bearerAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid Authorization header'));
  }

  const token = authHeader.substring(7);

  if (token !== CONFIG.TOKEN) {
    return next(unauthorized('Invalid service token'));
  }

  req.authenticated = true;
  next();
}
