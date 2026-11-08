/**
 * Turn a failed response into a message the user can act on.
 *
 * The blanket "請再試一次" this replaces was wrong for every non-transient
 * failure: a 404 means someone else already removed the record, and retrying
 * will never succeed. That case is not rare — the ledger is shared and anyone
 * in the group can delete, so two people opening the same record is normal.
 *
 * Pure (takes only the status) so it can be unit-tested.
 */
export function deleteErrorMessage(res: { status: number }, noun = "這筆紀錄"): string {
  if (res.status === 404) return `${noun}已經不在了，可能剛剛被其他人刪除。`;
  if (res.status === 403) return `你沒有權限刪除${noun}。`;
  if (res.status === 401) return "登入狀態過期了，請重新開啟一次。";
  if (res.status >= 500) return "伺服器暫時有問題，請稍後再試。";
  return "刪除失敗，請再試一次。";
}

/** How a record's creator or editor reads once they are no longer in the group's member list. */
export const FORMER_MEMBER = "已不在群組的成員";

/**
 * A failed save of an expense or settlement, in words the person can act on. The record routes
 * answer validation failures in English for the log (a zod dump, `users not in group: 12`),
 * so the form never shows the server's text; it picks a sentence by status instead.
 */
export function saveErrorMessage(error: unknown, noun = "這筆紀錄"): string {
  const status = apiErrorStatus(error);
  if (status === undefined || status === 0) return "連不上伺服器，請檢查網路後再試一次。";
  if (status === 400 && /not in group/.test(apiErrorText(error, ""))) {
    return "有人已經不在這個群組了，請重新選擇付款人和參與者。";
  }
  if (status === 400) return "內容有誤，請檢查後再儲存一次。";
  if (status === 401) return "登入狀態過期了，請重新開啟一次。";
  if (status === 403) return "你已經不是這個群組的成員。";
  if (status === 404) return `${noun}已經不在了，可能剛剛被其他人刪除。`;
  if (status >= 500) return "伺服器暫時有問題，請稍後再試。";
  return "儲存失敗，請再試一次。";
}

/**
 * What a failed API request looks like to the pages. `message` keeps the
 * `${status} ${path}: ${body}` shape the old fetchers threw, which is what
 * `isUnauthorizedError` (`src/lib/auth-redirect.ts`) reads the status from, so a
 * 401 is still recognised whichever layer produced it. `status` is 0 when the
 * request never got a response.
 */
export type ApiError = { status: number; data: unknown; message: string };

/** The server's `{ error }` text for a failed request, or `fallback` when it sent none. */
export function apiErrorText(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  const text = (data as { error?: unknown } | null | undefined)?.error;
  return typeof text === "string" && text !== "" ? text : fallback;
}

/** The HTTP status of a failed request, or undefined for anything that did not come from the server. */
export function apiErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

/** A one-line description of any load error, for the small grey line under "無法載入". */
export function describeError(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : String(error);
}
