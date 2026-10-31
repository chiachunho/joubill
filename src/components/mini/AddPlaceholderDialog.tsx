"use client";

import { MemberNameDialog } from "@/components/mini/MemberNameDialog";
import { apiErrorText } from "@/lib/api-error";
import { useAddPlaceholderMemberMutation } from "@/store/api";

/**
 * 新增沒有帳號的成員: the name dialog plus the request behind it. Opened from
 * `AddMemberDialog` (群組設定 and the one-person group card both go through it), so the
 * duplicate-name error (the server answers it) and the generic failure text are handled
 * in one place. The mutation invalidates `Members`.
 */
export function AddPlaceholderDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [addPlaceholderMember] = useAddPlaceholderMemberMutation();

  return (
    <MemberNameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="新增成員"
      description="沒有帳號的成員也能當付款人或分攤者。"
      confirmLabel="新增"
      onSubmit={async (name) => {
        try {
          await addPlaceholderMember({ groupId, firstName: name }).unwrap();
          onOpenChange(false);
          return null;
        } catch (e) {
          return apiErrorText(e, "儲存失敗，請再試一次");
        }
      }}
    />
  );
}
