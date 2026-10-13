"use client";

import { useState, useEffect, useCallback, useRef, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  getLoginAnnouncements, createLoginAnnouncement, updateLoginAnnouncement,
  toggleLoginAnnouncement, deleteLoginAnnouncement, getZones, getDistricts, getDistrictClubs,
} from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import {
  ArrowLeft, Plus, Pencil, Trash2, Megaphone, Eye, EyeOff, AlertTriangle, Users, Filter, MessageSquare,
  Globe, Wallet, Landmark, Building2, MessageCircle, Mail, Info, Check, MapPin, Map as MapIcon, Search,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import type { ZoneListItem } from "@/types/zone";
import type { DistrictListItem } from "@/types/district";
import type { ClubListItem } from "@/types/club";
import {
  ALL_ROLES_KEY, LOGIN_ANNOUNCEMENT_ROLE_GROUPS, LOGIN_ANNOUNCEMENT_ROLES, LOGIN_ANNOUNCEMENT_FILTERS,
  describeLocationSelection, describeLoginAnnouncementAudience, loginAnnouncementFilterLabel, loginAnnouncementRoleLabel,
  type LoginAnnouncementFilters, type LoginAnnouncementFilterValue,
} from "@/utils/loginAnnouncementRoles";

import { appLocale } from "@/lib/appFormat";
// Read an image file, downscale to a sane max width and re-compress, and return a
// data: URL. Embedding inline (base64) keeps the announcement self-contained — no
// upload endpoint, no host/media-routing juggling, no broken links for any viewer.
// Downscale + compress keeps the stored HTML small (a phone photo → ~50-120 KB).
async function fileToConstrainedDataUrl(file: File, maxW = 800, quality = 0.82): Promise<string> {
  const readAs = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("decode failed"));
    i.src = readAs;
  });
  const scale = Math.min(1, maxW / (img.width || maxW));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return readAs;
  ctx.drawImage(img, 0, 0, w, h);
  // Keep PNG (transparency) as PNG; everything else → JPEG for size.
  const isPng = file.type === "image/png";
  return canvas.toDataURL(isPng ? "image/png" : "image/jpeg", quality);
}

const FILTER_ICONS: Record<string, React.ElementType> = {
  clubWebsite: Globe,
  clubDues: Wallet,
  districtDues: Landmark,
  districtWebsite: Building2,
  whatsappCredits: MessageCircle,
  emailCredits: Mail,
};

// Selected-state colour per filter value, so the choice reads at a glance.
const FILTER_VALUE_STYLES: Record<LoginAnnouncementFilterValue, string> = {
  purchased: "bg-green-600 text-white border-green-600",
  not_purchased: "bg-amber-500 text-white border-amber-500",
  expired: "bg-red-500 text-white border-red-500",
};

