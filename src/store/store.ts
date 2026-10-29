import { configureStore, isRejectedWithValue, type Middleware } from "@reduxjs/toolkit";

import { isUnauthorizedError } from "@/lib/auth-redirect";

import { api } from "./api";
import type { RawRequest, StoreExtra } from "./base-query";

export type StoreOptions = {
  /** Called when a request fails with 401 (the Web App sends the viewer to login). */
  onUnauthorized?: () => void;
};

/**
 * One store per app, built with that app's authenticated request. The api
 * definition is shared; only `rawRequest` differs, and it arrives through the
 * thunk `extra` so a route's bundle carries only its own platform's fetcher.
 */
export function makeStore(rawRequest: RawRequest, options: StoreOptions = {}) {
  const extra: StoreExtra = { rawRequest };

  const unauthorized: Middleware = () => (next) => (action) => {
    if (isRejectedWithValue(action) && isUnauthorizedError(action.payload)) {
      options.onUnauthorized?.();
    }
    return next(action);
  };

  return configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: extra } }).concat(api.middleware, unauthorized),
  });
}

export type AppStore = ReturnType<typeof makeStore>;
