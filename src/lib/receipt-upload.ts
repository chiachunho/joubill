import { serverEnv } from "@/lib/env";

/** Telegram's `sendPhoto` limit. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
/** Photos per expense (`expense_receipts`). */
export const MAX_RECEIPTS = 5;

export class ReceiptUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptUploadError";
  }
}

/**
 * Posts a photo to the private storage channel and returns its permanent `file_id`.
 * The one place receipts are uploaded: the Mini App / Web App route and the MCP
 * `attach_receipt` tool both call it, so their handling of Telegram's answers can't drift.
 */
export async function uploadReceiptPhoto(
  bytes: ArrayBuffer | Uint8Array,
  mime: string,
  name: string,
): Promise<string> {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_STORAGE_CHAT_ID: chatId } = serverEnv();

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new Blob([bytes as BlobPart], { type: mime }), name || "receipt.jpg");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    console.error("[receipt-upload] sendPhoto failed:", await res.text());
    throw new ReceiptUploadError("upload failed");
  }
  const data = (await res.json()) as { result: { photo?: Array<{ file_id: string }> } };
  const fileId = data.result.photo?.at(-1)?.file_id;
  if (!fileId) {
    // Telegram may return a document instead of a photo for non-standard image formats.
    console.error("[receipt-upload] no photo array:", JSON.stringify(data.result));
    throw new ReceiptUploadError("upload failed: unsupported image format");
  }
  return fileId;
}

export type ReceiptMime = "image/jpeg" | "image/png" | "image/webp";

/** The image type from the first bytes. A client-supplied content type is never trusted. */
export function sniffImage(b: Uint8Array): ReceiptMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
