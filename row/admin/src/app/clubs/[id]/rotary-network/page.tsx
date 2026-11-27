"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getClub } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { UserX, UserPlus } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";

const subModules = [
  {
    key: "terminated-members",
    name: "Terminated Members",
    description: "View members terminated from this club",
    icon: UserX,
  },
  {
    key: "potential-members",
    name: "Potential Members",
    description: "View potential members for this club",
    icon: UserPlus,
  },
];

export default function RotaryNetworkPage() {
  const params = useParams();
  const clubId = Number(params.id);
  const router = useRouter();
  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);

  useEffect(() => {
    async function fetchClub() {
      try {
        const club = await getClub(clubId);
        setClubName(club.clubName);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchClub();
  }, [clubId]);

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title={clubName ? `${clubName} - Rotary Network` : "Rotary Network"} description="Manage terminated and potential members" back={() => router.push(`/clubs/${clubId}/dashboard`)} />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {subModules.map((mod) => (
              <Card
                key={mod.key}
                className={`cursor-pointer hover:shadow-md hover:border-primary/30 transition-all ${navigatingKey === mod.key ? "opacity-70 pointer-events-none" : ""}`}
                onClick={() => {
                  setNavigatingKey(mod.key);
                  router.push(`/clubs/${clubId}/rotary-network/${mod.key}`);
                }}
              >
                <CardContent className="flex flex-col items-center justify-center p-6 text-center gap-3">
                  {navigatingKey === mod.key ? (
                    <RotaryLoader size="sm" />
                  ) : (
                    <mod.icon className="h-10 w-10 text-primary" />
                  )}
                  <div>
                    <p className="font-semibold text-sm">{mod.name}</p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
