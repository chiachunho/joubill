import { z } from "zod";

export const PLACEHOLDER_NAME_MAX = 30;

/** The name of a member who has no account. Trimmed; whitespace runs collapse. */
export const placeholderNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "請輸入名字").max(PLACEHOLDER_NAME_MAX, "名字太長"));

/** Case-insensitive key used to keep names unique within a group. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when `name` would read the same as an existing member in `/balance` and the
 * pickers. `exceptUserId` lets a rename keep its own current name.
 */
export function isDuplicateName(
  name: string,
  members: { id: number; firstName: string; lastName: string | null }[],
  exceptUserId?: number,
): boolean {
  const key = nameKey(name);
  return members.some(
    (m) =>
      m.id !== exceptUserId && nameKey([m.firstName, m.lastName].filter(Boolean).join(" ")) === key,
  );
}
