/** An error a route handler throws to answer with `status`; `withAuth` turns it into JSON. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class AuthError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "AuthError";
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = "unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = "forbidden") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "bad request") {
    super(400, message);
    this.name = "BadRequestError";
  }
}

/** Over a rate limit. `retryAfter` (seconds) becomes the `Retry-After` header, not the body. */
export class TooManyRequestsError extends HttpError {
  constructor(
    message: string,
    public readonly retryAfter: number,
  ) {
    super(429, message);
    this.name = "TooManyRequestsError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "not found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}
