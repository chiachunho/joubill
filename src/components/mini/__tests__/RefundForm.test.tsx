import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/AuthProvider";
import { RefundForm } from "@/components/mini/RefundForm";
import { localDateToDay } from "@/lib/day";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mini/groups/7/expenses/11/refunds/new",
}));
// Loads @twa-dev/sdk, which has nothing to talk to outside Telegram.
vi.mock("@/lib/use-tg-back-button", () => ({ useTelegramBackButton: () => {} }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const MEMBERS = [
  { id: 1, displayName: null, firstName: "Alice", username: null },
  { id: 2, displayName: null, firstName: "Bob", username: null },
];

const PARENT = {
  id: 11,
  description: "晚餐",
  currency: "JPY",
  spentAt: "2026-07-10",
  splits: [
    { userId: 1, amount: 1500 },
    { userId: 2, amount: 1500 },
  ],
  payers: [{ userId: 1, amount: 3000 }],
};

describe("RefundForm", () => {
  it("says each person's share back with its currency, and ≈ in the group's", async () => {
    // A new refund is dated today, and the rate is asked for that day.
    const today = localDateToDay(new Date());
    render(
      <AuthProvider mode="tma">
        <StoreWrapper
          request={fakeRequest({
            [`/api/groups/7/rates/effective?base=JPY&date=${today}`]: {
              rate: 0.2,
              source: "group",
            },
          })}
        >
          <RefundForm
            groupId={7}
            defaultCurrency="TWD"
            currentUserId={1}
            members={MEMBERS}
            parent={PARENT}
            returnPath="/mini/groups/7/expenses/11/edit"
          />
        </StoreWrapper>
      </AuthProvider>,
    );
    fireEvent.change(screen.getByLabelText("金額"), { target: { value: "100" } });

    expect(await screen.findAllByText("≈ 10.00 TWD")).toHaveLength(2);
    // 50.00 with its currency, not a bare number.
    expect(screen.getAllByText((_, el) => el?.textContent === "50.00 JPY")).toHaveLength(2);
  });
});
