"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { getRiDirectorContext } from "@/services/api";
import { RiDirectorContext } from "@/types/riDirector";
import { Card, CardContent } from "@/components/ui/card";
import {
  Megaphone, CalendarClock, Mail, Link2, Users2, FileText,
  Newspaper, BarChart3, MessageSquare,
  Globe, Building2, Crown, MapPin,
} from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";

function Stat({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number | string; accent: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-primary">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CreditBadge({ title, balance, icon: Icon, color }: {
  title: string; balance: number; icon: React.ElementType; color: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-sm text-white ${color}`} title={title}>
      <Icon className="h-4 w-4" />
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] opacity-90">{title}</span>
        <span className="text-sm font-bold">{balance}</span>
      </div>
    </div>
  );
}

const MODULES = [
  { key: "announcements", label: "Announcements", icon: Megaphone, color: "bg-blue-500", href: "/ri-director/announcements" },
  { key: "upcoming-events", label: "Upcoming Events", icon: CalendarClock, color: "bg-violet-500", href: "/ri-director/upcoming-events" },
  { key: "mass-emails", label: "Mass Emails", icon: Mail, color: "bg-rose-500", href: "/ri-director/mass-emails" },
  { key: "weblinks", label: "Web Links", icon: Link2, color: "bg-emerald-500", href: "/ri-director/weblinks" },
  { key: "sub-groups", label: "Sub Groups", icon: Users2, color: "bg-amber-500", href: "/ri-director/sub-groups" },
  { key: "documents", label: "Documents", icon: FileText, color: "bg-cyan-500", href: "/ri-director/documents" },
  { key: "newsletters", label: "Newsletters", icon: Newspaper, color: "bg-fuchsia-500", href: "/ri-director/newsletters" },
  { key: "reports", label: "Reports", icon: BarChart3, color: "bg-slate-700", href: "/ri-director/reports" },
];

export default function RiDirectorDashboardPage() {
  const router = useRouter();
  const { isSuperAdmin, isRIDirector } = useAuth();
  const [ctx, setCtx] = useState<RiDirectorContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getRiDirectorContext();
      setCtx(data);
    } catch {
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canAccess = isSuperAdmin || isRIDirector;

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
      </ProtectedRoute>
    );
  }

  if (!canAccess) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <p className="text-destructive">You do not have access to RI Director dashboard.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const handleTileClick = (href: string) => {
    setNavigatingTo(href);
    router.push(href);
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header with credits on right */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Crown className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">RI Director Dashboard</h2>
              <p className="text-muted-foreground text-base">Communicate with all zones, districts &amp; clubs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push("/ri-director/credits")} className="flex items-center gap-2" title="Manage Credits">
              <CreditBadge title="Email Credits" balance={ctx?.credits.emailBalance ?? 0} icon={MessageSquare} color="bg-sky-500" />
            </button>
          </div>
        </div>

        {/* Org stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={Globe} label="Zones" value={ctx?.zoneCount ?? 0} accent="bg-blue-500" />
          <Stat icon={MapPin} label="Districts" value={ctx?.districtCount ?? 0} accent="bg-emerald-500" />
          <Stat icon={Building2} label="Clubs" value={ctx?.clubCount ?? 0} accent="bg-amber-500" />
          <Stat icon={Users2} label="Members" value={ctx?.memberCount ?? 0} accent="bg-rose-500" />
        </div>

        {/* Module tiles */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Modules</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {MODULES.map(m => (
              <button
                key={m.key}
                disabled={!!navigatingTo}
                onClick={() => handleTileClick(m.href)}
                className="text-left"
              >
                <Card className="hover:shadow-md transition cursor-pointer h-full">
                  <CardContent className="p-5 flex flex-col items-center text-center gap-3 relative">
                    {navigatingTo === m.href && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-md">
                        <RotaryLoader size="sm" />
                      </div>
                    )}
                    <div className={`h-12 w-12 rounded-full flex items-center justify-center ${m.color}`}>
                      <m.icon className="h-6 w-6 text-white" />
                    </div>
                    <p className="font-medium text-sm">{m.label}</p>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
