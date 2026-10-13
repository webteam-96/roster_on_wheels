"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { verifyPublicEventPayment } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

import { currencySymbol } from "@/lib/appFormat";
export default function ThankYouPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const linkId = Number(params.linkId);
  const orderId = searchParams.get("orderId") || "";
  const memberPaymentId = searchParams.get("memberPaymentId") || "0";

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<{
    isSuccess: boolean;
    orderStatus?: string;
    memberName?: string;
    amount?: number;
    registrationType?: string;
    paymentDate?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!orderId) {
      setError("Missing payment reference.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await verifyPublicEventPayment(linkId, orderId, Number(memberPaymentId));
        setResult(data);
      } catch {
        setError("Unable to verify payment status. Please contact the event organizer.");
      } finally {
        setLoading(false);
      }
    })();
  }, [linkId, orderId, memberPaymentId]);

  // Auto-redirect countdown after verification completes
  useEffect(() => {
    if (loading || (!result && !error)) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push(`/pay/${linkId}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loading, result, error, linkId, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Verifying your payment...</h3>
            <p className="text-muted-foreground mt-2">Please wait while we confirm your transaction.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <XCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold">Payment Status Unknown</h3>
            <p className="text-muted-foreground mt-2">{error}</p>
            <p className="text-sm text-muted-foreground mt-4">Redirecting in {countdown} seconds...</p>
            <Button className="mt-4" onClick={() => router.push(`/pay/${linkId}`)}>
              Go to Payment Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="max-w-md w-full mx-4">
        <CardContent className="pt-8 pb-8 text-center">
          {result?.isSuccess ? (
            <>
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-green-700">Payment Successful!</h3>
              <div className="mt-6 space-y-3 text-left bg-green-50 p-4 rounded-lg">
                {result.memberName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{result.memberName}</span>
                  </div>
                )}
                {result.registrationType && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Registration</span>
                    <span className="font-medium">{result.registrationType}</span>
                  </div>
                )}
                {result.amount != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold text-green-700">{currencySymbol()}{result.amount.toFixed(2)}</span>
                  </div>
                )}
                {result.paymentDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="font-medium">{new Date(result.paymentDate).toLocaleDateString()}</span>
                  </div>
                )}
                {orderId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reference</span>
                    <span className="font-medium text-sm">{orderId}</span>
                  </div>
                )}
              </div>
              <p className="mt-4 text-sm text-muted-foreground">A receipt has been sent to your email.</p>
              <p className="text-sm text-muted-foreground mt-2">Redirecting in {countdown} seconds...</p>
              <Button className="mt-4" onClick={() => router.push(`/pay/${linkId}`)}>
                Go to Payment Page
              </Button>
            </>
          ) : (
            <>
              <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-destructive">Payment Failed</h3>
              <p className="text-muted-foreground mt-2">Your payment could not be processed.</p>
              <p className="text-sm text-muted-foreground mt-1">Status: {result?.orderStatus || "Unknown"}</p>
              <p className="text-sm text-muted-foreground mt-2">Redirecting in {countdown} seconds...</p>
              <Button className="mt-4" onClick={() => router.push(`/pay/${linkId}`)}>
                Try Again
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
