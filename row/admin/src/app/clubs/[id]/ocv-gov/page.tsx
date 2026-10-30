"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getTrfYears, getClub } from "@/services/api";
import { ReportYear } from "@/types/clubMonthlyReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useFeatureLoadedOn } from "@/components/FeatureGate";
import { ListPageSkeleton } from "@/components/row/AppKit";

interface OcvCard {
  key: string;
  title: string;
  description: string;
  categoryCode: string;
  icon: React.ReactNode;
  disabled?: boolean;
  externalRoute?: string;
}

function StaticDocumentsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M14 14h16M14 20h16M14 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="34" r="10" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M34 29v10M30 33l4-4 4 4" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="30" y="36" width="8" height="2" rx="1" className="fill-primary" />
    </svg>
  );
}

function FinancialDocumentsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M12 14h16M12 20h16M12 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <rect x="28" y="24" width="16" height="20" rx="2" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M32 32h8M32 36h5" className="stroke-primary" strokeWidth="1.5" strokeLinecap="round" />
      <text x="36" y="30" textAnchor="middle" className="fill-primary" fontSize="8" fontWeight="bold">$</text>
    </svg>
  );
}

function TrustDocumentsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M14 14h16M14 20h16M14 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <path d="M34 28c-4 0-8 3-8 7s4 9 8 12c4-3 8-8 8-12s-4-7-8-7z" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M30 35l3 3 5-5" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GrantsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M14 14h16M14 20h16M14 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <circle cx="35" cy="35" r="9" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M35 30v10M30 35h10" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="35" cy="35" r="4" className="stroke-primary" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function AdditionalDocumentsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M14 14h16M14 20h16M14 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <circle cx="35" cy="35" r="9" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M35 30v10M30 35h10" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function DuesIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="12" width="36" height="24" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M4 18h36" className="stroke-primary" strokeWidth="2" />
      <rect x="8" y="28" width="12" height="4" rx="1" className="fill-primary/20 stroke-primary" strokeWidth="1" />
      <circle cx="38" cy="36" r="8" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <text x="38" y="40" textAnchor="middle" className="fill-primary" fontSize="10" fontWeight="bold">&#8377;</text>
    </svg>
  );
}

function LiveDocumentsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <path d="M14 14h16M14 20h16M14 26h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <circle cx="35" cy="35" r="9" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <circle cx="35" cy="35" r="4" className="fill-primary" />
      <path d="M27 35a8 8 0 0 1 4-7M43 35a8 8 0 0 0-4-7" className="stroke-primary" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NewslettersIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="36" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <rect x="10" y="10" width="14" height="10" rx="1" className="fill-primary/10 stroke-primary" strokeWidth="1.5" />
      <path d="M28 12h10M28 16h10M28 20h10M10 24h28M10 28h28M10 32h28M10 36h20" className="stroke-primary" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GenerateReportIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="4" width="28" height="36" rx="3" className="stroke-primary" strokeWidth="2.5" fill="none" />
      <rect x="14" y="28" width="4" height="8" rx="1" className="fill-primary/20 stroke-primary" strokeWidth="1" />
      <rect x="20" y="24" width="4" height="12" rx="1" className="fill-primary/30 stroke-primary" strokeWidth="1" />
      <rect x="26" y="20" width="4" height="16" rx="1" className="fill-primary/40 stroke-primary" strokeWidth="1" />
      <path d="M14 14h16M14 10h10" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      <circle cx="38" cy="38" r="8" className="fill-primary/10 stroke-primary" strokeWidth="2" />
      <path d="M36 38l2 2 4-4" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function OcvGovPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const urlYearId = searchParams.get("yearId");

  const [clubName, setClubName] = useState("");
  const [years, setYears] = useState<ReportYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const cmrOn = useFeatureLoadedOn("club_monthly_report");
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [club, yearsData] = await Promise.all([
          getClub(clubId),
          getTrfYears(clubId, cmrOn),
        ]);
        setClubName(club.clubName);
        setYears(yearsData);
        // Use yearId from URL if present (e.g., returning from newsletters)
        if (urlYearId && yearsData.some((y) => y.id === Number(urlYearId))) {
          setSelectedYearId(Number(urlYearId));
        } else {
          const currentYear = yearsData.find((y) => y.isCurrent);
          if (currentYear) {
            setSelectedYearId(currentYear.id);
          } else if (yearsData.length > 0) {
            setSelectedYearId(yearsData[0].id);
          }
        }
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(
          respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load data.")
        );
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [clubId, cmrOn]);

  const cards: OcvCard[] = [
    {
      key: "static_documents",
      title: "Static Documents",
      description: "Club constitution, bylaws, and official static documents",
      categoryCode: "static_documents",
      icon: <StaticDocumentsIcon />,
    },
    {
      key: "financial_documents",
      title: "Financial Documents",
      description: "Budget reports, audit reports, and financial statements",
      categoryCode: "financial_documents",
      icon: <FinancialDocumentsIcon />,
    },
    {
      key: "trust_documents",
      title: "Trust Documents",
      description: "Trust deeds, registrations, and compliance documents",
      categoryCode: "trust_documents",
      icon: <TrustDocumentsIcon />,
    },
    {
      key: "grants",
      title: "Grants",
      description: "Grant applications, approvals, and related documents",
      categoryCode: "grants",
      icon: <GrantsIcon />,
    },
    {
      key: "additional_documents",
      title: "Additional Documents",
      description: "Other supporting and miscellaneous documents",
      categoryCode: "additional_documents",
      icon: <AdditionalDocumentsIcon />,
    },
    {
      key: "dues",
      title: "Dues",
      description: "Club dues, payments, and receipts",
      categoryCode: "dues",
      icon: <DuesIcon />,
    },
    {
      key: "live_documents",
      title: "Live Documents",
      description: "Real-time collaborative documents",
      categoryCode: "live_documents",
      icon: <LiveDocumentsIcon />,
    },
    {
      key: "newsletters",
      title: "Newsletters",
      description: "Club newsletters and bulletins",
      categoryCode: "newsletters",
      icon: <NewslettersIcon />,
      externalRoute: `/clubs/${clubId}/newsletters?from=ocv-gov&yearId=${selectedYearId}`,
    },
  ];

  const handleCardClick = (card: OcvCard) => {
    if (card.disabled) return;
    if (!selectedYearId) {
      setErrorMessage("Please select a Rotary Year first.");
      return;
    }

    if (card.externalRoute) {
      router.push(card.externalRoute);
      return;
    }

    if (card.key === "live_documents") {
      router.push(`/clubs/${clubId}/ocv-gov/live-documents?yearId=${selectedYearId}`);
      return;
    }

    if (card.key === "generate_report") {
      router.push(`/clubs/${clubId}/ocv-gov/report?yearId=${selectedYearId}`);
      return;
    }

    router.push(`/clubs/${clubId}/ocv-gov/${card.categoryCode}?yearId=${selectedYearId}`);
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/clubs/${clubId}/dashboard`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">
                {clubName ? `${clubName} - OCV/GOV` : "OCV/GOV"}
              </h2>
              <p className="text-muted-foreground text-base">
                Official Club Visit / Governor&apos;s Official Visit
              </p>
            </div>
          </div>

          {/* Year filter */}
          {!loading && years.length > 0 && (
            <div className="w-full sm:w-52">
              <Select
                value={selectedYearId?.toString() || ""}
                onValueChange={(v) => setSelectedYearId(Number(v))}
              >
                <SelectTrigger>
                  <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.id} value={year.id.toString()}>
                      {year.yearLabel}
                      {year.isCurrent ? " (Current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Cards Grid */}
        {!loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {cards.map((card) => (
              <Card
                key={card.key}
                className={`relative cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary/40 ${
                  card.disabled ? "opacity-60 cursor-not-allowed hover:shadow-none hover:border-border" : ""
                }`}
                onClick={() => handleCardClick(card)}
              >
                {card.disabled && (
                  <Badge
                    variant="secondary"
                    className="absolute top-3 right-3 bg-amber-100 text-amber-800 hover:bg-amber-100"
                  >
                    Coming Soon
                  </Badge>
                )}
                <CardContent className="flex flex-col items-center text-center p-6 pt-8">
                  <div className="mb-4">{card.icon}</div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{card.title}</h3>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Generate OCV Report */}
        {!loading && (
          <div className="mt-4 flex flex-col items-center text-center">
            <p className="text-lg font-semibold text-primary mb-3">Click Here to View/Generate the Uploaded Documents</p>
            <Card
              className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary/40 w-full max-w-sm"
              onClick={() => {
                if (!selectedYearId) { setErrorMessage("Please select a Rotary Year first."); return; }
                router.push(`/clubs/${clubId}/ocv-gov/report?yearId=${selectedYearId}`);
              }}
            >
              <CardContent className="flex flex-col items-center text-center p-6 pt-8">
                <div className="mb-4"><GenerateReportIcon /></div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Generate OCV Report</h3>
                <p className="text-sm text-muted-foreground">Generate and download OCV compliance report</p>
              </CardContent>
            </Card>
          </div>
        )}

        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
