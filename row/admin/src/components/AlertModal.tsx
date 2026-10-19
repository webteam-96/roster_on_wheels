"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type LucideIcon } from "@/components/icons";
import { type ReactNode } from "react";

// ── Theme constants (change here to reflect everywhere) ──
const MODAL_CONTENT = "max-w-md text-center";
const MODAL_HEADER = "flex flex-col items-center sm:text-center";
const MODAL_ICON = "h-16 w-16 mb-2";
const MODAL_TITLE = "text-xl";
const MODAL_DESCRIPTION = "text-base";
const MODAL_FOOTER = "sm:justify-center gap-2";
const MODAL_BUTTON = "px-8";

export interface AlertModalProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  confirmClassName?: string;
  onConfirm: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
}

export default function AlertModal({
  open,
  onOpenChange,
  icon: Icon,
  iconClassName = "",
  title,
  description,
  confirmLabel,
  confirmClassName = "",
  onConfirm,
  cancelLabel,
  onCancel,
}: AlertModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={MODAL_CONTENT}>
        <AlertDialogHeader className={MODAL_HEADER}>
          <Icon className={`${MODAL_ICON} ${iconClassName}`} />
          <AlertDialogTitle className={MODAL_TITLE}>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className={MODAL_DESCRIPTION}>
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className={MODAL_FOOTER}>
          {cancelLabel && onCancel && (
            <AlertDialogCancel onClick={onCancel} className={MODAL_BUTTON}>
              {cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={onConfirm}
            className={`${MODAL_BUTTON} ${confirmClassName}`}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
