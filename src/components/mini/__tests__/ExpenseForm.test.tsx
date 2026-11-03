import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/AuthProvider";
import { ExpenseForm } from "@/components/mini/ExpenseForm";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

const { push, upload } = vi.hoisted(() => ({ push: vi.fn(), upload: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
}));
// Loads @twa-dev/sdk, which has nothing to talk to outside Telegram.
vi.mock("@/lib/use-tg-back-button", () => ({ useTelegramBackButton: () => {} }));
// The receipt upload bypasses the store (the cache has no use for it), so it is stubbed here.
vi.mock("@/lib/tma-fetch", () => ({ tmaRawFetch: upload }));

// Radix's Checkbox measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  push.mockReset();
  upload.mockReset();
});

const ME = 1;
const MEMBERS = [
  { id: 1, displayName: null, firstName: "Alice", username: null, status: "active" },
  { id: 2, displayName: null, firstName: "Bob", username: null, status: "active" },
  // Inactive: left out of a new expense's split by default.
  { id: 3, displayName: null, firstName: "Carol", username: null, status: "inactive" },
];

type Initial = NonNullable<Parameters<typeof ExpenseForm>[0]["initial"]>;

const SPENT_AT = "2026-07-10T04:00:00Z";
/** The local day of SPENT_AT, as the form asks the rate endpoint for it. */
const SPENT_DAY = (() => {
  const d = new Date(SPENT_AT);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, "0"))
    .join("-");
})();
const RATE_PATH = `/api/groups/7/rates/effective?base=JPY&date=${SPENT_DAY}`;

function initial(over: Partial<Initial> = {}): Initial {
  return {
    id: 11,
    createdBy: ME,
    createdAt: "2026-07-10T04:00:00Z",
    lastActivity: null,
    amount: 300,
    currency: "TWD",
    fxRate: null,
    fxQuote: null,
    description: "晚餐",
    payers: [{ payerId: 1, amount: 300 }],
    spentAt: SPENT_AT,
    receiptFileIds: [],
    receiptUrls: {},
    splits: [
      { debtorId: 1, amount: 150, shareType: "equal", splitValue: null },
      { debtorId: 2, amount: 150, shareType: "equal", splitValue: null },
    ],
    ...over,
  };
}

type Body = {
  amount: number;
  receiptFileIds: string[];
  currency: string;
  fxRate: number | null;
  description: string | null;
  shareType: string;
  payers: { payerId: number; amount: number }[];
  splits: { debtorId: number; amount: number; splitValue: number | null }[];
};

/** Captures the JSON the form sends, answering each write with `answer`. */
function writes(answer: unknown = { id: 99 }) {
  const sent: { method: string; body: Body | null }[] = [];
  const handler = (init: RequestInit | undefined) => {
    sent.push({
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Body) : null,
    });
    return answer;
  };
  return { sent, handler };
}

function renderForm(
  props: Partial<Parameters<typeof ExpenseForm>[0]>,
  routes: Parameters<typeof fakeRequest>[0],
  mode: "tma" | "web" = "tma",
) {
  render(
    <AuthProvider mode={mode}>
      <StoreWrapper request={fakeRequest(routes)}>
        <ExpenseForm
          groupId={7}
          defaultCurrency="TWD"
          currentUserId={ME}
          members={MEMBERS}
          returnPath="/mini/groups/7"
          {...props}
        />
      </StoreWrapper>
    </AuthProvider>,
  );
}

const save = () => screen.getByRole("button", { name: "儲存" });

async function submit() {
  await waitFor(() => expect(save()).toBeEnabled());
  fireEvent.click(save());
}

