"use client";

import { SWRConfig } from "swr";

import { isUnauthorizedError, loginUrl, WEB_LOGIN_PATH } from "@/lib/auth-redirect";
import { webFetcher } from "@/lib/web-fetch";

function on401Redirect(error: unknown) {
  if (isUnauthorizedError(error)) {
    window.location.href = loginUrl(
      WEB_LOGIN_PATH,
      window.location.pathname,
      window.location.search,
    );
  }
}

export function WebSWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: webFetcher,
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
