"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PLACEHOLDER_NAME_MAX } from "@/lib/placeholder";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialName?: string;
  confirmLabel: string;
  /** Resolve to an error message to show, or null on success. */
  onSubmit: (name: string) => Promise<string | null>;
};

/** Name entry for a member who has no account (add / rename). */
export function MemberNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  confirmLabel,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
    }
  }, [open, initialName]);

  async function submit() {
    if (loading || !name.trim()) return;
    setLoading(true);
    setError(null);
    const message = await onSubmit(name).catch(() => "儲存失敗，請再試一次");
    setLoading(false);
    if (message) setError(message);
  }

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={PLACEHOLDER_NAME_MAX}
            placeholder="名字"
            aria-label="名字"
            autoFocus
            disabled={loading}
          />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-lg"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            取消
          </Button>
          <Button className="flex-1 rounded-lg" onClick={submit} disabled={loading || !name.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
