import { fmt } from "@/lib/money";

import { CardAvatar } from "./components";
import { renderToPng } from "./render";
import { CARD } from "./theme";

const WIDTH = 800;

export type BalanceRow = { userId: number; name: string; amount: number };

export async function renderBalanceCard(opts: {
  title: string;
  currency: string;
  rows: BalanceRow[];
  dateLabel: string;
  avatars: Record<number, string | null>;
}): Promise<Buffer> {
  const { title, currency, rows, dateLabel, avatars } = opts;

  const element = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: WIDTH,
        padding: 40,
        backgroundColor: CARD.background,
        fontFamily: "Huninn",
        color: CARD.foreground,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 20, color: CARD.muted }}>
          餘額 · {currency}
        </div>
      </div>

      {/* Panel */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: CARD.panel,
          borderRadius: 24,
          paddingLeft: 24,
          paddingRight: 24,
        }}
      >
        {rows.map((r, i) => (
          <div
            key={r.userId}
            style={{
              display: "flex",
              alignItems: "center",
              paddingTop: 20,
              paddingBottom: 20,
              borderBottom: i === rows.length - 1 ? "none" : `1px solid ${CARD.border}`,
            }}
          >
            <CardAvatar userId={r.userId} name={r.name} dataUrl={avatars[r.userId] ?? null} size={56} />
            <div
              style={{
                display: "flex",
                flex: 1,
                minWidth: 0,
                marginLeft: 18,
                marginRight: 18,
                fontSize: 28,
                whiteSpace: "nowrap",
              }}
            >
              {r.name}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: r.amount >= 0 ? CARD.positive : CARD.negative,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {r.amount >= 0 ? "+" : "-"}
              {fmt(Math.abs(r.amount))} {currency}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", marginTop: 24, fontSize: 18, color: CARD.muted }}>
        {dateLabel}
      </div>
    </div>
  );

  const glyphText =
    title +
    dateLabel +
    currency +
    rows.map((r) => r.name).join("") +
    rows.map((r) => fmt(Math.abs(r.amount))).join("") +
    "餘額·+-, 0123456789";

  return renderToPng(element, glyphText, WIDTH);
}
