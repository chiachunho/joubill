"use client";

import WebApp from "@twa-dev/sdk";

/**
 * Mini App fetcher: attaches the current initData as a `tma` bearer.
 * Server side `getAuth(req)` parses this header and verifies the HMAC.
 */
export async function tmaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${WebApp.initData}`);

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}
