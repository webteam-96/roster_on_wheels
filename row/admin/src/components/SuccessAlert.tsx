"use client";

import AlertModal from "@/components/AlertModal";
import { CheckCircle2 } from "@/components/icons";

interface SuccessAlertProps {
  open: boolean;
  title: string;
  description: string;
  onOk: () => void;
}

export default function SuccessAlert({ open, title, description, onOk }: SuccessAlertProps) {
  return (
    <AlertModal
      open={open}
      icon={CheckCircle2}
      iconClassName="text-green-500"
      title={title}
      description={description}
      confirmLabel="OK"
      onConfirm={onOk}
    />
  );
}
