import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { appConfig, type AppConfigType } from './config/app.config';
import { basePathMiddleware } from './common/http/base-path.middleware';

/**
 * HTTP setup shared by main.ts and the end-to-end tests, so the tests run the app exactly
 * as it is deployed. The app must be created with { bodyParser: false }: uploads are
 * streamed straight to disk.
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<AppConfigType>(appConfig.KEY);
  app.disable('x-powered-by');
  app.use(basePathMiddleware(config.basePath));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  return app;
}
