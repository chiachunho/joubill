/**
 * Where an expense's edit form lives, and the `?focus=receipts` that opens it at the receipt
 * photos. Built and read in this one file: the MCP tools hand the link to a person (issue #163)
 * and the edit page reads it back, so the two can't drift apart without this file's test failing.
 *
 * A query parameter rather than a `#receipts` fragment, because the Web App's login redirect
 * carries `pathname + search` through `/login?next=` and would drop a fragment.
 */

const FOCUS = "focus";
const RECEIPTS = "receipts";

/** `<basePath>/groups/<id>/expenses/<id>/edit`, with `?focus=receipts` when asked. */
export function expenseEditPath(
  basePath: string,
  groupId: number,
  expenseId: number,
  opts: { focus?: "receipts" } = {},
): string {
  const path = `${basePath}/groups/${groupId}/expenses/${expenseId}/edit`;
  return opts.focus ? `${path}?${FOCUS}=${RECEIPTS}` : path;
}

/** Whether the edit form was opened to add receipt photos. */
export function focusesReceipts(search: Pick<URLSearchParams, "get"> | null): boolean {
  return search?.get(FOCUS) === RECEIPTS;
}
