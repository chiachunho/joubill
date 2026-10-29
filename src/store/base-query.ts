import type { BaseQueryFn } from "@reduxjs/toolkit/query";

import type { ApiError } from "@/lib/api-error";

/** A request with the platform's credentials attached: the `tma` header or the session cookie. */
export type RawRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** What the store hands every thunk and query as `extra`. */
export type StoreExtra = { rawRequest: RawRequest };

export type ApiArgs = {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
};

/**
 * The one place a request is made. It runs through whichever `RawRequest` the
 * store was built with, so the Mini App and the Web App share every endpoint and
 * differ only in how a request authenticates.
 */
export const apiBaseQuery: BaseQueryFn<ApiArgs, unknown, ApiError> = async (args, api) => {
  const { rawRequest } = api.extra as StoreExtra;
  const init: RequestInit = { method: args.method ?? "GET" };
  if (args.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(args.body);
  }

  let res: Response;
  try {
    res = await rawRequest(args.url, init);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: { status: 0, data: null, message: `0 ${args.url}: ${message}` } };
  }

  const text = await res.text().catch(() => "");
  let data: unknown = null;
  if (text !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    return { error: { status: res.status, data, message: `${res.status} ${args.url}: ${text}` } };
  }
  return { data };
};
