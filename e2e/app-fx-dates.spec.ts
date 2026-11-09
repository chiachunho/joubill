import type { Pool } from "@neondatabase/serverless";

import { expect, test } from "./fixtures";
import { balances } from "./helpers";

// Two JPY records on different days must convert at their own day's market rate. Before the
// fix `getRate` took the newest cached row on or before the date with no lower bound, so the
// first cached JPY→TWD rate was reused for every later date. The cache now holds one row per
// day, so each day below is answered by its own row.
const RATE_A = 0.2;
const RATE_B = 0.25;

/**
 * Seeds JPY→TWD market rates for `rows` (day → rate), runs `body`, then removes them.
 * `exchange_rates` is shared by the whole database, so every case uses days of its own:
 * cases run in parallel, and one case's cleanup must never delete rows another is reading
 * (its lookup would miss the cache, the FX API call fail and marketRate come back null).
 */
async function withJpyRates(dbPool: Pool, rows: Record<string, number>, body: () => Promise<void>) {
  const days = Object.keys(rows);
  const clear = () =>
    dbPool.query(
      "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = ANY($1::date[])",
      [days],
    );
  await clear();
  for (const [day, rate] of Object.entries(rows)) {
    await dbPool.query(
      "INSERT INTO exchange_rates (base, quote, rate, as_of_date) VALUES ('JPY','TWD',$1,$2)",
      [rate, day],
    );
  }
  try {
    await body();
  } finally {
    await clear();
  }
}

test.describe("Market rate follows the record's date", () => {
  test("two foreign-currency records convert at their own day's rate", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const days = ["2019-03-01", "2019-03-20"];
    await withJpyRates(dbPool, { [days[0]]: RATE_A, [days[1]]: RATE_B }, async () => {
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
    });
  });

  test("the rate hint follows the chosen date", async ({ authedPage, seeded, dbPool }) => {
    const rates = { "2019-04-01": RATE_A, "2019-04-20": RATE_B };
    await withJpyRates(dbPool, rates, async () => {
      for (const [day, rate] of Object.entries(rates)) {
        const res = await authedPage.request.get(
          `/api/groups/${seeded.groupId}/rates/effective?base=JPY&date=${day}`,
        );
        expect(res.ok()).toBe(true);
        const body = (await res.json()) as { marketRate: number };
        expect(body.marketRate).toBeCloseTo(rate, 6);
      }
    });
  });
});
