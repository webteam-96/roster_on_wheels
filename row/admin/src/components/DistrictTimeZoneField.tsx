"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeZoneOptions } from "@/lib/constants";
import { appTimeZone } from "@/lib/appFormat";

const ZONES = timeZoneOptions();
// Radix Select has no empty value: this stands for "no zone of its own" (district_master.Timezone NULL).
const INSTANCE = "instance-default";

/** A district's IANA time zone (N12); "" = the instance default. */
export default function DistrictTimeZoneField({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const options = value && !ZONES.includes(value) ? [value, ...ZONES] : ZONES;
  return (
    <div className="space-y-2">
      <Label htmlFor="timezone">Time Zone</Label>
      <Select value={value || INSTANCE} onValueChange={(v) => onChange(v === INSTANCE ? "" : v)}>
        <SelectTrigger id="timezone">
          <SelectValue placeholder="Select a time zone" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={INSTANCE}>Instance default ({appTimeZone()})</SelectItem>
          {options.map((z) => (
            <SelectItem key={z} value={z}>{z}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Greetings, reminders and reports for this district run on its local time</p>
    </div>
  );
}
