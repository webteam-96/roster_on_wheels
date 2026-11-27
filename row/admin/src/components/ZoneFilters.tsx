"use client";

import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, LayoutGrid, List, X } from "@/components/icons";

interface ZoneFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  viewMode: "grid" | "table";
  onViewModeChange: (mode: "grid" | "table") => void;
  onSearch?: () => void;
}

export default function ZoneFilters({
  search, onSearchChange, status, onStatusChange, viewMode, onViewModeChange, onSearch,
}: ZoneFiltersProps) {
  const hasFilters = search || status;

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
        <Input
          placeholder="Search by zone name..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSearch} size="sm">
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[130px]" aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Active</SelectItem>
            <SelectItem value="0">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { onSearchChange(""); onStatusChange(""); }}>
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}

        <div className="flex items-center rounded-md border ml-auto">
          <Button variant={viewMode === "grid" ? "default" : "ghost"} aria-pressed={viewMode === "grid"} aria-label="Grid view" size="icon" className="rounded-r-none" onClick={() => onViewModeChange("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "table" ? "default" : "ghost"} aria-pressed={viewMode === "table"} aria-label="Table view" size="icon" className="rounded-l-none" onClick={() => onViewModeChange("table")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
