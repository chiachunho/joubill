import { fmt } from "@/lib/money";

import { CardAvatar } from "./components";
import { renderToPng } from "./render";
import { CARD } from "./theme";

const WIDTH = 800;

export type SettleRow = {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  amount: number;
};

export async function renderSettleCard(opts: {
  title: string;
  currency: string;
  rows: SettleRow[];
  avatars: Record<number, string | null>;
}): Promise<Buffer> {
  const { title, currency, rows, avatars } = opts;

  const person = (userId: number, name: string) => (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      <CardAvatar userId={userId} name={name} dataUrl={avatars[userId] ?? null} size={48} />
      <div style={{ display: "flex", marginLeft: 14, fontSize: 26, whiteSpace: "nowrap" }}>{name}</div>
    </div>
  );

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
        <div style={{ display: "flex", fontSize: 20, color: CARD.muted }}>還款建議</div>
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
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              paddingTop: 20,
              paddingBottom: 20,
              borderBottom: i === rows.length - 1 ? "none" : `1px solid ${CARD.border}`,
            }}
          >
            {person(r.fromUserId, r.fromName)}
            <div
              style={{
                display: "flex",
                marginLeft: 18,
                marginRight: 18,
                fontSize: 28,
                color: CARD.muted,
                flexShrink: 0,
              }}
            >
              →
            </div>
            {person(r.toUserId, r.toName)}
            <div style={{ display: "flex", flex: 1, minWidth: 24 }} />
            <div
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                color: CARD.foreground,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {fmt(r.amount)} {currency}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", marginTop: 24, fontSize: 18, color: CARD.muted }}>
        共 {rows.length} 筆 · {currency}
      </div>
    </div>
  );

  const glyphText =
    title +
    currency +
    rows.map((r) => r.fromName + r.toName).join("") +
    rows.map((r) => fmt(r.amount)).join("") +
    "還款建議共筆·→ 0123456789.,";

  return renderToPng(element, glyphText, WIDTH);
}
