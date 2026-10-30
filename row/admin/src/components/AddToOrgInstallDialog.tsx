"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ADD_TO_ORG_WEBSTORE_URL } from "@/lib/addToOrg";
import { getClubRotaryOrgCredentials, saveClubRotaryOrgCredentials } from "@/services/api";
import { Puzzle, Chrome, RefreshCw, PlayCircle, Eye, EyeOff, Pencil, KeyRound } from "@/components/icons";

// YouTube video ID of the install-walkthrough clip (unlisted is fine). Set to "" to
// hide the video block entirely. YouTube embeds stream reliably with no share/quota
// pitfalls (unlike Drive's /preview player).
const INSTALL_VIDEO_ID = "SDF5tb5ONp4";
const hasInstallVideo = INSTALL_VIDEO_ID.length > 0;

/**
 * Setup dialog for the RI Flow-Bot extension. Two sections:
 *   1. Install steps — shown only while the extension isn't detected yet. Auto-shown
 *      on an Add-project page when the extension is missing, OR opened manually (e.g.
 *      from the dashboard's "Sync Projects to Rotary.org" card) via `open`/`onClose`.
 *   2. Rotary.org Login — always shown. Each club has its own rotary.org username/
 *      password (encrypted at rest); the extension needs these to sign in to
 *      spc.rotary.org on the club's behalf. Empty + editable until first saved, then
 *      read-only (masked password) with an Edit toggle.
 *
 * `installed` is accepted as a prop (not polled internally) so callers that already
 * run useExtensionStatus() — every add page, the new list pages, the new dashboard
 * card — just pass their existing value through instead of double-polling.
 */
export default function AddToOrgInstallDialog({
  clubId, open, onClose, installed,
}: { clubId: number; open: boolean; onClose: () => void; installed?: boolean | null }) {
  const showInstallSteps = installed !== true;

  const [credLoading, setCredLoading] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [credSuccess, setCredSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCredError(null);
    setCredSuccess(false);
    setCredLoading(true);
    getClubRotaryOrgCredentials(clubId)
      .then((r) => {
        setHasCredentials(r.hasCredentials);
        setUsername(r.username || "");
        setPassword(r.password || "");
        setEditing(!r.hasCredentials);
      })
      .catch(() => setCredError("Failed to load saved credentials."))
      .finally(() => setCredLoading(false));
  }, [open, clubId]);

  const handleSaveCredentials = async () => {
    if (!username.trim() || !password.trim()) {
      setCredError("Username and password are both required.");
      return;
    }
    setSaving(true);
    setCredError(null);
    try {
      await saveClubRotaryOrgCredentials(clubId, username.trim(), password);
      setHasCredentials(true);
      setEditing(false);
      setCredSuccess(true);
    } catch {
      setCredError("Failed to save credentials.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Puzzle className="h-5 w-5 text-blue-600" />
            Sync Projects to Rotary.org: Setup
          </DialogTitle>
          <DialogDescription>
            The free RI Flow-Bot browser extension copies your projects into Rotary
            International&apos;s Service Project Center for you, signed in with your club&apos;s
            own rotary.org login.
          </DialogDescription>
        </DialogHeader>

        {showInstallSteps && (
          <>
            {hasInstallVideo && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <PlayCircle className="h-4 w-4" /> Watch: add the extension in under a minute
                </p>
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${INSTALL_VIDEO_ID}?rel=0`}
                    className="aspect-video w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="How to install the RI Flow-Bot extension"
                  />
                </div>
              </div>
            )}

            <ol className="space-y-2.5 text-sm text-slate-700">
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">1</span>
                <span>Click <strong>Install Extension</strong> below: the Chrome Web Store opens in a new tab.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">2</span>
                <span>On that page, click <strong>Add to Chrome</strong> and confirm.</span>
              </li>
              <li className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">3</span>
                <span>Come back to this page and <strong>refresh</strong>. You&apos;re set.</span>
              </li>
            </ol>

            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <Chrome className="h-4 w-4 shrink-0" />
              <span>Works only on the <strong>Google Chrome</strong> browser on desktop.</span>
            </div>
          </>
        )}

        {/* Rotary.org Login — per-club credentials the extension uses to sign in to
            spc.rotary.org. Always shown, regardless of extension-install state, since
            the admin can set these up ahead of installing the extension. */}
        <div className="space-y-2.5 rounded-lg border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <KeyRound className="h-4 w-4 text-blue-600" /> Rotary.org Login
          </p>
          {credLoading ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : editing ? (
            <div className="space-y-2">
              <div>
                <Label htmlFor="rotaryOrgUsername" className="text-xs">Username</Label>
                <Input
                  id="rotaryOrgUsername"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="rotary.org username / email"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="rotaryOrgPassword" className="text-xs">Password</Label>
                <div className="relative">
                  <Input
                    id="rotaryOrgPassword"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="rotary.org password"
                    autoComplete="off"
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {credError && <p className="text-xs text-red-600">{credError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={handleSaveCredentials} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                {hasCredentials && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-slate-700">
                <div><span className="text-slate-500">Username:</span> {username}</div>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500">Password:</span>
                  <span>{showPassword ? password : "•".repeat(Math.min(password.length, 12) || 8)}</span>
                  <button type="button" onClick={() => setShowPassword((s) => !s)} className="text-slate-400 hover:text-slate-600">
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setEditing(true); setCredSuccess(false); }}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          )}
          {credSuccess && !editing && <p className="text-xs text-green-700">Saved.</p>}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {showInstallSteps && (
            <>
              <Button variant="outline" onClick={() => window.location.reload()}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh page
              </Button>
              <a href={ADD_TO_ORG_WEBSTORE_URL} target="_blank" rel="noopener noreferrer">
                <Button className="w-full bg-blue-600 font-semibold text-white hover:bg-blue-700">
                  Install Extension
                </Button>
              </a>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
