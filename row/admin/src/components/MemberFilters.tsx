"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BLOOD_GROUPS, GENDERS } from "@/lib/constants";
import { useFeature } from "@/contexts/BrandContext";
import { Search, LayoutGrid, List, X } from "@/components/icons";

interface MemberFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  bloodGroup: string;
  onBloodGroupChange: (value: string) => void;
  gender: string;
  onGenderChange: (value: string) => void;
  viewMode: "grid" | "table";
  onViewModeChange: (mode: "grid" | "table") => void;
}

export default function MemberFilters({
  search,
  onSearchChange,
  bloodGroup,
  onBloodGroupChange,
  gender,
  onGenderChange,
  viewMode,
  onViewModeChange,
}: MemberFiltersProps) {
  const showBloodGroup = useFeature("member.bloodGroup");
  const hasFilters = search || bloodGroup || gender;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
        <Input
          placeholder="Search members..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showBloodGroup && (
          <Select value={bloodGroup} onValueChange={onBloodGroupChange}>
            <SelectTrigger className="w-[140px]" aria-label="Blood Group">
              <SelectValue placeholder="Blood Group" />
            </SelectTrigger>
            <SelectContent>
              {BLOOD_GROUPS.map((bg) => (
                <SelectItem key={bg} value={bg}>
                  {bg}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={gender} onValueChange={onGenderChange}>
          <SelectTrigger className="w-[120px]" aria-label="Gender">
            <SelectValue placeholder="Gender" />
          </SelectTrigger>
          <SelectContent>
            {GENDERS.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearchChange("");
              onBloodGroupChange("");
              onGenderChange("");
            }}
          >
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}

        <div className="flex items-center rounded-md border ml-auto">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"} aria-pressed={viewMode === "grid"} aria-label="Grid view"
            size="icon"
            className="rounded-r-none"
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "ghost"} aria-pressed={viewMode === "table"} aria-label="Table view"
            size="icon"
            className="rounded-l-none"
            onClick={() => onViewModeChange("table")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
