import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpAuth } from "@/lib/auth/mcp";
import { MAX_RECEIPTS } from "@/lib/receipt-upload";
import { addReceipts, countReceipts } from "@/lib/records";
import { idSchema } from "@/lib/zod";

import { openGroup } from "../context";
import { guarded, ok, ToolError } from "../result";
import {
  imagesSchema,
  imageWarnings,
  loadImages,
  uploadImages,
  warningNote,
  withWarnings,
} from "../receipt-images";
import { receiptLinks } from "../receipt-links";
import { mcpActor } from "./write";

const ATTACH = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

export function registerReceiptTools(server: McpServer, auth: McpAuth) {
  server.registerTool(
    "attach_receipt",
    {
      title: "Attach receipt photos",
      description: `Add receipt photos to an existing expense (not a settlement). An expense holds at most ${MAX_RECEIPTS}; extra photos are refused, nothing is attached. Send images as base64 or as public https urls (redirects are not followed). jpeg, png and webp, up to 10 MB each. Photos are stored in the group's storage and the group's message for the record is updated in place, so every member sees them. Use it for an expense that already exists; for a new expense send the photos in add_expense's images instead. Call with dryRun: true first to check the images and the remaining slots. Each image counts as one write against the rate limit. Only call it when you have the original file itself (a public or temporary https url, or a file's bytes); by default, and for a photo attached in a chat, don't: give the user uploadUrl from get_record instead (also telegramUrl when present), where they upload the original in the app and save. Never crop, shrink or convert a photo to grayscale to make it fit; warnings: low_resolution means an image looked shrunk.`,
      inputSchema: {
        groupId: idSchema,
        recordId: idSchema,
        images: imagesSchema,
        dryRun: z.boolean().optional().describe("Check only: nothing is uploaded or attached."),
      },
      annotations: ATTACH,
    },
    (args) =>
      guarded(async () => {
        const { group } = await openGroup(auth, args.groupId, "write", {
          countAs: args.dryRun ? "read" : "write",
        });

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
        const loaded = await loadImages(args.images);
        const warnings = imageWarnings(loaded);

        if (args.dryRun) {
          return ok(
            `preview: ${loaded.length} receipt(s) would be attached to record ${args.recordId}${warningNote(warnings)}`,
            {
              status: "preview",
              recordId: args.recordId,
              receiptCount: have,
              wouldAttach: loaded.length,
              remainingAfter: room - loaded.length,
              ...(await receiptLinks(group, args.recordId)),
              ...withWarnings(warnings, true),
            },
          );
        }

        const fileIds = await uploadImages(auth, loaded);

        const receiptCount = await addReceipts(args.groupId, args.recordId, fileIds, {
          actor: mcpActor(auth),
        });
        return ok(
          `attached ${fileIds.length} receipt(s) to record ${args.recordId}; it now has ${receiptCount}${warningNote(warnings)}`,
          {
            status: "attached",
            recordId: args.recordId,
            attached: fileIds.length,
            receiptCount,
            remaining: MAX_RECEIPTS - receiptCount,
            ...(await receiptLinks(group, args.recordId)),
            ...withWarnings(warnings, true),
          },
        );
      }),
  );
}