describe("ExpenseForm: new expense", () => {
  it("keeps 儲存 disabled until there is an amount", async () => {
    renderForm({}, {});
    expect(screen.getByRole("heading", { name: "新增支出" })).toBeInTheDocument();
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "300" } });
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it("posts an equal split between the active members, paid by the viewer", async () => {
    const w = writes();
    renderForm({}, { "/api/groups/7/expenses": w.handler });

    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("說明"), { target: { value: "  午餐  " } });
    await submit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/mini/groups/7"));
    expect(w.sent).toHaveLength(1);
    const { method, body } = w.sent[0];
    expect(method).toBe("POST");
    expect(body).toMatchObject({
      amount: 300,
      currency: "TWD",
      fxRate: null,
      description: "午餐",
      shareType: "equal",
      payers: [{ payerId: 1, amount: 300 }],
    });
    // Carol is inactive, so she isn't in a new expense's split.
    expect(body!.splits.map((s) => [s.debtorId, s.amount])).toEqual([
      [1, 150],
      [2, 150],
    ]);
  });

  it("shows the server's error and stays on the page when saving fails", async () => {
    renderForm(
      {},
      { "/api/groups/7/expenses": new Failure(400, { error: "付款金額加總不等於總額" }) },
    );
    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "300" } });
    await submit();

    expect(await screen.findByText("付款金額加總不等於總額")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ExpenseForm: editing", () => {
  it("is pre-filled from the saved expense", () => {
    renderForm({ initial: initial() }, {});
    expect(screen.getByRole("heading", { name: "編輯支出" })).toBeInTheDocument();
    expect(screen.getByLabelText("金額")).toHaveValue(300);
    expect(screen.getByLabelText("說明")).toHaveValue("晚餐");
  });

  it("says who recorded it, and links the last edit to the record's history", () => {
    renderForm(
      {
        initial: initial({
          createdBy: 2,
          lastActivity: { actorId: 1, at: "2026-07-11T04:00:00Z" },
        }),
      },
      {},
    );
    expect(screen.getByText(/由 Bob .*記錄/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /最後由 .* 修改/ })).toHaveAttribute(
      "href",
      "/mini/groups/7/activity?record=11",
    );
  });

  it("links the history under /app in the Web App", () => {
    renderForm(
      { initial: initial({ lastActivity: { actorId: 2, at: "2026-07-11T04:00:00Z" } }) },
      {},
      "web",
    );
    expect(screen.getByRole("link", { name: /最後由 Bob .* 修改/ })).toHaveAttribute(
      "href",
      "/app/groups/7/activity?record=11",
    );
  });

  it("has no last-edit link for a record nobody has edited", () => {
    renderForm({ initial: initial() }, {});
    expect(screen.queryByRole("link", { name: /最後由/ })).not.toBeInTheDocument();
  });

  it("saves an untouched shares split as shares, with its weights", async () => {
    const w = writes({ ok: true });
    renderForm(
      {
        initial: initial({
          splits: [
            { debtorId: 1, amount: 200, shareType: "shares", splitValue: 2 },
            { debtorId: 2, amount: 100, shareType: "shares", splitValue: 1 },
          ],
        }),
      },
      { "/api/groups/7/expenses/11": w.handler },
    );
    await submit();

    await waitFor(() => expect(w.sent).toHaveLength(1));
    const { method, body } = w.sent[0];
    expect(method).toBe("PATCH");
    expect(body!.shareType).toBe("shares");
    expect(body!.splits.map((s) => [s.debtorId, s.amount, s.splitValue])).toEqual([
      [1, 200, 2],
      [2, 100, 1],
    ]);
  });

  it("keeps an old shares record (no saved weights) as shares on a description-only edit", async () => {
    // Loads as exact, since the weights are gone; saving must not rewrite it as exact.
    const w = writes({ ok: true });
    renderForm(
      {
        initial: initial({
          splits: [
            { debtorId: 1, amount: 200, shareType: "shares", splitValue: null },
            { debtorId: 2, amount: 100, shareType: "shares", splitValue: null },
          ],
        }),
      },
      { "/api/groups/7/expenses/11": w.handler },
    );
    fireEvent.change(screen.getByLabelText("說明"), { target: { value: "宵夜" } });
    await submit();

    await waitFor(() => expect(w.sent).toHaveLength(1));
    const body = w.sent[0].body!;
    expect(body.description).toBe("宵夜");
    expect(body.shareType).toBe("shares");
    expect(body.splits.map((s) => [s.debtorId, s.amount])).toEqual([
      [1, 200],
      [2, 100],
    ]);
  });

  it("keeps saved multi-payer amounts instead of re-splitting them evenly", async () => {
    const w = writes({ ok: true });
    renderForm(
      {
        initial: initial({
          payers: [
            { payerId: 1, amount: 210 },
            { payerId: 2, amount: 90 },
          ],
        }),
      },
      { "/api/groups/7/expenses/11": w.handler },
    );
    await submit();

    await waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0].body!.payers).toEqual([
      { payerId: 1, amount: 210 },
      { payerId: 2, amount: 90 },
    ]);
  });

  it("keeps a rate pinned against the current default currency when saving", async () => {
    const w = writes({ ok: true });
    renderForm(
      { initial: initial({ currency: "JPY", fxRate: 0.21, fxQuote: "TWD" }) },
      {
        [RATE_PATH]: { rate: 0.2, source: "market" },
        "/api/groups/7/expenses/11": w.handler,
      },
    );
    // The placeholder only shows once the rate query answered, so the route matched.
    expect(await screen.findByPlaceholderText("0.2（自動）")).toHaveValue(0.21);
    await submit();

    await waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0].body).toMatchObject({ currency: "JPY", fxRate: 0.21 });
  });

  it("doesn't revive a dormant pin (quoted in an old default currency) on save", async () => {
    const w = writes({ ok: true });
    renderForm(
      { initial: initial({ currency: "JPY", fxRate: 0.21, fxQuote: "USD" }) },
      {
        [RATE_PATH]: { rate: 0.2, source: "market" },
        "/api/groups/7/expenses/11": w.handler,
      },
    );
    expect(await screen.findByPlaceholderText("0.2（自動）")).toHaveValue(null);
    await submit();

    // Sending 0.21 would have the server stamp it as a TWD pin; null leaves the dormant
    // one alone (the PATCH preserves it).
    await waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0].body).toMatchObject({ currency: "JPY", fxRate: null });
  });
});

