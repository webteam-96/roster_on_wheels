"use client";

import { useState, useEffect } from "react";
import { DashboardCategoryGroup } from "@/types/module";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LayoutGrid, LayoutDashboard, PanelLeft, Rows3, Sparkles, Grid3X3 } from "@/components/icons";
import ModuleIcon from "@/components/ModuleIcon";
import RotaryLoader from "@/components/RotaryLoader";

export type DashboardTheme = "card-grid" | "bento" | "sidebar" | "compact" | "gradient" | "metro";

const THEME_STORAGE_KEY = "dashboard-theme";

const themes: { key: DashboardTheme; label: string; icon: React.ReactNode }[] = [
  { key: "bento", label: "Bento", icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: "card-grid", label: "Card Grid", icon: <LayoutGrid className="h-4 w-4" /> },
  { key: "compact", label: "Compact Tiles", icon: <Rows3 className="h-4 w-4" /> },
  { key: "gradient", label: "Gradient Cards", icon: <Sparkles className="h-4 w-4" /> },
  { key: "metro", label: "Metro Tiles", icon: <Grid3X3 className="h-4 w-4" /> },
  { key: "sidebar", label: "Sidebar", icon: <PanelLeft className="h-4 w-4" /> },
];

const METRO_COLORS = [
  "bg-blue-700",
  "bg-blue-800",
  "bg-slate-700",
];

interface DashboardModuleGridProps {
  moduleGroups: DashboardCategoryGroup[];
  navigatingModule: string | null;
  onModuleClick: (moduleKey: string, routeUrl: string | null) => void;
  comingSoonModules?: string[];
  /** moduleKey → ISO date string. When present, the Coming Soon badge shows the formatted date. */
  comingSoonDates?: Record<string, string | null>;
}

const formatComingSoonDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
};

