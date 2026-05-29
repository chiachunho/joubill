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
