export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details })
      }
    };
  }
}

export function unauthorized(message: string = 'Unauthorized'): HttpError {
  return new HttpError(401, 'UNAUTHORIZED', message);
}

export function badRequest(message: string, details?: any): HttpError {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function internalError(message: string = 'Internal server error'): HttpError {
  return new HttpError(500, 'INTERNAL_ERROR', message);
}

export function configError(message: string): HttpError {
  return new HttpError(500, 'CONFIG_ERROR', message);
}

export function integrationError(code: string, message: string): HttpError {
  return new HttpError(401, code, message);
}
