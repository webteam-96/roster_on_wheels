"use client";

import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CreditCard, Shirt, LinkIcon, BadgeDollarSign, Building2 } from "lucide-react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const cards = [
  {
    title: "Cashfree KYC",
    description: "Manage Cashfree vendor KYC settings",
    icon: CreditCard,
    href: "/settings/cashfree-kyc",
  },
  {
    title: "Shirt & Food Preference Master",
    description: "Manage t-shirt sizes & food preferences",
    icon: Shirt,
    href: "/settings/event-masters",
  },
  // {
  //   title: "Event Payment Links",
  //   description: "Create & manage event payment links",
  //   icon: LinkIcon,
  //   href: "/settings/event-payment-links",
  // },
  {
    title: "Club Dues",
    description: "Manage Club Dues & payments",
    icon: BadgeDollarSign,
    href: "/settings/membership-dues",
  },
  {
    title: "District Dues",
    description: "District-wise district dues collection (Razorpay)",
    icon: Building2,
    href: "/settings/club-dues",
  },
];

export default function PaymentsAndDuesPage() {
  const { isSuperAdmin } = useAuth();

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Payments & Dues</h2>
            <p className="text-muted-foreground text-base">Payment gateway, event payments and Club Dues</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <Link key={card.href} href={card.href}>
              <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <card.icon className="h-7 w-7" />
                  </div>
                  <h3 className="text-lg font-semibold text-primary">{card.title}</h3>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </ProtectedRoute>
  );
}
