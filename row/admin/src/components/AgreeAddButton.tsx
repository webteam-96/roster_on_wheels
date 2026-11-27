"use client";

// Gated "Add" button: shows the "I Agree" disclaimer ON the current (listing)
// page. Cancel just closes it (no navigation); "I Agree & Continue" navigates to
// the add form. When `message` is empty, it navigates directly (no gate).

import { Button } from "@/components/ui/button"
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Info } from "@/components/icons";
import AlertModal from "@/components/AlertModal";
import RotaryLoader from "@/components/RotaryLoader";

import AgreeText from "@/components/AgreeText";
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
      <Button size="sm" className={className} type="button" onClick={onClick}>
        <Plus size={13} /> {label}
      </Button>
      <AlertModal
        open={open}
        onOpenChange={(o) => !o && setOpen(false)}
        icon={Info}
        iconClassName="text-blue-500"
        title="I Agree"
        description={<div className="whitespace-pre-line text-sm text-muted-foreground"><AgreeText text={message} /></div>}
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
