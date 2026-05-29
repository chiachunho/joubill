"use client";

import { SWRConfig } from "swr";

import { webFetcher } from "@/lib/web-fetch";

export function WebSWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: webFetcher,
        revalidateOnFocus: false,
        keepPreviousData: true,
        dedupingInterval: 5000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
