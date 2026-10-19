"use client";

import AlertModal from "@/components/AlertModal";
import { AlertCircle } from "@/components/icons";

interface ErrorAlertProps {
  open: boolean;
  title: string;
  description: string;
  onOk: () => void;
}

export default function ErrorAlert({ open, title, description, onOk }: ErrorAlertProps) {
  return (
    <AlertModal
      open={open}
      icon={AlertCircle}
      iconClassName="text-destructive"
      title={title}
      description={description}
      confirmLabel="OK"
      onConfirm={onOk}
    />
  );
}
