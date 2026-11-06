import { viaText } from "@/lib/mcp-ui";
import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import type { PushAction } from "@/lib/push-plan";
import { openedFromPush } from "@/lib/pwa";
import { diffRecords, type RecordSnapshot } from "@/lib/record-audit";
import type { NoticeLeg, NoticePerson, NoticeRecord } from "@/lib/record-notice";

/**
 * The text of one push notification, written for the person receiving it (issue #67): 你分
 * 3,000 JPY, not "A, B and C split it". Pure and plain text (a notification renders no
 * HTML), so it is unit-tested and needs no escaping.
 *
 * The payload's shape is read by `public/sw.js`: `{ title, body, url, tag }`.
 */

export type PushPayload = {
  /** The group's name: on a lock screen, which trip or flat comes first. */
  title: string;
  body: string;
  /** Where a tap opens, a path inside the Web App. */
  url: string;
  /** One per record, so a later notification about it replaces the earlier one. */
  tag: string;
};

export type PushNoticeInput = {
  action: PushAction;
  groupId: number;
  groupTitle: string;
  recordId: number;
  before: RecordSnapshot | null;
  after: RecordSnapshot | null;
  actor: NoticePerson | null;
  /** The AI assistant the actor worked through, when it was one (issue #150). */
  via?: string | null;
  creatorId: number | null;
  recipientId: number;
};

/** The tag and Web Push topic for a record; the topic header allows at most 32 characters. */
export function recordPushTag(recordId: number): string {
  return `r${recordId}`;
}

/**
 * Where tapping a notification about a record opens. A deleted record has only its history.
 * Marked with `openedFromPush` so the iPhone home-screen app's launch redirect stays on it.
 */
export function recordPushUrl(
  action: PushAction,
  type: NoticeRecord["type"],
  groupId: number,
  recordId: number,
): string {
  if (action === "deleted") {
    return openedFromPush(`/app/groups/${groupId}/activity?record=${recordId}`);
  }
  return openedFromPush(
    type === "settlement"
      ? `/app/groups/${groupId}/settlements/${recordId}`
      : `/app/groups/${groupId}/expenses/${recordId}/edit`,
  );
}

function money(amount: number, currency: string): string {
  return `${fmtGrouped(amount)} ${currency}`;
}

function legOf(legs: NoticeLeg[], userId: number): NoticeLeg | undefined {
  return legs.find((leg) => leg.user.userId === userId);
}

/** 「燒肉晚餐」12,000 JPY, or 一筆 12,000 JPY when there is no description. */
function what(record: NoticeRecord): string {
  const amount = money(record.amount, record.currency);
  return record.description ? `「${record.description}」${amount}` : `一筆 ${amount}`;
}

/** ，你分 3,000 JPY / ，記你付了 … — the recipient's own part, when they have one. */
function yourPart(record: NoticeRecord, recipientId: number): string {
  const split = legOf(record.splits, recipientId);
  if (split) return `，你分 ${money(split.amount, record.currency)}`;
  const paid = legOf(record.payers, recipientId);
  if (paid) return `，記你付了 ${money(paid.amount, record.currency)}`;
  return "";
}

/** "小明 還你 4,500 TWD" / "小明 還 阿花 4,500 TWD", with 你 for the recipient. */
function transfer(record: NoticeRecord, recipientId: number): string {
  const from = record.payers[0]?.user ?? null;
  const to = record.splits[0]?.user ?? null;
  const toLabel = labelUser(to, recipientId);
  return `${labelUser(from, recipientId)} 還${toLabel === "你" ? "你" : ` ${toLabel}`} ${money(record.amount, record.currency)}`;
}

/** 你記的, when someone else changed a record the recipient had recorded. */
function yours(input: PushNoticeInput): string {
  return input.creatorId === input.recipientId ? "你記的" : "";
}

function createdBody(input: PushNoticeInput, record: NoticeRecord, actorName: string): string {
  if (record.type === "settlement") {
    const fromId = record.payers[0]?.user.userId;
    const line = transfer(record, input.recipientId);
    // The sender recording their own repayment needs no "who recorded it".
    return fromId === input.actor?.userId ? line : `${actorName} 記了：${line}`;
  }
  return `${actorName} 記了${what(record)}${yourPart(record, input.recipientId)}`;
}

function updatedBody(
  input: PushNoticeInput,
  before: RecordSnapshot,
  after: RecordSnapshot,
  actorName: string,
): string {
  const kind = after.type === "settlement" ? "還款" : "";
  const name = after.description ? `「${after.description}」` : kind || "一筆紀錄";
  const changes = diffRecords(before, after);
  const first = changes[0];
  const summary = first
    ? `：${first.label} ${first.before} → ${first.after}${changes.length > 1 ? ` 等 ${changes.length} 項` : ""}`
    : "";
  return `${actorName} 修改了${yours(input)}${name}${summary}`;
}

function deletedBody(input: PushNoticeInput, record: NoticeRecord, actorName: string): string {
  if (record.type === "settlement") {
    return `${actorName} 刪除了${yours(input)}還款：${transfer(record, input.recipientId)}`;
  }
  const part = yourPart(record, input.recipientId);
  return `${actorName} 刪除了${yours(input)}${what(record)}${part ? `（${part.slice(1)}）` : ""}`;
}

/** Null when the snapshots needed for this action are missing. */
export function formatPushNotice(input: PushNoticeInput): PushPayload | null {
  const record = input.after ?? input.before;
  if (!record) return null;
  // 「小明 透過 Claude 記了…」: the same words as the group card.
  const actorName = `${labelUser(input.actor)}${input.via ? ` ${viaText(input.via)}` : ""}`;

  let body: string;
  if (input.action === "created") {
    if (!input.after) return null;
    body = createdBody(input, input.after, actorName);
  } else if (input.action === "updated") {
    if (!input.before || !input.after) return null;
    body = updatedBody(input, input.before, input.after, actorName);
  } else {
    if (!input.before) return null;
    body = deletedBody(input, input.before, actorName);
  }

  return {
    title: input.groupTitle,
    body,
    url: recordPushUrl(input.action, record.type, input.groupId, input.recordId),
    tag: recordPushTag(input.recordId),
  };
}
