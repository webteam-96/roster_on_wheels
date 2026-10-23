"use client";

/**
 * N5 Communication: the sender profile (from name, from address, reply-to) and the club's or district's own sender
 * domains. A domain is checked in DNS only (ownership token, SPF, DKIM, DMARC TXT records); mass emails go out from
 * the profile address once its domain passes all four, otherwise from the platform address.
 */

import { useCallback, useEffect, useState } from "react";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import {
  addSenderDomain, deleteSenderDomain, getSenderDomains, saveCommSettings, verifySenderDomain,
  type CommSettings, type CommsScope, type SenderDomain,
} from "@/services/api";
import { appLocale } from "@/lib/appFormat";
import { btnPrimary, btnSecondary, card, errorOf, input } from "./ui";

const CHECKS: [keyof SenderDomain, string][] = [["ownershipOk", "Ownership"], ["spfOk", "SPF"], ["dkimOk", "DKIM"], ["dmarcOk", "DMARC"]];

export default function SenderSection({ scope, id, settings, onSaved }: {
  scope: CommsScope; id: number; settings: CommSettings; onSaved: (s: CommSettings) => void;
}) {
  const [domains, setDomains] = useState<SenderDomain[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [selector, setSelector] = useState("");
  const [fromName, setFromName] = useState(settings.senderFromName ?? "");
  const [local, setLocal] = useState(settings.senderFromEmail?.split("@")[0] ?? "");
  const [fromDomain, setFromDomain] = useState(settings.senderFromEmail?.split("@")[1] ?? "");
  const [replyTo, setReplyTo] = useState(settings.senderReplyTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDomains(await getSenderDomains(scope, id));
    } catch (e) {
      setError(errorOf(e, "Sender domains could not be loaded."));
    }
  }, [scope, id]);

  useEffect(() => { load(); }, [load]);

  const run = async (work: () => Promise<void>, done: string, failed: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await work();
      setNotice(done);
    } catch (e) {
      setError(errorOf(e, failed));
    } finally {
      setBusy(false);
    }
  };

  const checkDns = async (d: SenderDomain) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await verifySenderDomain(scope, id, d.id);
      setDomains((list) => list?.map((x) => (x.id === r.id ? r : x)) ?? null);
      if (r.verified) setNotice(`${r.domain} is verified.`);
      else setError("Not all records were found yet. DNS changes can take a few hours to show.");
    } catch (e) {
      setError(errorOf(e, "The DNS check failed."));
    } finally {
      setBusy(false);
    }
  };

  const verified = (domains ?? []).filter((d) => d.verified);

  const saveProfile = () => run(async () => {
    const senderFromEmail = local.trim() && fromDomain ? `${local.trim()}@${fromDomain}` : null;
    onSaved(await saveCommSettings(scope, id, {
      ...settings, senderFromName: fromName.trim() || null, senderFromEmail, senderReplyTo: replyTo.trim() || null,
    }));
  }, "Sender profile saved.", "The sender profile could not be saved.");

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-base font-semibold text-slate-800">Sender profile</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Used for mass emails. The from address must be on one of your verified domains below; until then mail goes out
          from the platform address with your from name. A from name typed on a mass email wins over this one.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            From name
            <input className={`${input} mt-1 w-full`} value={fromName} maxLength={100} onChange={(e) => setFromName(e.target.value)} />
          </label>
          <div className="text-sm text-slate-700">
            From address
            <div className="mt-1 flex items-center gap-1">
              <input aria-label="From address name part" className={`${input} w-28`} value={local} placeholder="news" onChange={(e) => setLocal(e.target.value)} />
              <span>@</span>
              <select aria-label="From address domain" className={`${input} min-w-0 flex-1`} value={fromDomain} onChange={(e) => setFromDomain(e.target.value)}>
                <option value="">Platform address</option>
                {verified.map((d) => <option key={d.id} value={d.domain}>{d.domain}</option>)}
                {fromDomain && !verified.some((d) => d.domain === fromDomain) && <option value={fromDomain}>{fromDomain} (not verified)</option>}
              </select>
            </div>
          </div>
          <label className="text-sm text-slate-700">
            Reply-to address
            <input type="email" className={`${input} mt-1 w-full`} value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
          </label>
        </div>
        <button type="button" className={`${btnPrimary} mt-4`} disabled={busy} onClick={saveProfile}>Save sender profile</button>
      </div>

      {(error || notice) && (
        <div className={card}>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        </div>
      )}

      <div className={card}>
        <h2 className="text-base font-semibold text-slate-800">Sender domains</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Add your domain, publish the DNS records shown for it, then press Check DNS. Only DNS is read.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-slate-700">
            Domain
            <input className={`${input} mt-1 block w-56`} value={newDomain} placeholder="yourclub.org" onChange={(e) => setNewDomain(e.target.value)} />
          </label>
          <label className="text-sm text-slate-700">
            DKIM selector (optional)
            <input className={`${input} mt-1 block w-40`} value={selector} placeholder="mail" onChange={(e) => setSelector(e.target.value)} />
          </label>
          <button type="button" className={btnPrimary} disabled={busy || !newDomain.trim()}
            onClick={() => run(async () => {
              const d = await addSenderDomain(scope, id, newDomain.trim(), selector.trim());
              setNewDomain(""); setSelector(""); setOpen(d.id);
              await load();
            }, "Domain added. Publish its DNS records, then check DNS.", "The domain could not be added.")}>
            Add domain
          </button>
        </div>

        <div className="mt-4">
          {domains === null ? (
            <TableSkeleton rows={2} />
          ) : domains.length === 0 ? (
            <p className="text-sm text-slate-500">No sender domains yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {domains.map((d) => (
                <li key={d.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-medium text-slate-800">{d.domain}</span>
                    {CHECKS.map(([k, label]) => (
                      <span key={k} className={`text-xs ${d[k] ? "text-emerald-700" : "text-slate-500"}`}>
                        {label}: {d[k] ? "passed" : "not found"}
                      </span>
                    ))}
                    <span className="text-xs text-slate-500">
                      {d.checkedAt ? `Checked ${new Date(d.checkedAt).toLocaleString(appLocale())}` : "Not checked yet"}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button type="button" className={btnSecondary} onClick={() => setOpen(open === d.id ? null : d.id)}>
                        {open === d.id ? "Hide records" : "DNS records"}
                      </button>
                      <button type="button" className={btnSecondary} disabled={busy} onClick={() => checkDns(d)}>
                        Check DNS
                      </button>
                      <button type="button" className={btnSecondary} disabled={busy}
                        onClick={() => window.confirm(`Remove ${d.domain}?`) && run(async () => {
                          await deleteSenderDomain(scope, id, d.id);
                          await load();
                        }, "Domain removed.", "The domain could not be removed.")}>
                        Remove
                      </button>
                    </span>
                  </div>
                  {open === d.id && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500">
                            <th className="py-1 pr-3 font-medium">Type</th>
                            <th className="py-1 pr-3 font-medium">Host</th>
                            <th className="py-1 pr-3 font-medium">Value</th>
                            <th className="py-1 font-medium">Why</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.records.map((r) => (
                            <tr key={r.host + r.value} className="align-top">
                              <td className="py-1 pr-3">{r.type}</td>
                              <td className="py-1 pr-3 font-mono break-all">{r.host}</td>
                              <td className="py-1 pr-3 font-mono break-all">{r.value}</td>
                              <td className="py-1 text-slate-500">{r.purpose}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
