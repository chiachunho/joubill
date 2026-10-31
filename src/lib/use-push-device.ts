"use client";

import { useCallback, useEffect, useState } from "react";

import { pushSupport, type PushSupport, type PwaEnv } from "@/lib/pwa";
import {
  useDeletePushSubscriptionMutation,
  useGetPushSubscriptionsQuery,
  useSavePushSubscriptionMutation,
} from "@/store/api";

/**
 * This browser's push state and the two actions on it (issue #67), shared by 個人設定 → 通知
 * and the group page's card so they turn notifications on the same way.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export type EnableResult = "on" | "denied" | "dismissed" | "failed";

export type PushDevice = {
  support: PushSupport;
  /** The server has VAPID keys and this build has the public one. False hides everything. */
  configured: boolean;
  /** Null where there is no Notification API. */
  permission: NotificationPermission | null;
  /** This browser's endpoint while it is subscribed. */
  endpoint: string | null;
  /** Still reading the browser's subscription or the server's answer. */
  loading: boolean;
  /**
   * Asks for permission and subscribes. Call it straight from a tap, before anything else is
   * awaited: iOS refuses `requestPermission` outside a user gesture.
   */
  enable: () => Promise<EnableResult>;
  disable: () => Promise<boolean>;
};

export function usePushDevice(env: PwaEnv): PushDevice {
  const support = pushSupport(env);
  // Read even where push can't work yet (an iPhone tab): an unconfigured server hides the
  // section there too, instead of pointing at a home screen that wouldn't help.
  const { data: server, isLoading: serverLoading } = useGetPushSubscriptionsQuery();
  const [save] = useSavePushSubscriptionMutation();
  const [remove] = useDeletePushSubscriptionMutation();
  const configured = !!VAPID_PUBLIC_KEY && server?.configured === true;

  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(support === "supported");

  useEffect(() => {
    if (support !== "supported") return;
    setPermission(Notification.permission);
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (cancelled) return;
        setEndpoint(sub?.endpoint ?? null);
      } catch {
        // no registration yet: not subscribed
      } finally {
        if (!cancelled) setBrowserLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [support]);

  // The browser still holds a subscription: send it again, so a server copy deleted after a
  // 410, or one owned by whoever used this browser before, points back at this account.
  useEffect(() => {
    if (!configured || !endpoint) return;
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      const json = sub?.toJSON();
      if (json?.endpoint && json.keys?.p256dh && json.keys.auth) {
        await save({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
      }
    })().catch(() => {});
  }, [configured, endpoint, save]);

  const enable = useCallback(async (): Promise<EnableResult> => {
    if (support !== "supported" || !configured) return "failed";
    // First, while the tap still counts as a user gesture.
    const result =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    if (result === "denied") return "denied";
    if (result !== "granted") return "dismissed";
    try {
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
        }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return "failed";
      await save({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }).unwrap();
      setEndpoint(json.endpoint);
      return "on";
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      return "failed";
    }
  }, [support, configured, save]);

  const disable = useCallback(async (): Promise<boolean> => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await remove({ endpoint: sub.endpoint }).unwrap();
        await sub.unsubscribe();
      }
      setEndpoint(null);
      return true;
    } catch (err) {
      console.error("[push] unsubscribe failed:", err);
      return false;
    }
  }, [remove]);

  return {
    support,
    configured,
    permission,
    endpoint,
    loading: serverLoading || browserLoading,
    enable,
    disable,
  };
}
