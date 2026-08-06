import { Request, Response, NextFunction } from 'express';

export function rawBodySaver(
  req: Request,
  _res: Response,
  buf: Buffer,
  encoding: string
): void {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}
