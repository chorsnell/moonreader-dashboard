import type { NextFunction, Request, Response } from 'express';

/**
 * When a reverse proxy forwards /reading/... without stripping the prefix (BASE_PATH is
 * set), strip it here so the routes match either way, and send /reading to /reading/.
 *
 * Registered with app.use() before the router (see app.setup.ts), because it rewrites the
 * URL that routing then sees.
 */
export function basePathMiddleware(basePath: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!basePath) return next();
    const q = req.url.indexOf('?');
    const path = q < 0 ? req.url : req.url.slice(0, q);
    if (path === basePath && (req.method === 'GET' || req.method === 'HEAD')) {
      res.redirect(301, `${basePath}/`);
      return;
    }
    if (path === basePath || path.startsWith(`${basePath}/`)) {
      req.url = req.url.slice(basePath.length) || '/';
    }
    next();
  };
}
