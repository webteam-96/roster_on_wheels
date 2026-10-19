"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "@/components/icons";

import { appLocale, currencySymbol } from "@/lib/appFormat";
function ThankYouInner() {
  const query = useSearchParams();
  const paid = query.get("paid") === "1";
  const amount = query.get("amount");
  const club = query.get("club");

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-lg w-full max-w-md p-8 text-center space-y-4">
        {paid ? (
          <>
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
            <h1 className="text-xl font-bold">Payment successful</h1>
            {amount && <p className="text-lg">{currencySymbol()}{Number(amount).toLocaleString(appLocale())}</p>}
            {club && <p className="text-muted-foreground">{club}</p>}
            <p className="text-sm text-muted-foreground">A receipt has been emailed to the club officer.</p>
          </>
        ) : (
          <>
            <XCircle className="h-16 w-16 text-red-600 mx-auto" />
            <h1 className="text-xl font-bold">Payment not confirmed</h1>
            <p className="text-sm text-muted-foreground">If money was debited it will auto-reconcile shortly (webhook). Otherwise try again from the pay link.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ClubDuesThankYouPage() {
  return <Suspense fallback={null}><ThankYouInner /></Suspense>;
}
