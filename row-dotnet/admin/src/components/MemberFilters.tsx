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
import { Search, LayoutGrid, List, X } from "lucide-react";

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
  const hasFilters = search || bloodGroup || gender;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
        <Input
          placeholder="Search members..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 border-primary/30 focus:border-primary text-base"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={bloodGroup} onValueChange={onBloodGroupChange}>
          <SelectTrigger className="w-[140px]">
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

        <Select value={gender} onValueChange={onGenderChange}>
          <SelectTrigger className="w-[120px]">
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
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-l-none"
            onClick={() => onViewModeChange("table")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
