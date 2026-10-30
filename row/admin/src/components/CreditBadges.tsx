"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "@/components/icons";
import { getClubCreditBalance, getDistrictCreditBalance } from "@/services/api";

interface Balance {
  emailRemaining: number;
}

function Badge({ icon: Icon, title, value, color }: { icon: React.ElementType; title: string; value: number; color: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-sm text-white ${color}`} title={title}>
      <Icon className="h-4 w-4" />
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] opacity-90">{title}</span>
        <span className="text-sm font-bold">{value}</span>
      </div>
    </div>
  );
}

export default function CreditBadges({ scope, entityId }: { scope: "club" | "district"; entityId: number }) {
  const [bal, setBal] = useState<Balance | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = scope === "district"
          ? await getDistrictCreditBalance(entityId)
          : await getClubCreditBalance(entityId);
        setBal(data);
      } catch { setBal(null); }
    })();
  }, [scope, entityId]);

  if (!bal) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge icon={MessageSquare} title="Email Credits" value={bal.emailRemaining ?? 0} color="bg-sky-500" />
    </div>
  );
}
