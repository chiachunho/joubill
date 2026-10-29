import { useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { vi } from "vitest";

import type { RawRequest } from "./base-query";
import { makeStore, type StoreOptions } from "./store";

/** A route that answers with this status instead of 200. */
export class Failure {
  constructor(
    readonly status: number,
    readonly body: unknown = {},
  ) {}
}

type Handler = Failure | ((init: RequestInit | undefined) => unknown) | object;

/**
 * A stand-in for the platform's authenticated request: `routes` maps a path (query
 * string included) to the JSON it answers with, a `Failure`, or a function of the
 * request. Anything unlisted answers 500, so a test cannot pass by accident on a
 * request it never meant to allow. A `vi.fn`, so calls can be asserted.
 */
export function fakeRequest(routes: Record<string, Handler>) {
  return vi.fn<RawRequest>(async (path, init) => {
    if (!(path in routes)) {
      return new Response(JSON.stringify({ error: `unexpected request: ${path}` }), {
        status: 500,
      });
    }
    const handler = routes[path];
    const value = typeof handler === "function" ? handler(init) : handler;
    if (value instanceof Failure) {
      return new Response(JSON.stringify(value.body), { status: value.status });
    }
    return new Response(JSON.stringify(value), { status: 200 });
  });
}

/** Renders `children` against a fresh store whose requests go through `request`. */
export function StoreWrapper({
  request,
  options,
  children,
}: {
  request: RawRequest;
  options?: StoreOptions;
  children: ReactNode;
}) {
  const [store] = useState(() => makeStore(request, options));
  return <Provider store={store}>{children}</Provider>;
}
