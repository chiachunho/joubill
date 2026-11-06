import { z } from "zod";

import { idSchema } from "@/lib/zod";

/** At most this many live connections per person. */
export const MAX_APP_CONNECTIONS = 20;

export const createConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    access: z.enum(["read", "write"]),
    allGroups: z.boolean(),
    groupIds: z.array(idSchema).max(200).default([]),
    /** Omitted = never expires. */
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .refine((v) => v.allGroups || v.groupIds.length > 0, {
    message: "choose at least one group, or all groups",
  });

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

/**
 * What can change on an existing connection: its permission and its group scope. Not the
 * name (audit entries quote it) and not the expiry (extending one is a new token). The
 * scope is `allGroups` and `groupIds` together, so a half-given scope can't be guessed at.
 */
export const updateConnectionSchema = z
  .object({
    access: z.enum(["read", "write"]).optional(),
    allGroups: z.boolean().optional(),
    groupIds: z.array(idSchema).max(200).optional(),
  })
  .refine((v) => (v.allGroups === undefined) === (v.groupIds === undefined), {
    message: "allGroups and groupIds go together",
  })
  .refine((v) => v.access !== undefined || v.allGroups !== undefined, {
    message: "nothing to change",
  })
  .refine((v) => v.allGroups !== false || (v.groupIds?.length ?? 0) > 0, {
    message: "choose at least one group, or all groups",
  });

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

export type ConnectionStatus = "active" | "expired" | "revoked";

/** Whether a connection still works, for the list and the count on 個人設定. */
export function connectionStatus(
  c: { revokedAt: string | Date | null; expiresAt: string | Date | null },
  now: Date = new Date(),
): ConnectionStatus {
  if (c.revokedAt) return "revoked";
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}
