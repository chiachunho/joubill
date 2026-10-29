"use client";

import { useState } from "react";
import { Provider } from "react-redux";

import { tmaRawFetch } from "@/lib/tma-fetch";
import { makeStore } from "@/store/store";

/** The Mini App's store: every request carries the `tma` initData header. */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => makeStore(tmaRawFetch));
  return <Provider store={store}>{children}</Provider>;
}
