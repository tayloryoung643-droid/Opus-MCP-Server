import { Request, Response, NextFunction } from 'express';
import { unauthorized } from './errors.js';

export interface AuthenticatedRequest extends Request {
  authenticated?: boolean;
}

export function bearerAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Missing or invalid Authorization header'));
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.MCP_SERVICE_TOKEN;

  if (!expectedToken) {
    return next(unauthorized('MCP service not configured'));
  }

  if (token !== expectedToken) {
    return next(unauthorized('Invalid service token'));
  }

  req.authenticated = true;
  next();
}
