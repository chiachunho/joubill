import { describe, expect, it } from "vitest";

import {
  APPROVE_DELETE,
  declinedNotice,
  deleteRequestMessage,
  deletedNotice,
  REJECT_DELETE,
} from "@/lib/group-delete-notice";

describe("deleteRequestMessage", () => {
  const message = deleteRequestMessage("小明", "<日本行>", 42);
  const [[approve, reject]] = message.reply_markup.inline_keyboard;

  it("names who asked and which group, escaped", () => {
    expect(message.text.split("\n")[0]).toBe("⚠️ <b>小明 想刪除「&lt;日本行&gt;」</b>");
  });

  it("builds button data the bot's handlers read back", () => {
    const approveData = "callback_data" in approve ? approve.callback_data : "";
    const rejectData = "callback_data" in reject ? reject.callback_data : "";
    expect(APPROVE_DELETE.exec(approveData)?.[1]).toBe("42");
    expect(REJECT_DELETE.exec(rejectData)?.[1]).toBe("42");
  });

  it("colours approval red: approving is what deletes the group", () => {
    expect(approve.style).toBe("danger");
    expect(reject.style).toBeUndefined();
  });
});

describe("outcomes", () => {
  it("say who decided", () => {
    expect(deletedNotice("阿華", "日本行")).toBe("🗑 「日本行」已刪除（阿華 同意）");
    expect(declinedNotice("阿華", false)).toBe("阿華 拒絕了刪除");
    expect(declinedNotice("小明", true)).toBe("小明 取消了刪除");
  });
});