function StepSection({ number, icon: Icon, title, subtitle, action, children }: {
  number: number; icon: React.ElementType; title: string; subtitle?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</span>
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground leading-tight">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

interface CheckOption {
  id: number;
  label: string;
  sub?: string;
}

// Searchable multi-select checkbox list (zones / districts / clubs).
function CheckList({ title, icon: Icon, options, selected, onChange, loading, emptyText }: {
  title: string; icon: React.ElementType; options: CheckOption[]; selected: number[];
  onChange: (ids: number[]) => void; loading?: boolean; emptyText: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q))
    : options;
  const selectedSet = new Set(selected);
  const toggle = (id: number) => onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const selectShown = () => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.id)])));
  const clearShown = () => {
    const shownIds = new Set(shown.map((o) => o.id));
    onChange(selected.filter((id) => !shownIds.has(id)));
  };

  return (
    <div className={`flex flex-col rounded-lg border ${selected.length > 0 ? "border-blue-300" : ""}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
        <span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</span>
        <Badge variant="outline" className={`text-xs font-normal ${selected.length > 0 ? "border-blue-300 bg-blue-50 text-blue-800" : ""}`}>
          {selected.length} selected
        </Badge>
      </div>
      <div className="px-3 pt-2 space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}…`}
            className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex items-center justify-between text-xs">
          <button type="button" onClick={selectShown} disabled={shown.length === 0} className="font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline">
            Select all{q ? " shown" : ""}
          </button>
          <button type="button" onClick={clearShown} disabled={selected.length === 0} className="text-muted-foreground hover:underline disabled:opacity-40 disabled:no-underline">
            Clear{q ? " shown" : ""}
          </button>
        </div>
      </div>
      <div className="mt-2 h-56 overflow-y-auto border-t">
        {loading ? (
          <div className="flex h-full items-center justify-center"><RotaryLoader size="sm" /></div>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{q ? "No matches." : emptyText}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((o) => (
              <li key={o.id}>
                <label className={`flex items-start gap-2 px-3 py-2 text-sm cursor-pointer transition-colors ${selectedSet.has(o.id) ? "bg-blue-50/60" : "hover:bg-muted/50"}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 mt-0.5 shrink-0 rounded border-gray-300"
                    checked={selectedSet.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="min-w-0">
                    <span className="block leading-tight">{o.label}</span>
                    {o.sub && <span className="block text-xs text-muted-foreground leading-tight">{o.sub}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function LoginAnnouncementPage() {
  const { isSuperAdmin } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedImgRef = useRef<HTMLImageElement | null>(null);
  const [imgSelected, setImgSelected] = useState(false);
  // "Show to" roles — ["ALL"] or specific role keys (multi-select).
  const [targetRoles, setTargetRoles] = useState<string[]>([ALL_ROLES_KEY]);
  const isAllRoles = targetRoles.includes(ALL_ROLES_KEY);
  // Optional purchase filters — a missing key means "Any".
  const [targetFilters, setTargetFilters] = useState<LoginAnnouncementFilters>({});
  const activeFilterCount = Object.values(targetFilters).filter(Boolean).length;

  // Optional location filter — zones / districts / clubs (multi-select checkboxes).
  const [zoneIds, setZoneIds] = useState<number[]>([]);
  const [districtIds, setDistrictIds] = useState<number[]>([]);
  const [clubIds, setClubIds] = useState<number[]>([]);
  const [zoneOptions, setZoneOptions] = useState<ZoneListItem[]>([]);
  const [districtOptions, setDistrictOptions] = useState<DistrictListItem[]>([]);
  const [clubsByDistrict, setClubsByDistrict] = useState<Record<number, ClubListItem[]>>({});
  const [locationListsLoading, setLocationListsLoading] = useState(false);
  const [clubDistrictsLoading, setClubDistrictsLoading] = useState<number[]>([]);
  // Names/district for ids that come from a saved announcement before the option lists load.
  const [savedLocationNames, setSavedLocationNames] = useState<{ zones: Record<number, string>; districts: Record<number, string>; clubs: Record<number, string>; clubDistrict: Record<number, number> }>({ zones: {}, districts: {}, clubs: {}, clubDistrict: {} });
  const locationCount = zoneIds.length + districtIds.length + clubIds.length;

  const toggleRole = (key: string) => {
    setTargetRoles((prev) => {
      // Unticking one role while ALL is on → every other role stays ticked.
      if (prev.includes(ALL_ROLES_KEY)) return LOGIN_ANNOUNCEMENT_ROLES.map((r) => r.key).filter((k) => k !== key);
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      return next.length === LOGIN_ANNOUNCEMENT_ROLES.length ? [ALL_ROLES_KEY] : next;
    });
  };

  const setFilter = (key: string, value: LoginAnnouncementFilterValue | undefined) => {
    setTargetFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value; else delete next[key];
      return next;
    });
  };

  // Club → district lookup (loaded options first, then the saved announcement's clubs).
  const clubDistrictOf = (clubId: number): number | undefined => {
    for (const [dId, clubs] of Object.entries(clubsByDistrict)) {
      if (clubs.some((c) => c.id === clubId)) return Number(dId);
    }
    return savedLocationNames.clubDistrict[clubId];
  };

  // Deselecting a zone/district drops the districts/clubs that no longer sit inside the selection.
  const pruneClubs = (keptDistrictIds: number[]) => {
    const kept = new Set(keptDistrictIds);
    setClubIds((prev) => prev.filter((id) => {
      const d = clubDistrictOf(id);
      return d === undefined || kept.has(d);
    }));
  };
  const changeZones = (ids: number[]) => {
    setZoneIds(ids);
    if (ids.length === 0) return;
    const zoneSet = new Set(ids);
    const allowed = new Set(districtOptions.filter((d) => d.fkZoneId != null && zoneSet.has(d.fkZoneId)).map((d) => d.id));
    const kept = districtIds.filter((id) => allowed.has(id) || !districtOptions.some((d) => d.id === id));
    setDistrictIds(kept);
    pruneClubs(kept);
  };
  const changeDistricts = (ids: number[]) => {
    setDistrictIds(ids);
    pruneClubs(ids);
  };
  const clearLocations = () => { setZoneIds([]); setDistrictIds([]); setClubIds([]); };

  const fetchItems = useCallback(async () => {
    try {
      const data = await getLoginAnnouncements();
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Zones + districts load once, the first time the dialog opens.
  useEffect(() => {
    if (!dialogOpen || zoneOptions.length > 0 || locationListsLoading) return;
    setLocationListsLoading(true);
    Promise.all([getZones(1, 500, undefined, 1), getDistricts(1, 9999, undefined, 1)])
      .then(([zones, districts]) => {
        setZoneOptions(((zones as any)?.items ?? []) as ZoneListItem[]);
        const list = ((districts as any)?.items ?? []) as DistrictListItem[];
        setDistrictOptions([...list].sort((a, b) => String(a.districtNumber).localeCompare(String(b.districtNumber), undefined, { numeric: true })));
      })
      .catch(() => setErrorMessage("Could not load zones and districts."))
      .finally(() => setLocationListsLoading(false));
  }, [dialogOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clubs load per selected district (only the districts not loaded yet).
  useEffect(() => {
    const missing = districtIds.filter((id) => !clubsByDistrict[id] && !clubDistrictsLoading.includes(id));
    if (missing.length === 0) return;
    setClubDistrictsLoading((prev) => [...prev, ...missing]);
    Promise.all(missing.map((id) => getDistrictClubs(id).then((rows) => [id, rows] as const).catch(() => [id, [] as ClubListItem[]] as const)))
      .then((results) => {
        setClubsByDistrict((prev) => {
          const next = { ...prev };
          results.forEach(([id, rows]) => { next[id] = [...rows].sort((a, b) => a.clubName.localeCompare(b.clubName)); });
          return next;
        });
      })
      .finally(() => setClubDistrictsLoading((prev) => prev.filter((id) => !missing.includes(id))));
  }, [districtIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turn off the browser's image resize handles (Firefox) so an inserted image
  // can't be dragged/stretched out of aspect. Modern Chrome already omits them.
  const disableObjectResizing = () => {
    try { document.execCommand("enableObjectResizing", false, "false"); } catch { /* not supported */ }
    try { document.execCommand("enableInlineTableEditing", false, "false"); } catch { /* not supported */ }
  };

  const openAdd = () => {
    setEditing(null);
    setTargetRoles([ALL_ROLES_KEY]);
    setTargetFilters({});
    clearLocations();
    setSavedLocationNames({ zones: {}, districts: {}, clubs: {}, clubDistrict: {} });
    setDialogOpen(true);
    selectedImgRef.current = null; setImgSelected(false);
    setTimeout(() => { if (editorRef.current) { editorRef.current.innerHTML = ""; editorRef.current.focus(); disableObjectResizing(); } }, 100);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setTargetRoles(Array.isArray(item.targetRoles) && item.targetRoles.length > 0 ? item.targetRoles : [ALL_ROLES_KEY]);
    setTargetFilters(item.targetFilters && typeof item.targetFilters === "object" ? { ...item.targetFilters } : {});
    const loc = item.targetLocations ?? {};
    setZoneIds(Array.isArray(loc.zoneIds) ? loc.zoneIds : []);
    setDistrictIds(Array.isArray(loc.districtIds) ? loc.districtIds : []);
    setClubIds(Array.isArray(loc.clubIds) ? loc.clubIds : []);
    const names = { zones: {} as Record<number, string>, districts: {} as Record<number, string>, clubs: {} as Record<number, string>, clubDistrict: {} as Record<number, number> };
    (loc.zones ?? []).forEach((z: any) => { names.zones[z.id] = z.name; });
    (loc.districts ?? []).forEach((d: any) => { names.districts[d.id] = d.name; });
    (loc.clubs ?? []).forEach((c: any) => { names.clubs[c.id] = c.name; if (c.districtId) names.clubDistrict[c.id] = c.districtId; });
    setSavedLocationNames(names);
    setDialogOpen(true);
    selectedImgRef.current = null; setImgSelected(false);
    setTimeout(() => { if (editorRef.current) { editorRef.current.innerHTML = item.content || ""; editorRef.current.focus(); disableObjectResizing(); } }, 100);
  };

  // Insert an <img> that is responsive and aspect-locked (max-width + height:auto),
  // so it displays cleanly in the editor, the admin list, AND the login popup and
  // can never be distorted. Used by both file-upload and image-URL paths.
  const insertImageHtml = (src: string) => {
    editorRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<img src="${src}" style="max-width:100%;height:auto;display:block;margin:8px auto;" />`
    );
  };

  const handleImageFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErrorMessage("Please choose an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { setErrorMessage("Image must be under 8 MB."); return; }
    try {
      const dataUrl = await fileToConstrainedDataUrl(file);
      insertImageHtml(dataUrl);
    } catch {
      setErrorMessage("Could not process that image. Try a different file.");
    }
  };

  // Highlight the ring on the currently-selected image only.
  const markSelectedImg = (img: HTMLImageElement | null) => {
    editorRef.current?.querySelectorAll("img").forEach((im) => {
      (im as HTMLImageElement).style.outline = "";
      (im as HTMLImageElement).style.outlineOffset = "";
    });
    if (img) { img.style.outline = "2px solid #2563eb"; img.style.outlineOffset = "2px"; }
  };

  // Click an image in the editor to select it; click elsewhere to deselect.
  const handleEditorClick = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") {
      selectedImgRef.current = t as HTMLImageElement;
      markSelectedImg(selectedImgRef.current);
      setImgSelected(true);
    } else {
      selectedImgRef.current = null;
      markSelectedImg(null);
      setImgSelected(false);
    }
  };

  // Resize the selected image PROPORTIONALLY (width % of the message; height auto → never
  // distorts). Steps of 10%, clamped 20–100%. Works on every screen incl. the mobile popup.
  const resizeSelectedImg = (deltaPct: number) => {
    const img = selectedImgRef.current;
    if (!img) return;
    const current = parseInt(img.style.width) || 100;
    const next = Math.min(100, Math.max(20, current + deltaPct));
    img.style.width = `${next}%`;
    img.style.height = "auto";
    img.style.maxWidth = "100%";
    editorRef.current?.focus();
  };

  // "Move" the image responsively via alignment (block + auto margins). No absolute
  // positioning — that would break the popup on narrow/mobile screens.
  const alignSelectedImg = (align: "left" | "center" | "right") => {
    const img = selectedImgRef.current;
    if (!img) return;
    img.style.display = "block";
    img.style.marginTop = "8px";
    img.style.marginBottom = "8px";
    img.style.marginLeft = align === "left" ? "0" : "auto";
    img.style.marginRight = align === "right" ? "0" : "auto";
    editorRef.current?.focus();
  };

  const handleSave = async () => {
    // Drop the blue selection ring before serializing so it isn't saved into the content.
    markSelectedImg(null);
    const content = editorRef.current?.innerHTML?.trim() || "";
    if (targetRoles.length === 0) {
      setErrorMessage("Select at least one role in step 1 (or ALL).");
      return;
    }
    if (!content || content === "<br>") {
      setErrorMessage("Message is required.");
      return;
    }
    // Send only the filters that are set ("Any" = omitted). An empty object clears all filters.
    const filters: Record<string, string> = {};
    Object.entries(targetFilters).forEach(([k, v]) => { if (v) filters[k] = v; });
    const payload = {
      content,
      targetRoles,
      targetFilters: filters,
      targetLocations: { zoneIds, districtIds, clubIds },
    };
    setSaving(true);
    try {
      if (editing) {
        await updateLoginAnnouncement(editing.id, { ...payload, isActive: editing.isActive });
        setSuccessMessage("Announcement updated.");
      } else {
        await createLoginAnnouncement({ ...payload, isActive: true });
        setSuccessMessage("Announcement created.");
      }
      setDialogOpen(false);
      await fetchItems();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (item: any) => {
    try {
      await toggleLoginAnnouncement(item.id);
      setSuccessMessage(item.isActive ? "Announcement deactivated." : "Announcement activated.");
      await fetchItems();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to toggle.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteLoginAnnouncement(deleteTarget.id);
      setDeleteTarget(null);
      setSuccessMessage("Announcement deleted.");
      await fetchItems();
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || "Failed to delete.");
      setDeleteTarget(null);
    }
  };

  const execCommand = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  if (!isSuperAdmin) {
    return (
      <ProtectedRoute>
        <div className="flex flex-col items-center py-20">
          <h3 className="text-lg font-semibold">Access Denied</h3>
          <p className="text-muted-foreground mt-2">Only SuperAdmin can manage announcements.</p>
        </div>
      </ProtectedRoute>
    );
  }

  const selectedRoleCount = isAllRoles ? LOGIN_ANNOUNCEMENT_ROLES.length : targetRoles.length;

  // Location option lists (cascading) + display names for the summary sentence.
  const zoneSet = new Set(zoneIds);
  const zoneCheckOptions: CheckOption[] = zoneOptions.map((z) => ({ id: z.id, label: z.zoneName, sub: `${z.totalDistricts} districts` }));
  const districtCheckOptions: CheckOption[] = districtOptions
    .filter((d) => zoneIds.length === 0 || (d.fkZoneId != null && zoneSet.has(d.fkZoneId)))
    .map((d) => ({ id: d.id, label: `District ${d.districtNumber}`, sub: d.zoneName ?? undefined }));
  const clubCheckOptions: CheckOption[] = districtIds
    .flatMap((dId) => clubsByDistrict[dId] ?? [])
    .map((c) => ({ id: c.id, label: c.clubName, sub: `District ${c.districtNumber}` }));
  const locationNames = {
    zones: { ...savedLocationNames.zones, ...Object.fromEntries(zoneOptions.map((z) => [z.id, z.zoneName])) },
    districts: { ...savedLocationNames.districts, ...Object.fromEntries(districtOptions.map((d) => [d.id, d.districtNumber])) },
    clubs: { ...savedLocationNames.clubs, ...Object.fromEntries(Object.values(clubsByDistrict).flat().map((c) => [c.id, c.clubName])) },
  };
  const locationPhrase = describeLocationSelection({ zoneIds, districtIds, clubIds }, locationNames);
  const locationSubtitle = locationCount === 0
    ? "No location filter — all zones, districts and clubs"
    : clubIds.length > 0
      ? `Only the ${clubIds.length} selected club${clubIds.length === 1 ? "" : "s"}`
      : districtIds.length > 0
        ? `Only the ${districtIds.length} selected district${districtIds.length === 1 ? "" : "s"}`
        : `Only the ${zoneIds.length} selected zone${zoneIds.length === 1 ? "" : "s"}`;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <Link href="/settings"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-primary">Login Announcement</h2>
              <p className="text-muted-foreground text-base">Show a popup to selected roles after login — optionally filtered by purchases and location</p>
            </div>
          </div>
          <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" />Add Announcement</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><RotaryLoader size="lg" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Megaphone className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No announcements yet</h3>
            <p className="text-muted-foreground mt-2">Click &quot;Add Announcement&quot; to create one.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((item: any) => {
              const roles: string[] = Array.isArray(item.targetRoles) && item.targetRoles.length > 0 ? item.targetRoles : [ALL_ROLES_KEY];
              const filters: Record<string, string> = item.targetFilters && typeof item.targetFilters === "object" ? item.targetFilters : {};
              const filterEntries = LOGIN_ANNOUNCEMENT_FILTERS.filter((f) => filters[f.key]);
              const loc = item.targetLocations ?? {};
              const locZones: any[] = loc.zones ?? [];
              const locDistricts: any[] = loc.districts ?? [];
              const locClubs: any[] = loc.clubs ?? [];
              const shortList = (names: string[]) => names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
              return (
                <Card key={item.id} className={`${item.isActive ? "border-green-300" : "border-gray-200 opacity-70"}`}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Megaphone className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">Announcement #{item.id}</CardTitle>
                        <Badge className={item.isActive ? "bg-green-500 hover:bg-green-600" : "bg-gray-400"}>
                          {item.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => handleToggle(item)} title={item.isActive ? "Deactivate" : "Activate"}>
                          {item.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(item)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(item)} title="Delete"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1.5 mb-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Users className="h-3.5 w-3.5" />Show to:</span>
                        {roles.map((k) => (
                          <Badge key={k} variant="outline" className="text-xs font-normal">{loginAnnouncementRoleLabel(k)}</Badge>
                        ))}
                      </div>
                      {filterEntries.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Filter className="h-3.5 w-3.5" />Only where:</span>
                          {filterEntries.map((f) => (
                            <Badge key={f.key} variant="outline" className="text-xs font-normal border-amber-300 bg-amber-50 text-amber-800">
                              {loginAnnouncementFilterLabel(f.key, filters[f.key])}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {(locZones.length > 0 || locDistricts.length > 0 || locClubs.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><MapPin className="h-3.5 w-3.5" />Location:</span>
                          {locZones.length > 0 && (
                            <Badge variant="outline" className="text-xs font-normal border-blue-300 bg-blue-50 text-blue-800" title={locZones.map((z) => z.name).join(", ")}>
                              Zones: {shortList(locZones.map((z) => z.name))}
                            </Badge>
                          )}
                          {locDistricts.length > 0 && (
                            <Badge variant="outline" className="text-xs font-normal border-blue-300 bg-blue-50 text-blue-800" title={locDistricts.map((d) => d.name).join(", ")}>
                              Districts: {shortList(locDistricts.map((d) => d.name))}
                            </Badge>
                          )}
                          {locClubs.length > 0 && (
                            <Badge variant="outline" className="text-xs font-normal border-blue-300 bg-blue-50 text-blue-800" title={locClubs.map((c) => c.name).join(", ")}>
                              Clubs: {locClubs.length === 1 ? locClubs[0].name : `${locClubs.length} selected`}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="border rounded-lg p-4 bg-muted/30 prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto" dangerouslySetInnerHTML={{ __html: item.content }} />
                    <p className="text-xs text-muted-foreground mt-2">
                      Created: {new Date(item.createdDate).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {item.modifiedDate && ` · Modified: ${new Date(item.modifiedDate).toLocaleString(appLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Add/Edit Dialog — 1 Who · 2 Purchase filters · 3 Location · 4 Message */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Announcement" : "Add Announcement"}</DialogTitle>
              <DialogDescription>Choose who sees the popup after login, narrow it down by purchases or location if needed, then write the message.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* 1. Who */}
              <StepSection
                number={1}
                icon={Users}
                title="Who should see it"
                subtitle={isAllRoles ? "All roles selected" : `${selectedRoleCount} of ${LOGIN_ANNOUNCEMENT_ROLES.length} roles selected`}
                action={
                  <button
                    type="button"
                    onClick={() => setTargetRoles(isAllRoles ? [] : [ALL_ROLES_KEY])}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      isAllRoles ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                    }`}
                  >
                    {isAllRoles && <Check className="h-3.5 w-3.5" />}
                    ALL roles
                  </button>
                }
              >
                <div className="space-y-4">
                  {LOGIN_ANNOUNCEMENT_ROLE_GROUPS.map((group) => (
                    <div key={group.title}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{group.title}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {group.roles.map((role) => {
                          const checked = isAllRoles || targetRoles.includes(role.key);
                          return (
                            <label
                              key={role.key}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                                checked ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 shrink-0 rounded border-gray-300"
                                checked={checked}
                                onChange={() => toggleRole(role.key)}
                              />
                              <span className="leading-tight">{role.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Family Login users never see login announcements.</p>
                </div>
              </StepSection>

              {/* 2. Purchase filters */}
              <StepSection
                number={2}
                icon={Filter}
                title="Filter by purchase (optional)"
                subtitle={activeFilterCount === 0 ? "No filter — every selected role sees it" : `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied · users must match all`}
                action={activeFilterCount > 0 ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTargetFilters({})}>Clear filters</Button>
                ) : undefined}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {LOGIN_ANNOUNCEMENT_FILTERS.map((def) => {
                    const Icon = FILTER_ICONS[def.key] ?? Filter;
                    const value = targetFilters[def.key];
                    return (
                      <div key={def.key} className={`rounded-lg border p-3 transition-colors ${value ? "border-amber-300 bg-amber-50/40" : ""}`}>
                        <div className="flex items-start gap-2 mb-2">
                          <Icon className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">{def.label}</p>
                            <p className="text-xs text-muted-foreground leading-tight">{def.hint}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={def.label}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!value}
                            onClick={() => setFilter(def.key, undefined)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              !value ? "bg-slate-700 text-white border-slate-700" : "bg-background hover:bg-muted"
                            }`}
                          >
                            Any
                          </button>
                          {def.options.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={value === opt.value}
                              onClick={() => setFilter(def.key, opt.value)}
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                value === opt.value ? FILTER_VALUE_STYLES[opt.value] : "bg-background hover:bg-muted"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </StepSection>

              {/* 3. Location */}
              <StepSection
                number={3}
                icon={MapPin}
                title="Filter by location (optional)"
                subtitle={locationSubtitle}
                action={locationCount > 0 ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearLocations}>Clear location</Button>
                ) : undefined}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <CheckList
                    title="Zones"
                    icon={MapIcon}
                    options={zoneCheckOptions}
                    selected={zoneIds}
                    onChange={changeZones}
                    loading={locationListsLoading}
                    emptyText="No zones found."
                  />
                  <CheckList
                    title="Districts"
                    icon={Landmark}
                    options={districtCheckOptions}
                    selected={districtIds}
                    onChange={changeDistricts}
                    loading={locationListsLoading}
                    emptyText={zoneIds.length > 0 ? "No districts in the selected zones." : "No districts found."}
                  />
                  <CheckList
                    title="Clubs"
                    icon={Building2}
                    options={clubCheckOptions}
                    selected={clubIds}
                    onChange={setClubIds}
                    loading={clubDistrictsLoading.length > 0 && clubCheckOptions.length === 0}
                    emptyText={districtIds.length === 0 ? "Select one or more districts to choose clubs." : "No clubs in the selected districts."}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Selecting zones narrows the district list; selecting districts loads their clubs. The most specific level you pick
                  applies — <strong>clubs</strong>, otherwise <strong>districts</strong>, otherwise <strong>zones</strong>.
                </p>
              </StepSection>

              {/* Audience summary */}
              <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-900">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{describeLoginAnnouncementAudience(targetRoles, targetFilters, locationPhrase)}</p>
              </div>

              {/* 4. Message */}
              <StepSection number={4} icon={MessageSquare} title="Message" subtitle="Shown inside the popup">
                <div className="space-y-0">
                  {/* Toolbar */}
                  <div className="flex flex-wrap gap-1 border rounded-t-lg p-2 bg-muted/50">
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("bold")} title="Bold"><b>B</b></Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("italic")} title="Italic"><i>I</i></Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("underline")} title="Underline"><u>U</u></Button>
                    <span className="w-px bg-border mx-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("justifyLeft")} title="Align Left">L</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("justifyCenter")} title="Center">C</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("justifyRight")} title="Right">R</Button>
                    <span className="w-px bg-border mx-1" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("insertUnorderedList")} title="Bullet List">UL</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => execCommand("insertOrderedList")} title="Numbered List">OL</Button>
                    <span className="w-px bg-border mx-1" />
                    {/* Upload a photo from the computer (embedded inline, aspect-locked) */}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
                    <Button type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} title="Upload Photo">📷 Photo</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => {
                      const url = prompt("Enter image URL:");
                      if (url) insertImageHtml(url);
                    }} title="Insert Image by URL">IMG URL</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => {
                      const url = prompt("Enter link URL:");
                      if (url) execCommand("createLink", url);
                    }} title="Insert Link">LINK</Button>
                    <span className="w-px bg-border mx-1" />
                    <select className="text-xs border rounded px-1 h-8" onChange={(e) => { execCommand("fontSize", e.target.value); e.target.value = ""; }}>
                      <option value="">Size</option>
                      <option value="1">Small</option>
                      <option value="3">Normal</option>
                      <option value="5">Large</option>
                      <option value="7">Huge</option>
                    </select>
                    <input type="color" className="h-8 w-8 cursor-pointer border rounded" onChange={(e) => execCommand("foreColor", e.target.value)} title="Text Color" />
                  </div>
                  {/* Contextual image controls — appear when an image is clicked */}
                  {imgSelected && (
                    <div className="flex flex-wrap items-center gap-1 border-x border-b border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                      <span className="font-semibold text-blue-700 mr-1">Selected image:</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => resizeSelectedImg(-10)} title="Smaller">Smaller −</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => resizeSelectedImg(+10)} title="Larger">Larger +</Button>
                      <span className="w-px bg-blue-200 mx-1 self-stretch" />
                      <span className="text-blue-700">Move:</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => alignSelectedImg("left")} title="Align left">⬅ Left</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => alignSelectedImg("center")} title="Center">◎ Center</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => alignSelectedImg("right")} title="Align right">Right ➡</Button>
                    </div>
                  )}
                  {/* Editor */}
                  <div
                    ref={editorRef}
                    contentEditable
                    onClick={handleEditorClick}
                    className="min-h-[200px] border border-t-0 rounded-b-lg p-4 focus:outline-none focus:ring-2 focus:ring-primary/20 prose prose-sm max-w-none [&_img]:max-w-full [&_img]:h-auto"
                    suppressContentEditableWarning
                  />
                  <p className="text-xs text-muted-foreground pt-2">
                    <strong>📷 Photo:</strong> upload up to <strong>8&nbsp;MB</strong> — auto-resized to <strong>800&nbsp;px</strong> max
                    width &amp; compressed. <strong>Click an image</strong> to resize (Smaller/Larger, keeps aspect) or move it
                    (Left/Center/Right). Recommended: a landscape banner around <strong>800×400&nbsp;px</strong>.
                  </p>
                </div>
              </StepSection>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <RotaryLoader size="sm" /> : (editing ? "Update" : "Save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Announcement"
          description="Are you sure you want to delete this announcement? This action cannot be undone."
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
