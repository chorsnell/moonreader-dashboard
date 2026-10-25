import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { appConfig, type AppConfigType } from './config/app.config';
import { basePathMiddleware } from './common/http/base-path.middleware';

/**
 * HTTP setup shared by main.ts and the end-to-end tests, so the tests run the app exactly
 * as it is deployed. The app must be created with { bodyParser: false }: uploads and WebDAV
 * are streamed straight to disk, so only the small JSON bodies under /api are parsed, and
 * only when sent as application/json (which other sites can't do without a CORS preflight).
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<AppConfigType>(appConfig.KEY);
  app.disable('x-powered-by');
  app.use(basePathMiddleware(config.basePath));
  const smallJson = json({ limit: '4kb', type: 'application/json' });
  app.use('/api', (req: Request, res: Response, next: NextFunction) =>
    // the KOReader plugin's bodies are large; its controller reads them after checking the token
    req.path.startsWith('/koreader/') ? next() : smallJson(req, res, next),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  return app;
}
