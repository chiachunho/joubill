"use client";

import { SWRConfig } from "swr";

import { tmaFetcher } from "@/lib/tma-fetch";

function on401Redirect(error: unknown) {
  if (typeof (error as Error)?.message === "string" && (error as Error).message.startsWith("401")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: tmaFetcher,
        revalidateOnFocus: false,
        keepPreviousData: true,
        dedupingInterval: 5000,
        onError: on401Redirect,
      }}
    >
      {children}
    </SWRConfig>
  );
}
