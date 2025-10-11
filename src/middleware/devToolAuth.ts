import { NextFunction, Request, Response } from 'express';

export function devToolAuth(req: Request, res: Response, next: NextFunction) {
  const devKey = process.env.DEV_LOCAL_TOOL_KEY;
  
  if (!devKey) {
    return res.status(500).json({ 
      error: { 
        code: 'CONFIG_ERROR',
        message: 'DEV_LOCAL_TOOL_KEY not set' 
      } 
    });
  }
  
  const auth = req.header('authorization') || '';
  
  if (auth !== `Bearer ${devKey}`) {
    return res.status(401).json({ 
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing authorization header'
      }
    });
  }
  
  next();
}
