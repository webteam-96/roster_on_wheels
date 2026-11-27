"use client";

import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MEETING_DAYS } from "@/lib/constants";
import { DistrictListItem } from "@/types/district";
import { Search, LayoutGrid, List, X } from "@/components/icons";

interface ClubFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  districtId: string;
  onDistrictChange: (value: string) => void;
  city: string;
  onCityChange: (value: string) => void;
  meetingDay: string;
  onMeetingDayChange: (value: string) => void;
  viewMode: "grid" | "table";
  onViewModeChange: (mode: "grid" | "table") => void;
  districts: DistrictListItem[];
  onSearch?: () => void;
}

export default function ClubFilters({
  search, onSearchChange, districtId, onDistrictChange, city, onCityChange,
  meetingDay, onMeetingDayChange, viewMode, onViewModeChange, districts, onSearch,
}: ClubFiltersProps) {
  const hasFilters = search || districtId || city || meetingDay;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch?.();
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
        <Input placeholder="Search by club name, Rotary ID, or district number..." value={search} onChange={(e) => onSearchChange(e.target.value)} onKeyDown={handleKeyDown} className="pl-9" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSearch} size="sm">
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>

        <Select value={districtId} onValueChange={onDistrictChange}>
          <SelectTrigger className="w-[140px]" aria-label="District">
            <SelectValue placeholder="District" />
          </SelectTrigger>
          <SelectContent>
            {districts.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>{d.districtNumber}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input placeholder="City" value={city} onChange={(e) => onCityChange(e.target.value)} onKeyDown={handleKeyDown} className="w-[120px]" />

        <Select value={meetingDay} onValueChange={onMeetingDayChange}>
          <SelectTrigger className="w-[140px]" aria-label="Meeting Day">
            <SelectValue placeholder="Meeting Day" />
          </SelectTrigger>
          <SelectContent>
            {MEETING_DAYS.map((day) => (
              <SelectItem key={day} value={day}>{day}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { onSearchChange(""); onDistrictChange(""); onCityChange(""); onMeetingDayChange(""); }}>
            <X className="mr-1 h-4 w-4" />Clear
          </Button>
        )}

        <div className="flex items-center rounded-md border ml-auto">
          <Button variant={viewMode === "grid" ? "default" : "ghost"} aria-pressed={viewMode === "grid"} size="icon" aria-label="Grid view" className="rounded-r-none" onClick={() => onViewModeChange("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "table" ? "default" : "ghost"} aria-pressed={viewMode === "table"} size="icon" aria-label="Table view" className="rounded-l-none" onClick={() => onViewModeChange("table")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
