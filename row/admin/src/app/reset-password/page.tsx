"use client";

import { Suspense } from "react";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { SkeletonRows } from "@/components/row/AppKit";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[80vh] items-center justify-center">
          <SkeletonRows />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
