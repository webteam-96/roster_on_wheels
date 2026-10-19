"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Target, Layers, GitBranch, Download } from "@/components/icons";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getModules, getAreasOfFocus, getCategories, getSubCategories } from "@/services/api";
import { exportToCSV } from "@/utils/csvExport";
import RotaryLoader from "@/components/RotaryLoader";

const cards = [
  {
    title: "Area of Focus",
    description: "Manage areas of focus for service projects",
    icon: Target,
    href: "/settings/area-of-focus",
  },
  {
    title: "Categories",
    description: "Manage project categories by area of focus",
    icon: Layers,
    href: "/settings/categories",
  },
  {
    title: "Sub Categories",
    description: "Manage project sub-categories by category",
    icon: GitBranch,
    href: "/settings/sub-categories",
  },
];

export default function ProjectCategorizationPage() {
  const { isSuperAdmin } = useAuth();
  const [exporting, setExporting] = useState(false);

  const handleExportFullReport = async () => {
    setExporting(true);
    try {
      const modules = await getModules();
      const projectModules = modules.filter((m: any) => m.moduleLevel === "club" || m.moduleLevel === "Club");

      const rows: any[] = [];

      for (const mod of projectModules) {
        const areas = await getAreasOfFocus(mod.id);
        if (areas.length === 0) {
          rows.push({ projectType: mod.moduleName, areaOfFocus: "–", category: "–", subCategory: "–", active: "Yes" });
          continue;
        }
        for (const aof of areas) {
          const cats = await getCategories(aof.id);
          if (cats.length === 0) {
            rows.push({ projectType: mod.moduleName, areaOfFocus: aof.name, category: "–", subCategory: "–", active: aof.isActive ? "Yes" : "No" });
            continue;
          }
          for (const cat of cats) {
            const subs = await getSubCategories(cat.id);
            if (subs.length === 0) {
              rows.push({ projectType: mod.moduleName, areaOfFocus: aof.name, category: cat.name, subCategory: "–", active: cat.isActive ? "Yes" : "No" });
              continue;
            }
            for (const sub of subs) {
              rows.push({ projectType: mod.moduleName, areaOfFocus: aof.name, category: cat.name, subCategory: sub.name, active: sub.isActive ? "Yes" : "No" });
            }
          }
        }
      }

      exportToCSV(rows, "project_categorization_report", [
        { key: "projectType", label: "Project Type" },
        { key: "areaOfFocus", label: "Area of Focus" },
        { key: "category", label: "Category" },
        { key: "subCategory", label: "Sub Category" },
        { key: "active", label: "Active" },
      ]);
    } catch {
      alert("Failed to generate report.");
    } finally {
      setExporting(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access settings.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Project Categorization</h2>
              <p className="text-muted-foreground text-base">Manage areas of focus, categories and sub-categories</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleExportFullReport} disabled={exporting}>
            {exporting ? <RotaryLoader size="sm" /> : <><Download className="mr-2 h-4 w-4" />Export Full Report</>}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <Link key={card.href} href={card.href}>
              <Card className="hover:border-primary/50 hover:shadow-md transition-all cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <card.icon className="h-7 w-7" />
                  </div>
                  <h3 className="text-lg font-semibold text-primary">{card.title}</h3>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </ProtectedRoute>
  );
}
