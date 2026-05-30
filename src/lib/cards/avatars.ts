import { Api } from "grammy";

import { serverEnv } from "@/lib/env";

/** Map a Telegram file path to an image MIME type; default JPEG. */
function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Fetch each user's Telegram profile photo as a base64 data URL, keyed by
 * internal user id. satori can't fetch remote images itself, so we inline them.
 * Any user without a photo (or whose fetch fails) maps to null → the card falls
 * back to an initials circle.
 */
export async function fetchAvatarDataUrls(
  members: { userId: number; telegramId: number | null }[],
): Promise<Record<number, string | null>> {
  const { TELEGRAM_BOT_TOKEN: token } = serverEnv();
  const api = new Api(token);
  const out: Record<number, string | null> = {};

  const results = await Promise.allSettled(
    members.map(async ({ userId, telegramId }) => {
      if (!telegramId) return { userId, dataUrl: null };
      const photos = await api.getUserProfilePhotos(telegramId, { limit: 1 });
      const smallest = photos.photos[0]?.[0];
      if (!smallest) return { userId, dataUrl: null };

      const file = await api.getFile(smallest.file_id);
      if (!file.file_path) return { userId, dataUrl: null };

      const res = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      );
      if (!res.ok) return { userId, dataUrl: null };

      const buf = Buffer.from(await res.arrayBuffer());
      // Telegram's file server returns content-type: application/octet-stream,
      // which satori can't identify → it drops the image. Derive the real MIME
      // from the file extension instead (profile photos are JPEG).
      const mime = mimeFromPath(file.file_path);
      return { userId, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      out[r.value.userId] = r.value.dataUrl;
    } else {
      // getUserProfilePhotos / getFile / download error for this user.
      console.warn("[cards] avatar fetch failed:", r.reason);
    }
  }
  return out;
}
