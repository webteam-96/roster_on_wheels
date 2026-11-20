"use client";

// WordPress connector (gap agent): read-only website API keys for a club or district, and the documents a
// connected WordPress site may list. The plugin lives in row/integrations/wordpress/row-connector.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Panel, ErrorState, SkeletonRows } from "@/components/row/AppKit";
import { useFormat } from "@/hooks/useFormat";
import {
  ROW_API_BASE_URL,
  createWebsiteApiKey,
  getWebsiteApiDocuments,
  getWebsiteApiKeys,
  revokeWebsiteApiKey,
  setWebsiteApiDocumentPublic,
  type WebsiteApiDocument,
  type WebsiteApiKey,
  type WebsiteApiScope,
} from "@/services/api";

interface Props {
  scope: WebsiteApiScope;
  scopeId: number;
}

export function errorText(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof msg === "string" && msg) return msg;
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

export default function WordPressConnectorPanel({ scope, scopeId }: Props) {
  const fmt = useFormat();
  const [keys, setKeys] = useState<WebsiteApiKey[] | null>(null);
  const [docs, setDocs] = useState<WebsiteApiDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setKeys(null);
    setDocs(null);
    try {
      const [k, d] = await Promise.all([getWebsiteApiKeys(scope, scopeId), getWebsiteApiDocuments(scope, scopeId)]);
      setKeys(k);
      setDocs(d);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [scope, scopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const name = label.trim();
    if (!name) {
      setActionError("Give the key a name, for example the website address.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const made = await createWebsiteApiKey(scope, scopeId, name);
      setNewKey(made.key);
      setCopied(false);
      setLabel("");
      setKeys((prev) => [made.item, ...(prev ?? [])]);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: WebsiteApiKey) {
    if (!window.confirm(`Revoke "${k.label}"? Websites using it stop showing ROW content.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      await revokeWebsiteApiKey(scope, scopeId, k.id);
      setKeys((prev) => (prev ?? []).map((x) => (x.id === k.id ? { ...x, revokedUtc: new Date().toISOString() } : x)));
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDoc(d: WebsiteApiDocument, isPublic: boolean) {
    setActionError(null);
    setDocs((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, isPublicOnWebsite: isPublic } : x)));
    try {
      await setWebsiteApiDocumentPublic(scope, scopeId, d.id, isPublic);
    } catch (e) {
      setDocs((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, isPublicOnWebsite: !isPublic } : x)));
      setActionError(errorText(e));
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setActionError("Copy failed. Select the key and copy it by hand.");
    }
  }

  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} retryLabel="Try again" />;

  return (
    <div className="space-y-6">
      {actionError && (
        <p role="alert" className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-800">
          {actionError}
        </p>
      )}

      <Panel
        title="Website API keys"
        subtitle="A key lets one WordPress site read this page's public content: events, officers, news, projects, directory and public documents. Keys are read-only and can be revoked at any time."
      >
        <div className="space-y-5">
          <div className="grid gap-1 text-[14px] text-muted-foreground">
            <span>
              ROW API address for the plugin settings: <code className="break-all">{ROW_API_BASE_URL}</code>
            </span>
            <span>The member directory shows names, photos and classifications only. Email and phone are never sent.</span>
          </div>

          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="wp-key-label">Key name</Label>
              <Input
                id="wp-key-label"
                value={label}
                maxLength={100}
                placeholder="Club WordPress site"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy}>
              <Plus className="mr-2 h-4 w-4" />
              Create key
            </Button>
          </form>

          {newKey && (
            <div className="space-y-2 rounded-[12px] border border-[color:var(--row-line)] bg-muted p-4">
              <p className="text-[14px] font-semibold text-foreground">
                Copy this key now. It will not be shown again.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 break-all rounded-[8px] bg-background px-3 py-2 text-[13px]">{newKey}</code>
                <Button type="button" variant="outline" onClick={() => void copyKey()}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          {keys === null ? (
            <SkeletonRows rows={3} />
          ) : keys.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">No keys yet. Create one for each website that shows this content.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--row-line)]">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{k.label}</p>
                    <p className="text-[13px] text-muted-foreground">
                      <code>{k.keyPrefix}...</code> | Created {fmt.dateTime(k.createdUtc)} |{" "}
                      {k.lastUsedUtc ? `Last used ${fmt.dateTime(k.lastUsedUtc)}` : "Never used"}
                    </p>
                  </div>
                  {k.revokedUtc ? (
                    <span className="text-[13px] text-muted-foreground">Revoked {fmt.dateTime(k.revokedUtc)}</span>
                  ) : (
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void revoke(k)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel
        title="Public documents"
        subtitle="Only documents switched on here are listed by the [row_documents] shortcode, and only while they are published."
      >
        {docs === null ? (
          <SkeletonRows rows={4} />
        ) : docs.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">No documents yet. Add them on the Documents page first.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--row-line)]">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{d.title}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {fmt.date(d.publishDateTime)} to {fmt.date(d.expiryDateTime)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`wp-doc-${d.id}`} className="text-[13px]">
                    Public on website
                  </Label>
                  <Switch
                    id={`wp-doc-${d.id}`}
                    checked={d.isPublicOnWebsite}
                    onCheckedChange={(v) => void toggleDoc(d, v)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
