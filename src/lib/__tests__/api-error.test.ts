import { describe, expect, it } from "vitest";

import {
  apiErrorStatus,
  apiErrorText,
  deleteErrorMessage,
  describeError,
  saveErrorMessage,
} from "../api-error";

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

describe("apiErrorText", () => {
  it("prefers the server's own error text", () => {
    expect(apiErrorText({ status: 400, data: { error: "名稱重複" } }, "儲存失敗")).toBe("名稱重複");
  });

  it("falls back when the server sent none, or sent something else", () => {
    expect(apiErrorText({ status: 500, data: null }, "儲存失敗")).toBe("儲存失敗");
    expect(apiErrorText({ status: 500, data: "<html>" }, "儲存失敗")).toBe("儲存失敗");
    expect(apiErrorText({ status: 400, data: { error: "" } }, "儲存失敗")).toBe("儲存失敗");
    expect(apiErrorText(undefined, "儲存失敗")).toBe("儲存失敗");
  });
});

describe("apiErrorStatus", () => {
  it("reads the HTTP status, and nothing from a value that did not come from the server", () => {
    expect(apiErrorStatus({ status: 409, data: {} })).toBe(409);
    expect(apiErrorStatus(new Error("boom"))).toBeUndefined();
    expect(apiErrorStatus(null)).toBeUndefined();
  });
});

describe("describeError", () => {
  it("shows the status-prefixed message of a failed request", () => {
    expect(describeError({ status: 404, data: null, message: "404 /api/x: " })).toBe(
      "404 /api/x: ",
    );
  });

  it("falls back to String() for anything without a message", () => {
    expect(describeError("plain")).toBe("plain");
  });
});

describe("saveErrorMessage", () => {
  const failure = (status: number, error?: string) => ({
    status,
    data: error === undefined ? undefined : { error },
    message: `${status}`,
  });

  it("never shows the server's English validation text", () => {
    const msg = saveErrorMessage(failure(400, '[{"code":"custom","message":"splits sum"}]'));
    expect(msg).toBe("內容有誤，請檢查後再儲存一次。");
  });

  it("explains a member who has left the group", () => {
    expect(saveErrorMessage(failure(400, "users not in group: 12,34"))).toContain("不在這個群組");
  });

  it("names the record on 404 and does not suggest retrying", () => {
    const msg = saveErrorMessage(failure(404, "expense not found"), "這筆支出");
    expect(msg).toContain("這筆支出");
    expect(msg).not.toContain("再試");
  });

  it("tells a request that never got an answer to check the network", () => {
    expect(saveErrorMessage({ status: 0, data: undefined, message: "" })).toContain("網路");
    expect(saveErrorMessage(new Error("boom"))).toContain("網路");
  });
});
