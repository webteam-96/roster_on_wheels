"use client";

import { PageHeader } from "@/components/row/AppKit";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { FolderOpen, LayoutGrid, Building2 } from "@/components/icons";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

const moduleCards = [
  {
    title: "Module Categories",
    description: "Manage module categories",
    icon: FolderOpen,
    href: "/admin/module-categories",
  },
  {
    title: "Modules",
    description: "Manage system modules",
    icon: LayoutGrid,
    href: "/admin/modules",
  },
  {
    title: "District Modules",
    description: "Assign modules to districts",
    icon: Building2,
    href: "/admin/district-modules",
  },
  {
    title: "Club Modules",
    description: "Assign modules to clubs",
    icon: Building2,
    href: "/admin/club-modules",
  },
];

export default function ModuleMasterPage() {
  const { isSuperAdmin } = useAuth();

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center justify-center py-20">
          <h3 className="row-h2">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <PageHeader title="Module Master" description={<>Manage modules, categories & assignments</>} back="/settings" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {moduleCards.map((card) => (
            <Link key={card.href} href={card.href}>
              <Card className="hover:border-primary/50 transition-all cursor-pointer h-full">
                <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <card.icon className="h-7 w-7" />
                  </div>
                  <h3 className="row-h2">{card.title}</h3>
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
