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

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/row/AppKit";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Globe, HandCoins, X } from "@/components/icons";
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
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        description="Email credits, given offline or bought online, and club website pricing"
        back="/settings"
        actions={
          <>
<Button variant={view === "offline" ? "default" : "outline"} onClick={() => toggle("offline")}>
            <HandCoins className="h-4 w-4 mr-1.5" /> Offline
          </Button>
          <Button variant={view === "online" ? "default" : "outline"} onClick={() => toggle("online")}>
            <Globe className="h-4 w-4 mr-1.5" /> Online
          </Button>
          </>
        }
      />

      {view !== "" && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="row-h2">
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
        </Card>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="row-h2">All Email Credits</h2>
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
