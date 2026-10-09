"use client";

/**
 * SuperAdmin › Wallet.
 * --------------------------------------------------------------------------
 * One place for WhatsApp/Email credits:
 *   • Offline button — Super Admin gives credits by hand (the former Settings › Credit Management).
 *   • Online button  — Club Wallet / District Wallet / Reports (club-website pricing, shareable
 *                      credit top-up links, purchase reports).
 *   • RI Director Credits — the RI Director credit pool (same screen as /ri-director/credits).
 *     Shown on its own: the Offline/Online list below is hidden while it is open.
 *   • Otherwise, always on screen: every credit entry, Offline and Online, in one list.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Globe, HandCoins, Landmark, X } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PricingRemindersTab from "./PricingRemindersTab";
import DistrictWalletTab from "./DistrictWalletTab";
import WalletReportsTab from "./WalletReportsTab";
import AllCreditsList from "./AllCreditsList";
import CreditManagementPanel from "../credit-management/CreditManagementPanel";
import RiDirectorCreditsPanel from "../../ri-director/credits/RiDirectorCreditsPanel";

type View = "" | "offline" | "online" | "ri-director";
const VIEWS: View[] = ["offline", "online", "ri-director"];

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
          <p className="text-sm text-muted-foreground">WhatsApp &amp; Email credits — given offline or bought online — and club-website pricing</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={view === "offline" ? "default" : "outline"} onClick={() => toggle("offline")}>
            <HandCoins className="h-4 w-4 mr-1.5" /> Offline
          </Button>
          <Button variant={view === "online" ? "default" : "outline"} onClick={() => toggle("online")}>
            <Globe className="h-4 w-4 mr-1.5" /> Online
          </Button>
          <Button variant={view === "ri-director" ? "default" : "outline"} onClick={() => toggle("ri-director")}>
            <Landmark className="h-4 w-4 mr-1.5" /> RI Director Credits
          </Button>
        </div>
      </div>

      {view !== "" && (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {view === "offline" ? "Offline credit — given by Super Admin"
                : view === "online" ? "Online — wallet, top-up links & purchase reports"
                : "RI Director Credits"}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setView("")}>
              <X className="h-4 w-4 mr-1" /> Close
            </Button>
          </div>
          {view === "ri-director" ? (
            <RiDirectorCreditsPanel embedded />
          ) : view === "offline" ? (
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

      {view !== "ri-director" && (
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">All WhatsApp &amp; Email Credits</h2>
          <p className="text-sm text-muted-foreground">
            Every credit entry for clubs and districts — <b>Offline</b> (given by Super Admin) and <b>Online</b> (bought by the club or district).
          </p>
        </div>
        <AllCreditsList refreshKey={refreshKey} />
      </div>
      )}
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
