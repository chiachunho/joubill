"use client";

export async function webFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const res = await fetch(path, { ...init, credentials: "include", headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const webFetcher = (path: string) => webFetch(path);

/** Like webFetch but returns the raw Response so callers can check res.ok themselves. */
export async function webRawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  return fetch(path, { ...init, credentials: "include", headers });
}

/** Like webRawFetch but injects the Telegram Mini App Authorization header instead of cookies. */
export async function tmaRawFetch(path: string, init?: RequestInit): Promise<Response> {
  const { default: WebApp } = await import("@twa-dev/sdk");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${WebApp.initData}`);
  return fetch(path, { ...init, headers });
}
