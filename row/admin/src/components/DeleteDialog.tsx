"use client";

import AlertModal from "@/components/AlertModal";
import { AlertTriangle } from "@/components/icons";

interface DeleteDialogProps {
  open: boolean;
  memberName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteDialog({
  open,
  memberName,
  onConfirm,
  onCancel,
}: DeleteDialogProps) {
  return (
    <AlertModal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      icon={AlertTriangle}
      iconClassName="text-destructive"
      title="Delete Member"
      description={
        <>
          Are you sure you want to delete{" "}
          <span className="font-semibold text-foreground">{memberName}</span>?
          This action cannot be undone.
        </>
      }
      confirmLabel="Delete"
      confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      onConfirm={onConfirm}
      cancelLabel="Cancel"
      onCancel={onCancel}
    />
  );
}
