"use client";

// initData is set once when the Telegram Mini App launches and never changes
// within a session; caching it avoids a dynamic import on every fetch.
let cachedInitData: string | null = null;

async function getInitData(): Promise<string> {
  if (cachedInitData !== null) return cachedInitData;
  const { default: WebApp } = await import("@twa-dev/sdk");
  cachedInitData = WebApp.initData;
  return cachedInitData;
}

export async function tmaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const initData = await getInitData();

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${initData}`);

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const tmaFetcher = (path: string) => tmaFetch(path);

/** The raw-Response form of tmaFetch: injects the Telegram Mini App Authorization header instead of cookies. */
export async function tmaRawFetch(path: string, init?: RequestInit): Promise<Response> {
  const { default: WebApp } = await import("@twa-dev/sdk");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${WebApp.initData}`);
  return fetch(path, { ...init, headers });
}
