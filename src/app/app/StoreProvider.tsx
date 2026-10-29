"use client";

import { useState } from "react";
import { Provider } from "react-redux";

import { loginUrl, WEB_LOGIN_PATH } from "@/lib/auth-redirect";
import { webRawFetch } from "@/lib/web-fetch";
import { makeStore } from "@/store/store";

function redirectToLogin() {
  window.location.href = loginUrl(WEB_LOGIN_PATH, window.location.pathname, window.location.search);
}

/** The Web App's store: requests ride the session cookie, and a 401 sends the viewer to login. */
export function WebStoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => makeStore(webRawFetch, { onUnauthorized: redirectToLogin }));
  return <Provider store={store}>{children}</Provider>;
}