describe("ExpenseForm: receipts", () => {
  it("shows a saved receipt from its signed link and keeps it on save", async () => {
    const w = writes({ ok: true });
    renderForm(
      {
        initial: initial({
          receiptFileIds: ["file-a"],
          receiptUrls: { "file-a": "/api/tg-photo?fileId=file-a&sig=abc" },
        }),
      },
      { "/api/groups/7/expenses/11": w.handler },
    );
    // Only the server can sign the link; the form must use it, not build its own.
    expect(screen.getByRole("img", { name: "收據 1" })).toHaveAttribute(
      "src",
      "/api/tg-photo?fileId=file-a&sig=abc",
    );
    fireEvent.change(screen.getByLabelText("說明"), { target: { value: "宵夜" } });
    await submit();

    await waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0].body).toMatchObject({ receiptFileIds: ["file-a"] });
  });

  it("shows an uploaded receipt from the link the upload returned, and saves its id", async () => {
    upload.mockResolvedValue(
      new Response(JSON.stringify({ fileId: "file-b", url: "/api/tg-photo?fileId=file-b&sig=x" })),
    );
    const w = writes();
    renderForm({}, { "/api/groups/7/expenses": w.handler });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "r.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByRole("img", { name: "收據 1" })).toHaveAttribute(
      "src",
      "/api/tg-photo?fileId=file-b&sig=x",
    );
    expect(upload).toHaveBeenCalledWith(
      "/api/tg-upload",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "300" } });
    await submit();
    await waitFor(() => expect(w.sent).toHaveLength(1));
    expect(w.sent[0].body).toMatchObject({ receiptFileIds: ["file-b"] });
  });
});

describe("ExpenseForm: deleting", () => {
  it("names whoever recorded it before deleting someone else's expense", async () => {
    renderForm({ initial: initial({ createdBy: 2 }) }, {});
    fireEvent.click(screen.getByRole("button", { name: "刪除" }));
    expect(await screen.findByText("這筆是 Bob 記錄的，刪除後無法復原。")).toBeInTheDocument();
  });

  it("deletes after confirming and goes back", async () => {
    const w = writes({ ok: true });
    renderForm({ initial: initial() }, { "/api/groups/7/expenses/11": w.handler });
    fireEvent.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("這筆支出將被永久刪除。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "刪除" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/mini/groups/7"));
    expect(w.sent.map((s) => s.method)).toEqual(["DELETE"]);
  });

  it("says the expense is already gone when someone else deleted it first", async () => {
    renderForm({ initial: initial() }, { "/api/groups/7/expenses/11": new Failure(404) });
    fireEvent.click(screen.getByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "刪除" }));

    expect(
      await screen.findByText("這筆支出已經不在了，可能剛剛被其他人刪除。"),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
