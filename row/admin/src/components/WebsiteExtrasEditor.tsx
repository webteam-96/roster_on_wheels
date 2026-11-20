"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  downloadWebsiteQr, getWebsiteExtras, saveWebsiteExtras, type WebsiteExtrasView, type WebsiteScope,
} from "@/services/api";
import { EMPTY_EXTRAS_FORM, qrFileName, toForm, toSettings, type WebsiteExtrasForm } from "@/lib/websiteExtras";
import { ErrorState, Panel, SkeletonRows, rowTable } from "@/components/row/AppKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download } from "@/components/icons";

const apiMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

interface Props {
  scope: WebsiteScope;
  ownerId: number;
  /** The back arrow's target when the page was not opened with a ?returnTo= path. */
  fallbackBack: string;
}

const FIELDS: { key: keyof WebsiteExtrasForm; label: string; hint: string; placeholder: string }[] = [
  { key: "facebookPageUrl", label: "Facebook page", hint: "The page's link. Its timeline shows on the Social media page.", placeholder: "https://www.facebook.com/yourclub" },
  { key: "instagramUsername", label: "Instagram account", hint: "The account name or its link.", placeholder: "yourclub" },
  { key: "xUsername", label: "X account", hint: "The account name or its link.", placeholder: "yourclub" },
  { key: "gaMeasurementId", label: "Google Analytics measurement ID", hint: "From Google Analytics: Admin, Data streams. Counts visits once a visitor allows cookies.", placeholder: "G-XXXXXXXXXX" },
];

/**
 * Website extras: social feed embeds and the Google Analytics ID of a club or district website, what search engines
 * get (sitemap.xml, robots.txt, site search), and a QR code for every public page.
 */
export default function WebsiteExtrasEditor({ scope, ownerId, fallbackBack }: Props) {
  const returnTo = useSearchParams().get("returnTo");
  const back = returnTo && /^\/(?!\/)/.test(returnTo) ? returnTo : fallbackBack;

  const [view, setView] = useState<WebsiteExtrasView | null>(null);
  const [form, setForm] = useState<WebsiteExtrasForm>(EMPTY_EXTRAS_FORM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyQr, setBusyQr] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    getWebsiteExtras(scope, ownerId)
      .then((v) => { setView(v); setForm(toForm(v.settings)); })
      .catch((err) => setLoadError(apiMessage(err, "Could not load the website extras.")));
  }, [scope, ownerId, reload]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const v = await saveWebsiteExtras(scope, ownerId, toSettings(form));
      setView(v);
      setForm(toForm(v.settings));
      setNotice("Saved. The public website shows the changes at once.");
    } catch (err) {
      setError(apiMessage(err, "Could not save the website extras."));
    } finally {
      setSaving(false);
    }
  }

  async function downloadQr(path: string, format: "png" | "svg") {
    setBusyQr(path + format);
    setError(null);
    try {
      const blob = await downloadWebsiteQr(scope, ownerId, path, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = qrFileName(path, format);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiMessage(err, "Could not make the QR code."));
    } finally {
      setBusyQr(null);
    }
  }

  const siteUrl = view?.siteUrl?.replace(/\/+$/, "") ?? null;
  const changed = !!view && JSON.stringify(toSettings(form)) !== JSON.stringify(toSettings(toForm(view.settings)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={back} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--row-line)]" aria-label="Back">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-[24px] font-semibold leading-tight text-[#1B2C42]">Website extras</h1>
          <p className="text-[14px] text-[#64748B]">Social media feeds, visitor statistics, search engines and QR codes</p>
        </div>
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => setReload((n) => n + 1)} retryLabel="Try again" />
      ) : !view ? (
        <Panel title="Loading"><SkeletonRows rows={6} /></Panel>
      ) : (
        <>
          {error && <ErrorState message={error} />}
          {notice && <p role="status" className="rounded-[12px] border border-green-200 bg-green-50 px-4 py-3 text-[14px] text-green-800">{notice}</p>}

          <Panel title="Social media and analytics"
            subtitle={scope === "clubs" ? "Feeds show on the website's Social media page (/social). Leave a field empty to turn it off." : "Leave a field empty to turn it off."}
            footer={<>
              <span className="text-[#64748B]">Feeds and analytics load only for visitors who allow cookies.</span>
              <Button onClick={save} disabled={saving || !changed}>{saving ? "Saving" : "Save"}</Button>
            </>}>
            <div className="grid gap-5 md:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`we-${f.key}`}>{f.label}</Label>
                  <Input id={`we-${f.key}`} value={form[f.key]} placeholder={f.placeholder} maxLength={300}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} />
                  <p className="text-[13px] text-[#64748B]">{f.hint}</p>
                </div>
              ))}
            </div>
          </Panel>

          {scope === "clubs" && (
            <Panel title="Search engines and site search" subtitle="Made automatically from the website's pages, events and projects.">
              {siteUrl ? (
                <ul className="space-y-2 text-[14px] text-[#1B2C42]">
                  <li>Sitemap: <a className="font-semibold underline" href={`${siteUrl}/sitemap.xml`} target="_blank" rel="noopener noreferrer">{siteUrl}/sitemap.xml</a></li>
                  <li>Robots file: <a className="font-semibold underline" href={`${siteUrl}/robots.txt`} target="_blank" rel="noopener noreferrer">{siteUrl}/robots.txt</a></li>
                  <li>Site search: <a className="font-semibold underline" href={`${siteUrl}/search`} target="_blank" rel="noopener noreferrer">{siteUrl}/search</a>. Add it to the menu with the link value &quot;search&quot;, and the feeds page with &quot;social&quot;.</li>
                </ul>
              ) : (
                <p className="text-[14px] text-[#64748B]">The website has no address yet, so there is nothing for search engines to read.</p>
              )}
            </Panel>
          )}

          <Panel title="QR codes" subtitle="Print one on a poster or flyer: scanning it opens that page of the website.">
            {!siteUrl ? (
              <p className="text-[14px] text-[#64748B]">The website has no address yet. QR codes are ready once it has one.</p>
            ) : view.pages.length === 0 ? (
              <p className="text-[14px] text-[#64748B]">No pages yet.</p>
            ) : (
              <div className={rowTable.wrap}>
                <table className={rowTable.table}>
                  <thead className={rowTable.head}>
                    <tr><th className={rowTable.th}>Page</th><th className={rowTable.th}>Address</th><th className={rowTable.th}>Download</th></tr>
                  </thead>
                  <tbody className={rowTable.body}>
                    {view.pages.map((p) => (
                      <tr key={p.path} className={rowTable.tr}>
                        <td className={rowTable.td}>{p.title}</td>
                        <td className={rowTable.tdMuted}>{siteUrl}{p.path === "/" ? "" : p.path}</td>
                        <td className={rowTable.td}>
                          <div className="flex gap-2">
                            {(["png", "svg"] as const).map((fmt) => (
                              <Button key={fmt} variant="outline" size="sm" disabled={busyQr !== null}
                                onClick={() => downloadQr(p.path, fmt)} aria-label={`Download the ${p.title} QR code as ${fmt.toUpperCase()}`}>
                                <Download size={14} /> {busyQr === p.path + fmt ? "Making" : fmt.toUpperCase()}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
