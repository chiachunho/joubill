import type { ReactNode } from "react";

import { RadioCard } from "@/components/mini/RadioCard";
import type { SelfSettlementChoice } from "@/lib/member-merge";

/**
 * What to do with repayments that a merge turns into someone repaying themselves, asked
 * the same way by both merges (a placeholder into a member, one account into another).
 */
export function SelfSettlementsChoice({
  legend,
  value,
  onChange,
  disabled,
}: {
  legend: ReactNode;
  value: SelfSettlementChoice;
  onChange: (value: SelfSettlementChoice) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="mb-1 font-medium">{legend}</legend>
      <RadioCard
        name="self-settlements"
        checked={value === "keep"}
        onChange={() => onChange("keep")}
        disabled={disabled}
        hint="之後不能再編輯，只能刪除。"
      >
        保留這些還款
      </RadioCard>
      <RadioCard
        name="self-settlements"
        checked={value === "delete"}
        onChange={() => onChange("delete")}
        disabled={disabled}
        hint="不影響餘額，動態紀錄和群組訊息會留下刪除紀錄。"
      >
        一併刪除這些還款
      </RadioCard>
    </fieldset>
  );
}
