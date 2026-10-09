"use client";

// Gated "Add" button: shows the "I Agree" disclaimer ON the current (listing)
// page. Cancel just closes it (no navigation); "I Agree & Continue" navigates to
// the add form. When `message` is empty, it navigates directly (no gate).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Info } from "lucide-react";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";

const DEFAULT_CLASS =
  "inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700";

export default function AgreeAddButton({
  message,
  href,
  label,
  className,
}: {
  message: string;
  href: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const go = () => { setOpen(false); setNavigating(true); router.push(href); };

  const onClick = () => {
    if (message && message.trim()) setOpen(true);
    else go();
  };

  return (
    <>
      <button type="button" onClick={onClick} className={className ?? DEFAULT_CLASS}>
        <Plus size={13} /> {label}
      </button>
      <AlertModal
        open={open}
        onOpenChange={(o) => !o && setOpen(false)}
        icon={Info}
        iconClassName="text-blue-500"
        title="I Agree"
        description={<div className="whitespace-pre-line text-sm text-muted-foreground">{message}</div>}
        confirmLabel="I Agree & Continue"
        onConfirm={go}
        cancelLabel="Cancel"
        onCancel={() => setOpen(false)}
      />
      {navigating && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-white/70">
          <RotaryLoader size="lg" />
        </div>
      )}
    </>
  );
}
