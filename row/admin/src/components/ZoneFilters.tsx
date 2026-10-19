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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center bg-primary/5 p-4 rounded-lg border border-primary/20">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
        <Input
          placeholder="Search by zone name..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-9 border-primary/30 focus:border-primary text-base"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSearch} size="sm">
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[130px]">
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
          <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => onViewModeChange("grid")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => onViewModeChange("table")}>
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
