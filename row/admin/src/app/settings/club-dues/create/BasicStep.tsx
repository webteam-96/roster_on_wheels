import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check } from "@/components/icons";
import { currencyOptions } from "@/lib/currency";
import { ReactQuill } from "./clubDuesShared";
import type { ClubDuesFormCtx } from "./useClubDuesForm";

export default function BasicStep({ v }: { v: ClubDuesFormCtx }) {
  const { districtOpen, setDistrictOpen, editId, districtId, districts, setDistrictId, rotaryYear, setRotaryYear, years, purpose, setPurpose, purposeDescription, setPurposeDescription, quillModules, isSuperAdmin, notifyEmail, setNotifyEmail, currency, setCurrency } = v;

  // ── Step 1: Basic Info ──────────────────────────────────────
  const renderBasic = () => (
    <Card>
      <CardHeader><CardTitle>Basic Information</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 max-w-sm">
          <Label>District<span className="text-destructive ml-1">*</span></Label>
          <Popover open={districtOpen} onOpenChange={setDistrictOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" role="combobox" disabled={!!editId} className="w-full justify-between">
                {districtId ? districts.find((d) => String(d.id) === districtId)?.districtNumber : "Select district"}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search district number…" />
                <CommandList>
                  <CommandEmpty>No district found.</CommandEmpty>
                  <CommandGroup>
                    {districts.map((d) => (
                      <CommandItem key={d.id} value={d.districtNumber} onSelect={() => { setDistrictId(String(d.id)); setDistrictOpen(false); }}>
                        <Check className={`mr-2 h-4 w-4 ${districtId === String(d.id) ? "opacity-100" : "opacity-0"}`} />
                        {d.districtNumber}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2 max-w-sm">
          <Label>Rotary Year<span className="text-destructive ml-1">*</span></Label>
          <Select value={rotaryYear} onValueChange={setRotaryYear} disabled={!!editId}>
            <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y.id} value={y.yearLabel}>{y.yearLabel}{y.isCurrent ? " (current)" : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Purpose</Label>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Title / purpose of the dues" />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <ReactQuill theme="snow" value={purposeDescription} onChange={setPurposeDescription} modules={quillModules}
            placeholder="Description (optional): bold / italic / sizes / colors / lists / links" />
        </div>
        {isSuperAdmin && (
          <div className="grid gap-6 sm:grid-cols-2 max-w-xl">
            <div className="space-y-2">
              <Label>Email to clubs</Label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />Send reminders, receipts and notices by email
              </label>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencyOptions().map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return renderBasic();
}
