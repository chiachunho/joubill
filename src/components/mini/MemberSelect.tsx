"use client";

import { Avatar } from "@/components/mini/Avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { memberLabels } from "@/lib/label";

type Member = {
  id: number;
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  members: Member[];
  photos?: Record<number, string | null>;
  placeholder?: string;
};

export function MemberSelect({ value, onValueChange, members, photos, placeholder }: Props) {
  const selected = members.find((m) => String(m.id) === value);
  // Display names are free text, so two members can read the same; the picker must not offer
  // two identical rows.
  const labels = memberLabels(members);
  const label = (m: Member) => labels.get(m.id) ?? "?";
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        {selected ? (
          <span className="!flex min-w-0 items-center gap-2 overflow-hidden">
            <Avatar
              src={photos?.[selected.id] ?? null}
              name={label(selected)}
              userId={selected.id}
              size="xs"
            />
            <span className="truncate">{label(selected)}</span>
          </span>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.id} value={String(m.id)} textValue={label(m)}>
            <span className="flex items-center gap-2">
              <Avatar src={photos?.[m.id] ?? null} name={label(m)} userId={m.id} size="xs" />
              {label(m)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
