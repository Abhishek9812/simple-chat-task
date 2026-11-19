import type { Request, Response } from 'express';
import type { z } from 'zod';

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: SuccessResponse<T> = { success: true, data };
  res.status(statusCode).json(body);
}

type RequestSchemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

type ParsedRequest<S extends RequestSchemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.infer<S[K]> : never;
};

/**
 * Validates the selected parts of a request against zod schemas and returns
 * them fully typed. A ZodError is thrown on failure and translated into a
 * 400 response by the error middleware.
 */
export function parseRequest<S extends RequestSchemas>(req: Request, schemas: S): ParsedRequest<S> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(schemas) as Array<keyof RequestSchemas>) {
    const schema = schemas[key];
    if (schema) {
      result[key] = schema.parse(req[key] ?? {});
    }
  }
  return result as ParsedRequest<S>;
}
