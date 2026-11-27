"use client";

import { PageHeader } from "@/components/row/AppKit";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Shirt, LinkIcon, BadgeDollarSign, Building2 } from "@/components/icons";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

// Cashfree KYC is not offered on ROW (India-only payment provider).
const cards = [
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
    description: "District-wise district dues collection",
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
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title={<>Payments & Dues</>} description="Payment gateway, event payments and Club Dues" back="/settings" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <Link key={card.href} href={card.href}>
              <Card className="hover:border-primary/50 transition-all cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <card.icon className="h-7 w-7" />
                  </div>
                  <h3 className="row-h2">{card.title}</h3>
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