export default function DashboardModuleGrid({
  moduleGroups,
  navigatingModule,
  onModuleClick,
  comingSoonModules = [],
  comingSoonDates = {},
}: DashboardModuleGridProps) {
  const [theme, setTheme] = useState<DashboardTheme>("bento");
  const [activeCategory, setActiveCategory] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as DashboardTheme | null;
    if (saved && themes.some((t) => t.key === saved)) {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (moduleGroups.length > 0 && activeCategory === null) {
      setActiveCategory(moduleGroups[0].categoryId);
    }
  }, [moduleGroups, activeCategory]);

  const handleThemeChange = (t: DashboardTheme) => {
    setTheme(t);
    localStorage.setItem(THEME_STORAGE_KEY, t);
  };

  const renderLoader = (moduleKey: string) =>
    navigatingModule === moduleKey ? (
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 rounded-lg">
        <RotaryLoader size="sm" />
      </div>
    ) : null;

  const isNavigating = (moduleKey: string) =>
    navigatingModule === moduleKey ? "opacity-60 pointer-events-none" :
    comingSoonModules.includes(moduleKey) ? "opacity-50 cursor-not-allowed" : "";

  const isComingSoon = (moduleKey: string) => comingSoonModules.includes(moduleKey);

  const comingSoonBadge = (moduleKey: string) => {
    if (!isComingSoon(moduleKey)) return null;
    const dateText = formatComingSoonDate(comingSoonDates[moduleKey]);
    return (
      <Badge
        variant="secondary"
        className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border-amber-200 max-w-[90%] whitespace-normal text-right leading-tight"
        title={dateText ? `Coming Soon: ${dateText}` : "Coming Soon"}
      >
        Coming Soon{dateText ? <><br />{dateText}</> : null}
      </Badge>
    );
  };

  const handleClick = (moduleKey: string, routeUrl: string | null) => {
    if (isComingSoon(moduleKey)) return;
    onModuleClick(moduleKey, routeUrl);
  };

  // Global module index for metro colors
  let globalModuleIdx = 0;

  return (
    <div className="space-y-4">
      {/* Theme Switcher */}
      <div className="flex items-center justify-end gap-1">
        {themes.map((t) => (
          <Button
            key={t.key}
            variant={theme === t.key ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => handleThemeChange(t.key)}
            title={t.label}
          >
            {t.icon}
          </Button>
        ))}
      </div>

      {/* ===== Theme: Card Grid ===== */}
      {theme === "card-grid" &&
        moduleGroups.map((group) => (
          <div key={group.categoryId} className="space-y-3">
            <h3 className="text-lg font-semibold text-primary border-b border-primary/20 pb-2">
              {group.categoryName}
            </h3>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.modules.map((mod) => (
                <Card
                  key={mod.moduleId}
                  className={`cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-200 border-primary/20 group relative ${isNavigating(mod.moduleKey)}`}
                  onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                >
                  {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                  <CardContent className="flex flex-col items-center justify-center p-4 text-center gap-2">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <ModuleIcon name={mod.iconClass} iconPath={mod.iconPath} className="h-6 w-6 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-foreground leading-tight">{mod.moduleName}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}

      {/* ===== Theme: Bento Grid ===== */}
      {theme === "bento" &&
        moduleGroups.map((group) => (
          <div key={group.categoryId} className="space-y-3">
            <h3 className="text-lg font-semibold text-primary border-b border-primary/20 pb-2">
              {group.categoryName}
            </h3>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 auto-rows-min">
              {group.modules.map((mod, idx) => {
                const isFeature = idx === 0;
                return (
                  <Card
                    key={mod.moduleId}
                    className={`cursor-pointer hover:shadow-lg transition-all duration-200 border-primary/20 group relative ${
                      isFeature ? "col-span-2 row-span-2" : ""
                    } ${isNavigating(mod.moduleKey)}`}
                    onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                  >
                    {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                    <CardContent
                      className={`flex flex-col items-center justify-center text-center gap-2 h-full ${
                        isFeature ? "p-6" : "p-4"
                      }`}
                    >
                      <div
                        className={`rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors ${
                          isFeature ? "h-20 w-20" : "h-12 w-12"
                        }`}
                      >
                        <ModuleIcon
                          name={mod.iconClass}
                          iconPath={mod.iconPath}
                          className={isFeature ? "h-10 w-10 text-primary" : "h-6 w-6 text-primary"}
                        />
                      </div>
                      <span
                        className={`font-medium text-foreground leading-tight ${
                          isFeature ? "text-base" : "text-sm"
                        }`}
                      >
                        {mod.moduleName}
                      </span>
                      {isFeature && mod.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{mod.description}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}

      {/* ===== Theme: Compact Tiles ===== */}
      {theme === "compact" &&
        moduleGroups.map((group) => (
          <div key={group.categoryId} className="space-y-3">
            <h3 className="text-lg font-semibold text-primary border-b border-primary/20 pb-2">
              {group.categoryName}
            </h3>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {group.modules.map((mod) => (
                <div
                  key={mod.moduleId}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/50 cursor-pointer transition-all duration-150 group relative ${isNavigating(mod.moduleKey)}`}
                  onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                >
                  {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                  <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <ModuleIcon name={mod.iconClass} iconPath={mod.iconPath} className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{mod.moduleName}</p>
                    {mod.description && (
                      <p className="text-[11px] text-muted-foreground truncate">{mod.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {/* ===== Theme: Gradient Cards ===== */}
      {theme === "gradient" &&
        moduleGroups.map((group) => (
          <div key={group.categoryId} className="space-y-3">
            <h3 className="text-lg font-semibold text-primary border-b border-primary/20 pb-2">
              {group.categoryName}
            </h3>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.modules.map((mod) => (
                <div
                  key={mod.moduleId}
                  className={`cursor-pointer group relative rounded-xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-primary/20 hover:-translate-y-1 ${isNavigating(mod.moduleKey)}`}
                  onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                >
                  {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                  {/* Gradient background */}
                  <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-all duration-300" />
                  {/* Content */}
                  <div className="relative flex flex-col items-center justify-center p-5 text-center gap-3 border border-primary/10 rounded-xl group-hover:border-primary/30 transition-colors">
                    <div className="h-14 w-14 rounded-2xl bg-white/80 dark:bg-white/10 shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <ModuleIcon name={mod.iconClass} iconPath={mod.iconPath} className="h-7 w-7 text-primary" />
                    </div>
                    <span className="text-sm font-semibold text-foreground leading-tight">{mod.moduleName}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {/* ===== Theme: Metro Tiles ===== */}
      {theme === "metro" && (() => { globalModuleIdx = 0; return null; })()}
      {theme === "metro" &&
        moduleGroups.map((group) => (
          <div key={group.categoryId} className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground pb-1">
              {group.categoryName}
            </h3>
            <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.modules.map((mod) => {
                const colorClass = METRO_COLORS[globalModuleIdx % METRO_COLORS.length];
                globalModuleIdx++;
                return (
                  <div
                    key={mod.moduleId}
                    className={`cursor-pointer group relative rounded-lg overflow-hidden transition-all duration-200 hover:scale-105 hover:shadow-lg ${isNavigating(mod.moduleKey)}`}
                    onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                  >
                    {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                    <div className={`${colorClass} p-5 flex flex-col items-center justify-center text-center gap-3 min-h-[120px]`}>
                      <div className="opacity-90 group-hover:opacity-100 group-hover:scale-110 transition-all duration-200">
                        <ModuleIcon name={mod.iconClass} iconPath={mod.iconPath} className="h-9 w-9 text-white" />
                      </div>
                      <span className="text-sm font-semibold text-white leading-tight drop-shadow-sm">
                        {mod.moduleName}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {/* ===== Theme: Sidebar Categories ===== */}
      {theme === "sidebar" && (
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Sidebar */}
          <div className="sm:w-52 shrink-0">
            <div className="sm:sticky sm:top-4 flex sm:flex-col gap-1.5 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 sm:border-r sm:border-border sm:pr-4">
              <p className="hidden sm:block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                Categories
              </p>
              {moduleGroups.map((group) => {
                const isActive = activeCategory === group.categoryId;
                return (
                  <button
                    key={group.categoryId}
                    onClick={() => setActiveCategory(group.categoryId)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap text-left transition-all duration-150 ${
                      isActive
                        ? "bg-primary/10 text-primary border-l-[3px] border-primary sm:rounded-l-none"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground border-l-[3px] border-transparent sm:rounded-l-none"
                    }`}
                  >
                    <span className="truncate">{group.categoryName}</span>
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className="ml-2 text-[10px] px-1.5 min-w-[20px] justify-center"
                    >
                      {group.modules.length}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Module grid */}
          <div className="flex-1 min-w-0">
            {moduleGroups
              .filter((g) => g.categoryId === activeCategory)
              .map((group) => (
                <div key={group.categoryId} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-primary">{group.categoryName}</h3>
                    <span className="text-sm text-muted-foreground">{group.modules.length} modules</span>
                  </div>
                  <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {group.modules.map((mod) => (
                      <Card
                        key={mod.moduleId}
                        className={`cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-200 border-primary/15 group relative ${isNavigating(mod.moduleKey)}`}
                        onClick={() => handleClick(mod.moduleKey, mod.routeUrl)}
                      >
                        {renderLoader(mod.moduleKey)}
                  {comingSoonBadge(mod.moduleKey)}
                        <CardContent className="flex flex-col items-center justify-center p-5 text-center gap-3">
                          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-105 transition-all duration-200">
                            <ModuleIcon name={mod.iconClass} iconPath={mod.iconPath} className="h-7 w-7 text-primary" />
                          </div>
                          <span className="text-sm font-semibold text-foreground leading-tight">{mod.moduleName}</span>
                          {mod.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-2">{mod.description}</p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
