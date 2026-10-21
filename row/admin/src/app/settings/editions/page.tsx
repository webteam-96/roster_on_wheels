"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getEditions, getModules, updateEdition, type Edition } from "@/services/api";
import type { Module } from "@/types/module";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, Loader2, Save } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";

// Super Admin > Editions (ROW Wave 1, build spec item 5): an edition is the set of modules a tenant gets.
export default function EditionsPage() {
  const { isSuperAdmin } = useAuth();
  const [editions, setEditions] = useState<Edition[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    Promise.all([getEditions(), getModules()])
      .then(([e, m]) => {
        setEditions(e);
        setModules(m);
        if (e[0]) pick(e[0]);
      })
      .catch(() => setErrorMessage("Could not load editions."))
      .finally(() => setLoading(false));
  }, [isSuperAdmin]);

  function pick(e: Edition) {
    setCode(e.code);
    setName(e.name);
    setKeys(new Set(e.moduleKeys));
  }

  const grouped = useMemo(() => {
    const g = new Map<string, Module[]>();
    for (const m of modules) g.set(m.categoryName, [...(g.get(m.categoryName) ?? []), m]);
    return [...g.entries()];
  }, [modules]);

  function toggle(key: string) {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await updateEdition(code, name, [...keys]);
      setEditions((list) => list.map((e) => (e.code === code ? { ...e, name: saved.name, moduleKeys: saved.moduleKeys } : e)));
      setSuccessMessage("Edition saved. Apply it from Tenants to switch a district's modules.");
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Could not save the edition.");
    } finally {
      setSaving(false);
    }
  }

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
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings" aria-label="Back to settings"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Editions</h2>
            <p className="text-muted-foreground text-base">Choose which modules each edition switches on</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-10 w-full max-w-xl animate-pulse rounded-md bg-muted" />
            <div className="h-64 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Editions">
              {editions.map((e) => (
                <Button key={e.code} role="tab" aria-selected={e.code === code}
                  variant={e.code === code ? "default" : "outline"} onClick={() => pick(e)}>
                  {e.name} <span className="ml-2 text-xs opacity-75">{e.moduleKeys.length}</span>
                </Button>
              ))}
            </div>

            <Card>
              <CardContent className="space-y-6 p-6">
                <div className="max-w-sm space-y-2">
                  <Label htmlFor="edition-name">Name</Label>
                  <Input id="edition-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Code: {code}</p>
                </div>

                {grouped.map(([category, list]) => (
                  <fieldset key={category} className="space-y-2">
                    <legend className="text-sm font-semibold">{category}</legend>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((m) => (
                        <label key={m.moduleKey} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={keys.has(m.moduleKey)} onCheckedChange={() => toggle(m.moduleKey)} />
                          <span>{m.moduleName}</span>
                          <span className="text-xs text-muted-foreground">{m.moduleLevel}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}

                <Button onClick={save} disabled={saving || !code}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save edition
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        <SuccessAlert open={!!successMessage} title="Saved" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
