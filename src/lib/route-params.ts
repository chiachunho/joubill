import { BadRequestError } from "@/lib/auth/errors";

/** Every id in the schema is a Postgres `integer` (int4). */
export const MAX_ID = 2_147_483_647;

/**
 * Reads a database id from a route segment or query parameter: a positive integer in
 * int4 range, written as plain digits. Anything else is null.
 *
 * Stricter than the `Number(x)` + `Number.isFinite` it replaces on purpose: that
 * accepted `""` and `" "` (both 0), `"1.5"`, `"1e3"`, `"0x10"` and ids past int4, which
 * either matched nothing or reached Postgres as a value it rejects, a 500.
 */
export function parseId(raw: string | null | undefined): number | null {
  if (raw == null || !/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_ID ? id : null;
}

/**
 * `parseId`, or a 400 `invalid <label>` thrown for `withAuth` to answer. `label` names
 * the parameter, e.g. "group id", so the response says which one was wrong.
 */
export function requireId(raw: string | null | undefined, label = "id"): number {
  const id = parseId(raw);
  if (id === null) throw new BadRequestError(`invalid ${label}`);
  return id;
}
