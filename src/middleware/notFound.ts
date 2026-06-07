/**
 * notFound middleware
 *
 * Catches any request that did not match a registered route and responds
 * with a standard 404 NOT_FOUND error body.
 *
 * Must be mounted AFTER all route handlers.
 */

import { Request, Response } from 'express';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
