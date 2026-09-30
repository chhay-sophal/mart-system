export class HttpError extends Error {
  readonly status: number;
  /** Extra fields merged into the JSON error body, e.g. which items are out of stock. */
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message = "Bad request") => new HttpError(400, message);
export const unauthorized = (message = "Unauthorized") => new HttpError(401, message);
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message = "Conflict") => new HttpError(409, message);
export const tooManyRequests = (message = "Too many attempts") => new HttpError(429, message);
