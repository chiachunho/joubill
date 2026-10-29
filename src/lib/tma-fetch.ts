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

/** A request with the Telegram Mini App Authorization header instead of cookies. Returns the raw Response. */
export async function tmaRawFetch(path: string, init?: RequestInit): Promise<Response> {
  const initData = await getInitData();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${initData}`);
  return fetch(path, { ...init, headers });
}
