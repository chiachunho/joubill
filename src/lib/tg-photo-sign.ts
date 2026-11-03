import crypto from "node:crypto";

import { serverEnv } from "@/lib/env";

/**
 * Signed links for the `/api/tg-photo` proxy.
 *
 * The proxy is loaded by `<img src>`, which cannot carry the Mini App's `Authorization`
 * header, so it cannot ask for a login. Instead every link is minted by an authenticated
 * route and carries an HMAC of the thing it names: a file id (a receipt) or a Telegram
 * file path (an avatar). Without the signature a `fileId` that leaks is useless, and the
 * proxy can't be used to enumerate `photos/file_N.jpg` paths in the storage channel.
 *
 * The key is derived from the bot token with a purpose label, so no new env var is needed
 * and the token itself is never used as the MAC key directly.
 */
export type PhotoRef = { fileId: string } | { path: string };

let cachedKey: Buffer | undefined;

function key(): Buffer {
  // Derived once: the detail route signs every receipt and the photo routes every avatar.
  cachedKey ??= crypto
    .createHmac("sha256", "tg-photo-link")
    .update(serverEnv().TELEGRAM_BOT_TOKEN)
    .digest();
  return cachedKey;
}

function message(ref: PhotoRef): string {
  return "fileId" in ref ? `fileId:${ref.fileId}` : `path:${ref.path}`;
}

export function signPhoto(ref: PhotoRef): string {
  return crypto.createHmac("sha256", key()).update(message(ref)).digest("base64url");
}

export function verifyPhotoSig(ref: PhotoRef, sig: string | null): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signPhoto(ref));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The proxy URL for a receipt, signed. */
export function receiptPhotoUrl(fileId: string): string {
  return `/api/tg-photo?fileId=${encodeURIComponent(fileId)}&sig=${signPhoto({ fileId })}`;
}

/** The proxy URL for a Telegram file path (avatars, group photos), signed. */
export function pathPhotoUrl(path: string): string {
  return `/api/tg-photo?path=${encodeURIComponent(path)}&sig=${signPhoto({ path })}`;
}
