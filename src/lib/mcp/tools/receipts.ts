import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpAuth } from "@/lib/auth/mcp";
import { enforceMcpRateLimit } from "@/lib/rate-limit";
import { fetchReceiptImage, ReceiptFetchError } from "@/lib/receipt-fetch";
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS,
  ReceiptUploadError,
  sniffImage,
  uploadReceiptPhoto,
} from "@/lib/receipt-upload";
import { addReceipts, countReceipts } from "@/lib/records";
import { idSchema } from "@/lib/zod";

import { openGroup } from "../context";
import { guarded, ok, ToolError } from "../result";
import { mcpActor } from "./write";

const ATTACH = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

/** Base64 of 10 MB is ~13.4 M characters. */
const MAX_BASE64_CHARS = Math.ceil((MAX_RECEIPT_BYTES * 4) / 3) + 4;

const imageSchema = z.union([
  z.object({
    base64: z
      .string()
      .min(16)
      .max(MAX_BASE64_CHARS)
      .describe("Image bytes, base64 (a data: URL prefix is fine)."),
  }),
  z.object({
    url: z
      .string()
      .trim()
      .min(8)
      .max(2048)
      .describe("Public https link to the image. Redirects are not followed."),
  }),
]);

type ImageArg = z.infer<typeof imageSchema>;

/** The bytes of one image argument, checked to be a jpeg, png or webp. */
async function loadImage(arg: ImageArg, index: number): Promise<Uint8Array> {
  const label = `images[${index}]`;
  let bytes: Uint8Array;
  try {
    if ("url" in arg) {
      bytes = await fetchReceiptImage(arg.url);
    } else {
      const raw = arg.base64.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) {
        throw new ToolError("bad_request", `${label} is not valid base64`);
      }
      bytes = new Uint8Array(Buffer.from(raw, "base64"));
    }
  } catch (err) {
    if (err instanceof ReceiptFetchError) {
      throw new ToolError("bad_request", `${label}: ${err.message}`);
    }
    throw err;
  }
  if (bytes.length > MAX_RECEIPT_BYTES) {
    throw new ToolError("bad_request", `${label} is larger than 10 MB`);
  }
  if (!sniffImage(bytes)) {
    throw new ToolError("bad_request", `${label} is not a jpeg, png or webp image`);
  }
  return bytes;
}

export function registerReceiptTools(server: McpServer, auth: McpAuth) {
  server.registerTool(
    "attach_receipt",
    {
      title: "Attach receipt photos",
      description: `Add receipt photos to an existing expense (not a settlement). An expense holds at most ${MAX_RECEIPTS}; extra photos are refused, nothing is attached. Send images as base64 or as public https urls (redirects are not followed). jpeg, png and webp, up to 10 MB each. Photos are stored in the group's storage and the group's message for the record is updated in place, so every member sees them. Use it after add_expense returned a recordId. Call with dryRun: true first to check the images and the remaining slots. Each image counts as one write against the rate limit.`,
      inputSchema: {
        groupId: idSchema,
        recordId: idSchema,
        images: z.array(imageSchema).min(1).max(MAX_RECEIPTS),
        dryRun: z.boolean().optional().describe("Check only: nothing is uploaded or attached."),
      },
      annotations: ATTACH,
    },
    (args) =>
      guarded(async () => {
        await openGroup(auth, args.groupId, "write", { countAs: args.dryRun ? "read" : "write" });

        const have = await countReceipts(args.groupId, args.recordId);
        const room = MAX_RECEIPTS - have;
        if (args.images.length > room) {
          throw new ToolError(
            "bad_request",
            `this expense has ${have} of ${MAX_RECEIPTS} receipts, so only ${room} more fit and you sent ${args.images.length}`,
            { receiptCount: have, remaining: room },
          );
        }

        // Every image is checked before the first upload, so a bad one never leaves a partial attach.
        const loaded: Uint8Array[] = [];
        for (const [i, img] of args.images.entries()) loaded.push(await loadImage(img, i));

        if (args.dryRun) {
          return ok(
            `preview: ${loaded.length} receipt(s) would be attached to record ${args.recordId}`,
            {
              status: "preview",
              recordId: args.recordId,
              receiptCount: have,
              wouldAttach: loaded.length,
              remainingAfter: room - loaded.length,
            },
          );
        }

        // The call itself was counted once; each further image is another write.
        for (let i = 1; i < loaded.length; i++) {
          await enforceMcpRateLimit(auth.grant.connectionId, "write");
        }

        const fileIds: string[] = [];
        try {
          for (const [i, bytes] of loaded.entries()) {
            fileIds.push(
              await uploadReceiptPhoto(
                bytes,
                sniffImage(bytes) ?? "image/jpeg",
                `receipt-${i + 1}`,
              ),
            );
          }
        } catch (err) {
          if (err instanceof ReceiptUploadError) {
            throw new ToolError("internal", "the photo could not be stored; nothing was attached");
          }
          throw err;
        }

        const receiptCount = await addReceipts(args.groupId, args.recordId, fileIds, {
          actor: mcpActor(auth),
        });
        return ok(
          `attached ${fileIds.length} receipt(s) to record ${args.recordId}; it now has ${receiptCount}`,
          {
            status: "attached",
            recordId: args.recordId,
            attached: fileIds.length,
            receiptCount,
            remaining: MAX_RECEIPTS - receiptCount,
          },
        );
      }),
  );
}
