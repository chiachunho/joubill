import { NextResponse } from "next/server";

import { HttpError, TooManyRequestsError } from "./errors";

/**
 * Wraps a route handler so an HttpError (AuthError, BadRequestError, …) surfaces as
 * its HTTP status.
 * Other errors fall through to Next's default 500 handler.
 */
export function withAuth<TArgs extends unknown[]>(
  handler: (req: Request, ...args: TArgs) => Promise<Response>,
): (req: Request, ...args: TArgs) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof HttpError) {
        const headers =
          err instanceof TooManyRequestsError
            ? { "Retry-After": String(err.retryAfter) }
            : undefined;
        return NextResponse.json({ error: err.message }, { status: err.status, headers });
      }
      throw err;
    }
  };
}
