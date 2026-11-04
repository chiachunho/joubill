"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

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

/** This browser's push subscription, if it has one. Never throws. */
async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return (await reg?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Endpoints already sent to the server since this page loaded. Both 個人設定 and every group
 * page's card mount this hook, so without it each of them would re-POST the same row. Signing
 * out reloads the page, which empties it for whoever signs in next.
 */
const healed = new Set<string>();

/**
 * The browser's notification permission as an external store. It changes outside React (the
 * person flips it in the browser's site settings, or answers our own prompt), so components read
 * it with `useSyncExternalStore` instead of copying it into state.
 *
 * The Permissions API announces changes made in settings; our own `requestPermission` call
 * announces itself through `permissionChanged`, since not every browser supports that API.
 */
const permissionListeners = new Set<() => void>();

function permissionChanged(): void {
  permissionListeners.forEach((listener) => listener());
}

function subscribePermission(onChange: () => void): () => void {
  permissionListeners.add(onChange);
  let status: PermissionStatus | null = null;
  let closed = false;
  navigator.permissions
    ?.query({ name: "notifications" })
    .then((s) => {
      if (closed) return;
      status = s;
      s.addEventListener("change", onChange);
    })
    .catch(() => {
      // Not supported (older Safari): only our own prompt's answer is announced.
    });
  return () => {
    closed = true;
    permissionListeners.delete(onChange);
    status?.removeEventListener("change", onChange);
  };
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

  // `null` on the server and until push is usable here, then the browser's own answer.
  const permission = useSyncExternalStore(
    subscribePermission,
    () => (support === "supported" ? Notification.permission : null),
    () => null,
  );
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(support === "supported");

  useEffect(() => {
    if (support !== "supported") return;
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
    if (!configured || !endpoint || permission === "denied" || healed.has(endpoint)) return;
    healed.add(endpoint);
    (async () => {
      const json = (await currentSubscription())?.toJSON();
      if (json?.endpoint && json.keys?.p256dh && json.keys.auth) {
        await save({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }).unwrap();
      }
    })().catch(() => {
      healed.delete(endpoint);
    });
  }, [configured, endpoint, permission, save]);

  const enable = useCallback(async (): Promise<EnableResult> => {
    if (support !== "supported" || !configured) return "failed";
    // First, while the tap still counts as a user gesture.
    const result =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    permissionChanged();
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
      healed.add(json.endpoint);
      setEndpoint(json.endpoint);
      return "on";
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      return "failed";
    }
  }, [support, configured, save]);

  // Drops this browser's subscription on the server and in the browser. Touches no React state,
  // so an effect can start it; whoever calls it clears `endpoint` once it has finished.
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await remove({ endpoint: sub.endpoint }).unwrap();
        await sub.unsubscribe();
        healed.delete(sub.endpoint);
      }
      return true;
    } catch (err) {
      console.error("[push] unsubscribe failed:", err);
      return false;
    }
  }, [remove]);

  const disable = useCallback(async (): Promise<boolean> => {
    const ok = await unsubscribe();
    if (ok) setEndpoint(null);
    return ok;
  }, [unsubscribe]);

  // Notifications were blocked in the browser's settings after subscribing, and the browser
  // kept the subscription: nothing it receives will be shown, so drop it on both sides
  // rather than leave the server pushing to it and the switch stuck "on". If that fails, the
  // settings switch stays usable for turning it off by hand.
  useEffect(() => {
    if (permission !== "denied" || !endpoint) return;
    void unsubscribe().then((ok) => {
      if (ok) setEndpoint(null);
    });
  }, [permission, endpoint, unsubscribe]);

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

/**
 * For signing out: stops this device receiving the account's push. Without it the lock screen
 * keeps showing the signed-out account's records, and the next person to sign in here would
 * have the subscription re-claimed for them by the heal above without ever being asked.
 * Best effort; never throws. Call it before the session is ended (the DELETE needs it).
 */
export function useForgetPushDevice(): () => Promise<void> {
  const [remove] = useDeletePushSubscriptionMutation();
  return useCallback(async () => {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      await remove({ endpoint: sub.endpoint }).unwrap();
    } catch {
      // the server copy is dropped at the push service's next 410
    }
    try {
      await sub.unsubscribe();
    } catch {
      // nothing more this page can do
    }
  }, [remove]);
}
