/*
 * 揪帳 service worker (issue #67).
 *
 * Push only, on purpose: no fetch handler and no offline cache. A balance served from a
 * stale cache is worse than an error, and Chrome no longer needs a fetch handler to offer
 * installation. Hand-written rather than generated (Serwist etc.) so the build and
 * `next dev --turbopack` need no plugin.
 *
 * The payload is built by `src/lib/push-notice.ts`:
 *   { title, body, url, tag }
 * `tag` is per record, so three quick edits to one expense leave one notification. `url`
 * already carries the "opened from a notification" mark (`openedFromPush`, src/lib/pwa.ts)
 * that keeps the iPhone home-screen app's launch redirect on the record.
 * Served with `Cache-Control: no-cache` (next.config.mjs) so a fix reaches people on their
 * next visit.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "揪帳";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      lang: "zh-Hant",
      data: { url: data.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/app",
    self.location.origin,
  );
  // Only ever open this site: a payload can't send someone elsewhere.
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith("/app") && "focus" in client) {
          await client.focus();
          try {
            // navigate() rejects for a window this worker doesn't control (a hard reload,
            // or one opened before it activated); open the record in a new window then.
            if ("navigate" in client) await client.navigate(target.href);
            return;
          } catch {
            break;
          }
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
