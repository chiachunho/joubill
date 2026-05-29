"use client";

import { Avatar } from "@/components/mini/Avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelMember } from "@/lib/label";

type Member = { id: number; firstName: string | null; lastName?: string | null; username: string | null };

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  members: Member[];
  photos?: Record<number, string | null>;
  placeholder?: string;
};

export function MemberSelect({ value, onValueChange, members, photos, placeholder }: Props) {
  const selected = members.find((m) => String(m.id) === value);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        {selected ? (
          <span className="!flex items-center gap-2 min-w-0 overflow-hidden">
            <Avatar
              src={photos?.[selected.id] ?? null}
              name={labelMember(selected)}
              userId={selected.id}
              size="xs"
            />
            <span className="truncate">{labelMember(selected)}</span>
          </span>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.id} value={String(m.id)} textValue={labelMember(m)}>
            <span className="flex items-center gap-2">
              <Avatar
                src={photos?.[m.id] ?? null}
                name={labelMember(m)}
                userId={m.id}
                size="xs"
              />
              {labelMember(m)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
