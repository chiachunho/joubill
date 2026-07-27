import { describe, expect, it } from "vitest";

import { deleteErrorMessage } from "../api-error";

describe("deleteErrorMessage", () => {
  it("tells the user the record is already gone on 404", () => {
    // The common case now that anyone in the group can delete: two people had
    // the same record open. Telling them to retry would be a lie.
    const msg = deleteErrorMessage({ status: 404 }, "這筆支出");
    expect(msg).toContain("這筆支出");
    expect(msg).not.toContain("再試");
  });

  it("does not suggest retrying on 403 or 401 either", () => {
    expect(deleteErrorMessage({ status: 403 })).not.toContain("再試");
    expect(deleteErrorMessage({ status: 401 })).not.toContain("再試一次。");
  });

  it("suggests retrying only for failures that might actually clear", () => {
    expect(deleteErrorMessage({ status: 500 })).toContain("稍後再試");
    expect(deleteErrorMessage({ status: 503 })).toContain("稍後再試");
    expect(deleteErrorMessage({ status: 400 })).toContain("再試一次");
  });

  it("names the record type when given one", () => {
    expect(deleteErrorMessage({ status: 403 }, "這筆還款記錄")).toContain("這筆還款記錄");
    expect(deleteErrorMessage({ status: 404 })).toContain("這筆紀錄");
  });
});
