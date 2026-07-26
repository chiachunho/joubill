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
