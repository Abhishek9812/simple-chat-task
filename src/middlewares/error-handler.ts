import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ErrorBody = {
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

const isBodyParserError = (err: unknown): err is { type: string; status: number } =>
  typeof err === 'object' &&
  err !== null &&
  'type' in err &&
  'status' in err &&
  typeof (err as { status: unknown }).status === 'number' &&
  (err as { status: number }).status < 500;

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let status = 500;
    let body: ErrorBody = {
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' },
    };

    if (err instanceof ZodError) {
      status = 400;
      body = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    } else if (err instanceof AppError) {
      status = err.statusCode;
      body = {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
        },
      };
    } else if (isBodyParserError(err)) {
      status = err.status;
      body = {
        success: false,
        error: {
          code: err.type === 'entity.parse.failed' ? 'INVALID_JSON' : 'BAD_REQUEST',
          message:
            err.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Invalid request body',
        },
      };
    }

    if (status >= 500) {
      logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    }

    res.status(status).json(body);
  };
}
