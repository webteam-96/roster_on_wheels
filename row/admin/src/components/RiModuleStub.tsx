"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Hammer } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";

export default function RiModuleStub({ title, phase }: { title: string; phase: string }) {
  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/ri-director"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">{title}</h2>
            <p className="text-muted-foreground text-base">RI Director</p>
          </div>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-10 flex flex-col items-center text-center gap-3">
            <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
              <Hammer className="h-8 w-8 text-amber-600" />
            </div>
            <h3 className="text-xl font-bold text-primary">Coming Soon</h3>
            <p className="text-muted-foreground max-w-md">
              This module is planned for <span className="font-semibold text-foreground">{phase}</span>.
              The UI and backend are under development.
            </p>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  );
}
