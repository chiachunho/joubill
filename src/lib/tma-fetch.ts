"use client";

/**
 * Mini App fetcher: attaches the current initData as a `tma` bearer.
 * Server side `getAuth(req)` parses this header and verifies the HMAC.
 *
 * The SDK is loaded via dynamic import so this module is safe to be
 * eagerly bundled into client chunks that Next renders on the server
 * during SSR (where `window` is undefined).
 */
export async function tmaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { default: WebApp } = await import("@twa-dev/sdk");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${WebApp.initData}`);

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}
