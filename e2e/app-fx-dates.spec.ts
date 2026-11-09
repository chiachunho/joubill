import { expect, test } from "./fixtures";
import { balances } from "./helpers";

// Two JPY records on different days must convert at their own day's market rate. Before the
// fix `getRate` took the newest cached row on or before the date with no lower bound, so the
// first cached JPY→TWD rate was reused for every later date.
const DAY_A = "2019-03-01";
const DAY_B = "2019-03-20"; // 19 days later: beyond the 7-day cache tolerance
const RATE_A = 0.2;
const RATE_B = 0.25;

test.describe("Market rate follows the record's date", () => {
  // Both cases insert and then delete the same rows of the shared exchange_rates table.
  // Under fullyParallel one case's cleanup deleted the other's rows mid-run, so its rate
  // lookup missed the cache, the FX API call failed and marketRate came back null.
  test.describe.configure({ mode: "default" });

  test("two foreign-currency records convert at their own day's rate", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const days = [DAY_A, DAY_B];
    const clear = () =>
      dbPool.query(
        "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = ANY($1::date[])",
        [days],
      );
    await clear();
    await dbPool.query(
      "INSERT INTO exchange_rates (base, quote, rate, as_of_date) VALUES ('JPY','TWD',$1,$2), ('JPY','TWD',$3,$4)",
      [RATE_A, DAY_A, RATE_B, DAY_B],
    );

    try {
      const { request } = authedPage;
      const before = await balances(request, seeded.groupId);
      for (const day of days) {
        const res = await request.post(`/api/groups/${seeded.groupId}/expenses`, {
          data: {
            amount: 10000,
            currency: "JPY",
            description: `E2E fx ${day} ${Date.now()}`,
            spentAt: day,
            shareType: "exact",
            payers: [{ payerId: seeded.userId, amount: 10000 }],
            splits: [{ debtorId: seeded.partnerId, amount: 10000 }],
          },
        });
        expect(res.status(), await res.text()).toBe(201);
      }

      const after = await balances(request, seeded.groupId);
      // 10,000 × 0.20 + 10,000 × 0.25 = 4,500. One shared rate would give 4,000 or 5,000.
      const gained = (after.get(seeded.userId) ?? 0) - (before.get(seeded.userId) ?? 0);
      expect(gained).toBeCloseTo(4500, 1);
    } finally {
      await clear();
    }
  });

  test("the rate hint follows the chosen date", async ({ authedPage, seeded, dbPool }) => {
    const days = [DAY_A, DAY_B];
    const clear = () =>
      dbPool.query(
        "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = ANY($1::date[])",
        [days],
      );
    await clear();
    await dbPool.query(
      "INSERT INTO exchange_rates (base, quote, rate, as_of_date) VALUES ('JPY','TWD',$1,$2), ('JPY','TWD',$3,$4)",
      [RATE_A, DAY_A, RATE_B, DAY_B],
    );
    try {
      for (const [day, rate] of [
        [DAY_A, RATE_A],
        [DAY_B, RATE_B],
      ] as const) {
        const res = await authedPage.request.get(
          `/api/groups/${seeded.groupId}/rates/effective?base=JPY&date=${day}`,
        );
        expect(res.ok()).toBe(true);
        const body = (await res.json()) as { marketRate: number };
        expect(body.marketRate).toBeCloseTo(rate, 6);
      }
    } finally {
      await clear();
    }
  });
});
