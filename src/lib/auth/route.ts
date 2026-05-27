import { NextResponse } from "next/server";

import { AuthError } from "./errors";

/**
 * Wraps a route handler so AuthError surfaces as the right HTTP status.
 * Other errors fall through to Next's default 500 handler.
 */
export function withAuth<TArgs extends unknown[]>(
  handler: (req: Request, ...args: TArgs) => Promise<Response>,
): (req: Request, ...args: TArgs) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  };
}
