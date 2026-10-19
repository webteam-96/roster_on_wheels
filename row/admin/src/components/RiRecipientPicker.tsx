"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getZones, getDistricts,
  getRiDirectorRecipientCount, getRiDirectorCreditBalance,
  getRiDirectorSubGroups, getRiDirectorSubGroupYears,
} from "@/services/api";
import { Users, Globe, MapPin, Users2, MessageSquare, AlertTriangle, CheckCircle2 } from "@/components/icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type RecipientTarget = "all" | "zones" | "districts" | "subgroups";

export interface RiRecipientValue {
  target: RecipientTarget;
  zoneIds: number[];
  districtIds: number[];
  subgroupIds: number[];
  subgroupYearId?: number | null;
}

interface Props {
  value: RiRecipientValue;
  onChange: (v: RiRecipientValue) => void;
  channel?: "email";
  checkCredits?: boolean;
}

export default function RiRecipientPicker({ value, onChange, channel = "email", checkCredits = false }: Props) {
  const [zones, setZones] = useState<{ id: number; name: string }[]>([]);
  const [districts, setDistricts] = useState<{ id: number; number: string }[]>([]);
  const [years, setYears] = useState<{ id: number; label: string; isCurrent: boolean }[]>([]);
  const [subgroups, setSubgroups] = useState<{ id: number; groupName: string; memberCount: number }[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try { const z = await getZones(1, 1000, undefined, 1); setZones(z.items.map(x => ({ id: x.id, name: x.zoneName }))); } catch {}
      try { const d = await getDistricts(1, 1000, undefined, 1); setDistricts(d.items.map(x => ({ id: x.id, number: x.districtNumber })).sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))); } catch {}
      try {
        const y = await getRiDirectorSubGroupYears();
        setYears(y.map(x => ({ id: x.id, label: x.yearLabel, isCurrent: x.isCurrent })));
      } catch {}
    })();
  }, []);

  // Load subgroups for selected year
  useEffect(() => {
    if (value.target !== "subgroups" || !value.subgroupYearId) { setSubgroups([]); return; }
    (async () => {
      try { setSubgroups(await getRiDirectorSubGroups(value.subgroupYearId!)); }
      catch { setSubgroups([]); }
    })();
  }, [value.target, value.subgroupYearId]);

  const refreshCount = useCallback(async () => {
    try {
      const c = await getRiDirectorRecipientCount(channel, value.target, value.zoneIds, value.districtIds, value.subgroupIds);
      setCount(c);
    } catch { setCount(null); }
  }, [channel, value]);

  const refreshBalance = useCallback(async () => {
    try {
      const b = await getRiDirectorCreditBalance();
      setBalance(b.emailBalance);
    } catch { setBalance(null); }
  }, [channel]);

  useEffect(() => { refreshCount(); }, [refreshCount]);
  useEffect(() => { if (checkCredits) refreshBalance(); }, [checkCredits, refreshBalance]);

  const toggleZone = (id: number) => {
    const ids = value.zoneIds.includes(id) ? value.zoneIds.filter(x => x !== id) : [...value.zoneIds, id];
    onChange({ ...value, zoneIds: ids });
  };
  const toggleDistrict = (id: number) => {
    const ids = value.districtIds.includes(id) ? value.districtIds.filter(x => x !== id) : [...value.districtIds, id];
    onChange({ ...value, districtIds: ids });
  };
  const toggleSubgroup = (id: number) => {
    const ids = value.subgroupIds.includes(id) ? value.subgroupIds.filter(x => x !== id) : [...value.subgroupIds, id];
    onChange({ ...value, subgroupIds: ids });
  };

  const insufficient = checkCredits && count !== null && balance !== null && count > balance;
  const ChannelIcon = MessageSquare;
  const channelLabel = "Email";

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={value.target === "all"} onChange={() => onChange({ target: "all", zoneIds: [], districtIds: [], subgroupIds: [] })} className="h-4 w-4" />
          <Users className="h-4 w-4 text-blue-600" /><span className="text-sm font-medium">All Members</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={value.target === "zones"} onChange={() => onChange({ ...value, target: "zones", districtIds: [], subgroupIds: [] })} className="h-4 w-4" />
          <Globe className="h-4 w-4 text-emerald-600" /><span className="text-sm font-medium">By Zones</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={value.target === "districts"} onChange={() => onChange({ ...value, target: "districts", zoneIds: [], subgroupIds: [] })} className="h-4 w-4" />
          <MapPin className="h-4 w-4 text-rose-600" /><span className="text-sm font-medium">By Districts</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" checked={value.target === "subgroups"} onChange={() => {
            const currentYear = years.find(y => y.isCurrent)?.id ?? years[0]?.id ?? null;
            onChange({ ...value, target: "subgroups", zoneIds: [], districtIds: [], subgroupYearId: value.subgroupYearId || currentYear });
          }} className="h-4 w-4" />
          <Users2 className="h-4 w-4 text-amber-600" /><span className="text-sm font-medium">By Sub Groups</span>
        </label>
      </div>

      {value.target === "zones" && (
        <div className="border rounded-md p-3 max-h-48 overflow-auto bg-muted/30">
          {zones.length === 0 && <p className="text-xs text-muted-foreground">No zones available.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {zones.map(z => (
              <label key={z.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={value.zoneIds.includes(z.id)} onChange={() => toggleZone(z.id)} className="h-4 w-4" />
                <span>{z.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {value.target === "districts" && (
        <div className="border rounded-md p-3 max-h-48 overflow-auto bg-muted/30">
          {districts.length === 0 && <p className="text-xs text-muted-foreground">No districts available.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {districts.map(d => (
              <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={value.districtIds.includes(d.id)} onChange={() => toggleDistrict(d.id)} className="h-4 w-4" />
                <span>{d.number}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {value.target === "subgroups" && (
        <div className="space-y-2">
          {years.length === 0 ? (
            <div className="border rounded-md p-3 bg-amber-50 text-amber-800 text-sm">
              No sub groups created yet. Please create sub groups first before selecting this option.
            </div>
          ) : (
          <>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Year:</span>
            <Select
              value={value.subgroupYearId ? String(value.subgroupYearId) : ""}
              onValueChange={(v) => onChange({ ...value, subgroupYearId: Number(v), subgroupIds: [] })}
            >
              <SelectTrigger className="w-48"><SelectValue placeholder="Select year" /></SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y.id} value={String(y.id)}>{y.label}{y.isCurrent ? " (Current)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="border rounded-md p-3 max-h-48 overflow-auto bg-muted/30">
            {subgroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sub groups for this year.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {subgroups.map(sg => (
                  <label key={sg.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={value.subgroupIds.includes(sg.id)} onChange={() => toggleSubgroup(sg.id)} className="h-4 w-4" />
                    <span>{sg.groupName} <span className="text-muted-foreground">({sg.memberCount})</span></span>
                  </label>
                ))}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-medium">Recipients:</span>
          <span className="text-primary font-bold">{count === null ? "-" : count}</span>
        </div>
        {checkCredits && (
          <>
            <div className="inline-flex items-center gap-2">
              <ChannelIcon className="h-4 w-4 text-primary" />
              <span className="font-medium">{channelLabel} Balance:</span>
              <span className={`font-bold ${insufficient ? "text-destructive" : "text-primary"}`}>{balance === null ? "-" : balance}</span>
            </div>
            {insufficient ? (
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs font-medium">
                <AlertTriangle className="h-3 w-3" />
                Insufficient: need {count! - balance!} more
              </div>
            ) : count !== null && count > 0 && balance !== null ? (
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium">
                <CheckCircle2 className="h-3 w-3" />
                Sufficient ({balance - count!} will remain)
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
