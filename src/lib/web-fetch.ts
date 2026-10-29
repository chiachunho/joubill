"use client";

/** A request carrying the session cookie. Returns the raw Response. */
export async function webRawFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  return fetch(path, { ...init, credentials: "include", headers });
}
