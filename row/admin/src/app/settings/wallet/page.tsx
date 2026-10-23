"use client";

/**
 * SuperAdmin › Wallet.
 * --------------------------------------------------------------------------
 * One place for email credits:
 *   • Offline button — Super Admin gives credits by hand (the former Settings › Credit Management).
 *   • Online button  — Club Wallet / District Wallet / Reports (club-website pricing, shareable
 *                      credit top-up links, purchase reports).
 *   • Otherwise, always on screen: every credit entry, Offline and Online, in one list.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Globe, HandCoins, X } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PricingRemindersTab from "./PricingRemindersTab";
import DistrictWalletTab from "./DistrictWalletTab";
import WalletReportsTab from "./WalletReportsTab";
import AllCreditsList from "./AllCreditsList";
import CreditManagementPanel from "../credit-management/CreditManagementPanel";

type View = "" | "offline" | "online";
const VIEWS: View[] = ["offline", "online"];

function WalletContent() {
  const params = useSearchParams();
  const initial = params.get("view");
  const [view, setView] = useState<View>(VIEWS.includes(initial as View) ? (initial as View) : "");
  const [refreshKey, setRefreshKey] = useState(0);

  const toggle = (v: Exclude<View, "">) => setView((cur) => (cur === v ? "" : v));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="icon" asChild>
          <Link href="/settings" aria-label="Back to Settings"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-primary">Wallet</h1>
          <p className="text-sm text-muted-foreground">Email credits: given offline or bought online. And club-website pricing</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === "offline" ? "default" : "outline"} onClick={() => toggle("offline")}>
            <HandCoins className="h-4 w-4 mr-1.5" /> Offline
          </Button>
          <Button variant={view === "online" ? "default" : "outline"} onClick={() => toggle("online")}>
            <Globe className="h-4 w-4 mr-1.5" /> Online
          </Button>
        </div>
      </div>

      {view !== "" && (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {view === "offline" ? "Offline credit: given by Super Admin" : "Online: wallet, top-up links & purchase reports"}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setView("")}>
              <X className="h-4 w-4 mr-1" /> Close
            </Button>
          </div>
          {view === "offline" ? (
            <CreditManagementPanel embedded onChanged={() => setRefreshKey((k) => k + 1)} />
          ) : (
            <Tabs defaultValue="club" className="space-y-4">
              <TabsList>
                <TabsTrigger value="club">Club Wallet</TabsTrigger>
                <TabsTrigger value="district">District Wallet</TabsTrigger>
                <TabsTrigger value="reports">Reports</TabsTrigger>
              </TabsList>
              <TabsContent value="club"><PricingRemindersTab /></TabsContent>
              <TabsContent value="district"><DistrictWalletTab /></TabsContent>
              <TabsContent value="reports"><WalletReportsTab /></TabsContent>
            </Tabs>
          )}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">All Email Credits</h2>
          <p className="text-sm text-muted-foreground">
            Every credit entry for clubs and districts: <b>Offline</b> (given by Super Admin) and <b>Online</b> (bought by the club or district).
          </p>
        </div>
        <AllCreditsList refreshKey={refreshKey} />
      </div>
    </div>
  );
}

export default function WalletPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <WalletContent />
      </Suspense>
    </ProtectedRoute>
  );
}
