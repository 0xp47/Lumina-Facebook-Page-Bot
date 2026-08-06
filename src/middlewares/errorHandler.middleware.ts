import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: any
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || err.response?.status || 500;
  const message = err.message || 'Internal Server Error';
  const details = err.details || err.response?.data || null;

  logger.error(`Error processing request: ${message}`, {
    statusCode,
    details
  });

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      ...(details ? { details } : {})
    }
  });
}
