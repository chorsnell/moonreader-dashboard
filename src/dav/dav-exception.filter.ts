import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * WebDAV clients expect plain-text errors, and a 401 must carry WWW-Authenticate so they
 * ask for the password.
 */
@Catch(HttpException)
export class DavExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    if (status === HttpStatus.UNAUTHORIZED) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Reading dashboard"');
    }
    res.status(status).type('text/plain; charset=utf-8').send(exception.message);
  }
}
