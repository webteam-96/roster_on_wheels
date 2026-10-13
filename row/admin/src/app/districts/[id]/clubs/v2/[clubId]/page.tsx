"use client";

/**
 * Club Detail (from district) — V2 (dashboard palette)
 * ---------------------------------------------------------------------------
 * 1:1 port of `src/app/districts/[id]/clubs/[clubId]/page.tsx` with new
 * visual chrome mirroring
 * `src/app/district-admin-dashboard/membership/page.tsx`.
 *
 * Palette:
 *   Navy #1e3a5f, Hover #152a44, Gold #F7A81B, Slate text.
 *
 * URL params:
 *   ?returnTo=... — Back button target; falls back to V2 listing (module
 *                   view) so the flow stays inside V2.
 */

import { useState, useEffect, useCallback } from "react";
import { useFeature } from "@/contexts/BrandContext";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  getClubInfoForDistrict, getClubMembers, getClubMemberDetail,
  getBoardOfDirectors, getBoardYearsByClub,
  getUpcomingEvents, getNewsletters, getClubProjectsView,
  getClubProjectsAvailableYears, getPhotoUrl, getCurrentRotaryYear,
} from "@/services/api";
import { ClubMemberItem } from "@/types/club";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Users, Newspaper, CalendarDays, FolderKanban, Building2,
  MapPin, Clock, Calendar, Globe, Phone, Mail, Briefcase, Award,
  ChevronDown, ChevronUp, FileText, ExternalLink,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import SendStatusBadges from "@/components/SendStatusBadges";
import ProtectedRoute from "@/components/ProtectedRoute";
import ProjectDetailModal from "@/components/ProjectDetailModal";
import { formatMoney } from "@/lib/currency";

import { appLocale } from "@/lib/appFormat";
function formatTime(t: string | null) {
  if (!t) return "";
  return t.substring(0, 5);
}
function formatDate(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString(appLocale(), {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return d; }
}

export default function ClubDetailViewV2Page() {
  const params = useParams();
  const showBloodGroup = useFeature("member.bloodGroup");
  const searchParams = useSearchParams();
  const router = useRouter();
  const districtId = Number(params.id);
  const clubId = Number(params.clubId);

  const returnTo = searchParams.get("returnTo");
  const fallbackBack = `/districts/${districtId}/clubs/v2?view=module`;
  const goBack = () => router.push(returnTo || fallbackBack);

  const [club, setClub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("members");

  // Members tab
  const [members, setMembers] = useState<ClubMemberItem[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberFilter, setMemberFilter] = useState<"rotarians" | "bod">("rotarians");
  const [bodMembers, setBodMembers] = useState<any[]>([]);
  const [bodYears, setBodYears] = useState<any[]>([]);
  const [bodYearId, setBodYearId] = useState<string>("");
  const [expandedMemberId, setExpandedMemberId] = useState<number | null>(null);
  const [memberDetails, setMemberDetails] = useState<Record<number, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);

  // Communication tab
  const [newsletters, setNewsletters] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingComm, setLoadingComm] = useState(false);

  // Projects tab
  const [projects, setProjects] = useState<any[]>([]);
  const [projectYears, setProjectYears] = useState<any[]>([]);
  const [projectYearId, setProjectYearId] = useState<string>("");
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);
  const [projectModuleFilter, setProjectModuleFilter] = useState<string>("community_service");
  const [loadingProjects, setLoadingProjects] = useState(false);

  useEffect(() => {
    async function fetchClub() {
      setLoading(true);
      try {
        const data = await getClubInfoForDistrict(districtId, clubId);
        setClub(data);
      } catch {}
      finally { setLoading(false); }
    }
    fetchClub();
  }, [districtId, clubId]);

  const fetchMembers = useCallback(async (page: number = 1) => {
    setLoadingMembers(true);
    try {
      const result = await getClubMembers(clubId, page, 50);
      setMembers(result.items || []);
      setMemberTotal(result.totalCount || 0);
    } catch {}
    finally { setLoadingMembers(false); }
  }, [clubId]);

  const fetchBod = useCallback(async (yearId: number) => {
    try {
      const data = await getBoardOfDirectors(clubId, yearId);
      setBodMembers(Array.isArray(data) ? data : []);
    } catch {}
  }, [clubId]);

  useEffect(() => {
    if (activeTab === "members") {
      if (memberFilter === "rotarians" && members.length === 0) fetchMembers();
      if (memberFilter === "bod" && bodYears.length === 0) {
        getBoardYearsByClub(clubId).then((yrs: any[]) => {
          setBodYears(yrs);
          if (yrs.length > 0) {
            const cur = yrs.find((y: any) => y.isCurrent) || yrs[0];
            setBodYearId(String(cur.yearId || cur.id));
            fetchBod(cur.yearId || cur.id);
          }
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, memberFilter]);

  useEffect(() => {
    if (bodYearId && memberFilter === "bod") fetchBod(Number(bodYearId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodYearId]);

  useEffect(() => {
    if (activeTab === "communication" && newsletters.length === 0 && events.length === 0) {
      setLoadingComm(true);
      Promise.all([
        getCurrentRotaryYear().then(yr => getNewsletters(clubId, yr.id, 1, 20)).catch(() => ({ items: [] })),
        getUpcomingEvents(clubId, 1, 20).catch(() => ({ items: [] })),
      ]).then(([nl, ev]) => {
        setNewsletters(nl.items || []);
        setEvents(ev.items || []);
      }).finally(() => setLoadingComm(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "projects" && projectYears.length === 0) {
      setLoadingProjects(true);
      getClubProjectsAvailableYears(districtId, clubId).then((yrs: any[]) => {
        setProjectYears(yrs);
        if (yrs.length > 0) {
          const cur = yrs.find((y: any) => y.isCurrent) || yrs[0];
          setProjectYearId(String(cur.id));
        }
      }).catch(() => {}).finally(() => setLoadingProjects(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (projectYearId) {
      setLoadingProjects(true);
      getClubProjectsView(districtId, clubId, Number(projectYearId), projectModuleFilter)
        .then((data: any[]) => setProjects(data))
        .catch(() => {})
        .finally(() => setLoadingProjects(false));
    }
  }, [projectYearId, projectModuleFilter, districtId, clubId]);

  const toggleMemberDetail = async (memberId: number) => {
    if (expandedMemberId === memberId) { setExpandedMemberId(null); return; }
    setExpandedMemberId(memberId);
    if (!memberDetails[memberId]) {
      setLoadingDetail(memberId);
      try {
        const detail = await getClubMemberDetail(districtId, clubId, memberId);
        setMemberDetails(prev => ({ ...prev, [memberId]: detail }));
      } catch {}
      finally { setLoadingDetail(null); }
    }
  };

  if (loading) return (
    <ProtectedRoute>
      <div className="flex items-center justify-center py-20">
        <RotaryLoader size="lg" />
      </div>
    </ProtectedRoute>
  );

  if (!club) return (
    <ProtectedRoute>
      <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 shadow-sm">
        <Building2 className="h-12 w-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-500">Club not found</p>
      </div>
    </ProtectedRoute>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-4">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={goBack}
              className="border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold tracking-tight text-slate-800 truncate">
                {club.clubName}
              </h2>
              <p className="text-slate-500 text-sm">
                District {club.districtNumber}
                {club.zoneName ? ` | ${club.zoneName}` : ""}
              </p>
            </div>
          </div>
        </div>

        {/* ── Club Info Card ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-col md:flex-row gap-5">
            <div className="flex-shrink-0">
              {club.clubLogoPath ? (
                <img
                  src={getPhotoUrl(club.clubLogoPath)}
                  alt={club.clubName}
                  className="w-24 h-24 rounded-2xl object-cover ring-1 ring-slate-200"
                />
              ) : (
                <div
                  className="w-24 h-24 rounded-2xl flex items-center justify-center border-b-2 border-[#F7A81B]"
                  style={{ backgroundColor: "#1e3a5f" }}
                >
                  <Building2 className="h-10 w-10 text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                <div>
                  <span className="text-slate-500">Rotary ID:</span>{" "}
                  <strong className="text-slate-800">{club.clubRotaryId}</strong>
                </div>
              </div>
              {club.meetingDay && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <div>
                    <span className="text-slate-500">Meeting:</span>{" "}
                    <strong className="text-slate-800">{club.meetingDay}</strong>
                  </div>
                </div>
              )}
              {(club.meetingFromTime || club.meetingToTime) && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <div>
                    <span className="text-slate-500">Time:</span>{" "}
                    <strong className="text-slate-800">
                      {formatTime(club.meetingFromTime)}
                      {club.meetingToTime ? ` - ${formatTime(club.meetingToTime)}` : ""}
                    </strong>
                  </div>
                </div>
              )}
              {club.meetingAddress && (
                <div className="flex items-center gap-2 sm:col-span-2">
                  <MapPin className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <div>
                    <span className="text-slate-500">Venue:</span>{" "}
                    <span className="text-slate-700">{club.meetingAddress}</span>
                  </div>
                </div>
              )}
              {(club.city || club.state) && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <div className="text-slate-700">
                    {[club.city, club.state].filter(Boolean).join(", ")}
                    {club.pincode ? ` - ${club.pincode}` : ""}
                  </div>
                </div>
              )}
              {club.clubCharterDate && (
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <div>
                    <span className="text-slate-500">Charter:</span>{" "}
                    <span className="text-slate-700">{formatDate(club.clubCharterDate)}</span>
                  </div>
                </div>
              )}
              {club.clubWebsite && (
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                  <a
                    href={club.clubWebsite.startsWith("http") ? club.clubWebsite : `https://${club.clubWebsite}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#1e3a5f] underline truncate"
                  >
                    {club.clubWebsite}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#1e3a5f] flex-shrink-0" />
                <div>
                  <strong className="text-slate-800">{club.totalMembers}</strong>{" "}
                  <span className="text-slate-500">Rotarians</span>
                </div>
              </div>
              <Badge
                variant="outline"
                className={`w-fit text-[10px] font-medium ${
                  club.isActive
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {club.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList
              className="h-auto flex-wrap gap-1 p-1.5"
              style={{ backgroundColor: "#1e3a5f" }}
            >
              <TabsTrigger
                value="members"
                className="text-sm font-semibold px-3.5 py-1.5 rounded-md text-white hover:bg-white/10 data-[state=active]:bg-[#F7A81B] data-[state=active]:text-[#1e3a5f] data-[state=active]:shadow-sm"
              >
                <Users className="h-4 w-4 mr-2" />Rotarians &amp; BOD
              </TabsTrigger>
              <TabsTrigger
                value="communication"
                className="text-sm font-semibold px-3.5 py-1.5 rounded-md text-white hover:bg-white/10 data-[state=active]:bg-[#F7A81B] data-[state=active]:text-[#1e3a5f] data-[state=active]:shadow-sm"
              >
                <Newspaper className="h-4 w-4 mr-2" />Communication
              </TabsTrigger>
              <TabsTrigger
                value="projects"
                className="text-sm font-semibold px-3.5 py-1.5 rounded-md text-white hover:bg-white/10 data-[state=active]:bg-[#F7A81B] data-[state=active]:text-[#1e3a5f] data-[state=active]:shadow-sm"
              >
                <FolderKanban className="h-4 w-4 mr-2" />Projects
              </TabsTrigger>
            </TabsList>

            {/* ── Members Tab ─────────────────────────────────────────── */}
            <TabsContent value="members" className="mt-4 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex rounded-md border border-slate-200 bg-white overflow-hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`rounded-none ${
                      memberFilter === "rotarians"
                        ? "bg-[#1e3a5f] text-white hover:bg-[#152a44] hover:text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => setMemberFilter("rotarians")}
                  >
                    All Rotarians
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`rounded-none ${
                      memberFilter === "bod"
                        ? "bg-[#1e3a5f] text-white hover:bg-[#152a44] hover:text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => setMemberFilter("bod")}
                  >
                    Board of Directors
                  </Button>
                </div>
                {memberFilter === "bod" && bodYears.length > 0 && (
                  <Select value={bodYearId} onValueChange={setBodYearId}>
                    <SelectTrigger className="w-40 border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {bodYears.map((y: any) => (
                        <SelectItem key={y.yearId || y.id} value={String(y.yearId || y.id)}>
                          {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {loadingMembers && (
                <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
              )}

              {/* Rotarians List */}
              {memberFilter === "rotarians" && !loadingMembers && (
                <div className="space-y-2">
                  {members.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                      No rotarians found.
                    </div>
                  )}
                  {members.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-2xl border shadow-sm bg-white cursor-pointer transition-all hover:shadow-md ${
                        expandedMemberId === m.id ? "border-[#1e3a5f]/40 shadow-md" : "border-slate-200"
                      }`}
                      onClick={() => toggleMemberDetail(m.id)}
                    >
                      <div className="p-3">
                        <div className="flex items-center gap-3">
                          {m.profilePhotoPath ? (
                            <img
                              src={getPhotoUrl(m.profilePhotoPath)}
                              alt={m.memberName}
                              className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                              {m.memberName?.charAt(0)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate text-slate-800">{m.memberName}</p>
                              {m.roles && m.roles.length > 0 && m.roles.map((r) => (
                                <Badge
                                  key={r}
                                  variant="outline"
                                  className="text-[10px] border-slate-200 bg-slate-50 text-slate-700"
                                >
                                  {r}
                                </Badge>
                              ))}
                            </div>
                            <p className="text-xs text-slate-500">{m.primaryMobileNumber || "No mobile"}</p>
                          </div>
                          {expandedMemberId === m.id
                            ? <ChevronUp className="h-4 w-4 text-slate-400" />
                            : <ChevronDown className="h-4 w-4 text-slate-400" />}
                        </div>

                        {/* Expanded Detail */}
                        {expandedMemberId === m.id && (
                          <div
                            className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {loadingDetail === m.id ? (
                              <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>
                            ) : memberDetails[m.id] ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {memberDetails[m.id].emailId && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{memberDetails[m.id].emailId}</span>
                                  </div>
                                )}
                                {memberDetails[m.id].businessName && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                                    <span className="font-medium">{memberDetails[m.id].businessName}</span>
                                  </div>
                                )}
                                {memberDetails[m.id].designation && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <Award className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{memberDetails[m.id].designation}</span>
                                  </div>
                                )}
                                {memberDetails[m.id].classificationProfession && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <FolderKanban className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{memberDetails[m.id].classificationProfession}</span>
                                  </div>
                                )}
                                {memberDetails[m.id].rotaryId && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <Award className="h-3.5 w-3.5 text-slate-400" />
                                    <span>Rotary ID: {memberDetails[m.id].rotaryId}</span>
                                  </div>
                                )}
                                {showBloodGroup && memberDetails[m.id].bloodGroup && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <span className="text-slate-500">Blood:</span> {memberDetails[m.id].bloodGroup}
                                  </div>
                                )}
                                {memberDetails[m.id].businessPhone && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{memberDetails[m.id].businessPhone}</span>
                                  </div>
                                )}
                                {memberDetails[m.id].businessCity && (
                                  <div className="flex items-center gap-2 text-slate-700">
                                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                                    <span>
                                      {[memberDetails[m.id].businessCity, memberDetails[m.id].businessState]
                                        .filter(Boolean).join(", ")}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-slate-500 text-center py-2">No additional details.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {memberTotal > 50 && members.length >= 50 && (
                    <div className="text-center pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-200 text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          setMemberPage((p) => p + 1);
                          fetchMembers(memberPage + 1);
                        }}
                      >
                        Load more...
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* BOD List */}
              {memberFilter === "bod" && (
                <div className="space-y-2">
                  {bodMembers.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                      No board of directors found for this year.
                    </div>
                  )}
                  {bodMembers.map((b: any) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-slate-200 shadow-sm bg-white hover:shadow-md transition-all p-3 flex items-center gap-3"
                    >
                      {b.profilePhotoPath ? (
                        <img
                          src={getPhotoUrl(b.profilePhotoPath)}
                          alt={b.memberName}
                          className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                          {b.memberName?.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-slate-800">{b.memberName}</p>
                        <Badge
                          variant="outline"
                          className="text-[10px] mt-0.5 border-slate-200 bg-slate-50 text-slate-700"
                        >
                          {b.designationName}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Communication Tab ───────────────────────────────────── */}
            <TabsContent value="communication" className="mt-4 space-y-6">
              {loadingComm && (
                <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
              )}

              {!loadingComm && (
                <>
                  {/* Events */}
                  <div>
                    <h3 className="text-base font-semibold mb-3 flex items-center gap-2 text-slate-800">
                      <CalendarDays className="h-5 w-5 text-[#1e3a5f]" />Upcoming Events
                    </h3>
                    {events.length === 0 ? (
                      <p className="text-slate-500 text-sm py-4">No upcoming events.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {events.map((ev: any) => (
                          <div
                            key={ev.id}
                            className="rounded-2xl border border-slate-200 shadow-sm bg-white hover:shadow-md transition-all overflow-hidden"
                          >
                            <div className="flex gap-3">
                              {ev.imagePath && (
                                <img
                                  src={getPhotoUrl(ev.imagePath)}
                                  alt={ev.title}
                                  className="w-24 h-24 object-cover flex-shrink-0"
                                />
                              )}
                              <div className="p-3 flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate text-slate-800">{ev.title}</p>
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                                  <CalendarDays className="h-3 w-3" />{formatDate(ev.eventDate)}
                                </div>
                                {ev.eventVenue && (
                                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                    <MapPin className="h-3 w-3" />
                                    <span className="truncate">{ev.eventVenue}</span>
                                  </div>
                                )}
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] mt-1.5 font-medium ${
                                    ev.status === "Published"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : ev.status === "Expired"
                                      ? "border-red-200 bg-red-50 text-red-700"
                                      : "border-slate-200 bg-slate-50 text-slate-700"
                                  }`}
                                >
                                  {ev.status}
                                </Badge>
                                <SendStatusBadges item={ev} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Newsletters */}
                  <div>
                    <h3 className="text-base font-semibold mb-3 flex items-center gap-2 text-slate-800">
                      <Newspaper className="h-5 w-5 text-[#1e3a5f]" />Newsletters
                    </h3>
                    {newsletters.length === 0 ? (
                      <p className="text-slate-500 text-sm py-4">No newsletters.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {newsletters.map((nl: any) => (
                          <div
                            key={nl.id}
                            className="rounded-2xl border border-slate-200 shadow-sm bg-white hover:shadow-md transition-all p-4"
                          >
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/10 flex items-center justify-center flex-shrink-0">
                                {nl.attachmentType === "file"
                                  ? <FileText className="h-5 w-5 text-[#1e3a5f]" />
                                  : <ExternalLink className="h-5 w-5 text-[#1e3a5f]" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm truncate text-slate-800">{nl.title}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{formatDate(nl.publishDateTime)}</p>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] mt-1.5 font-medium ${
                                    nl.status === "Published"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : nl.status === "Expired"
                                      ? "border-red-200 bg-red-50 text-red-700"
                                      : "border-slate-200 bg-slate-50 text-slate-700"
                                  }`}
                                >
                                  {nl.status}
                                </Badge>
                              </div>
                            </div>
                            {nl.attachmentType === "file" && nl.filePath && (
                              <a
                                href={getPhotoUrl(nl.filePath)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#1e3a5f] underline mt-2 inline-block"
                              >
                                View PDF
                              </a>
                            )}
                            {nl.attachmentType === "link" && nl.linkUrl && (
                              <a
                                href={nl.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#1e3a5f] underline mt-2 inline-block"
                              >
                                Open Link
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </TabsContent>

            {/* ── Projects Tab ────────────────────────────────────────── */}
            <TabsContent value="projects" className="mt-4 space-y-4">
              <div className="flex items-center gap-4 flex-wrap">
                {projectYears.length > 0 && (
                  <Select value={projectYearId} onValueChange={setProjectYearId}>
                    <SelectTrigger className="w-48 border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {projectYears.map((y: any) => (
                        <SelectItem key={y.id} value={String(y.id)}>
                          {y.yearLabel}{y.isCurrent ? " (Current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={projectModuleFilter} onValueChange={setProjectModuleFilter}>
                  <SelectTrigger className="w-56 border-slate-200 bg-white focus:border-[#1e3a5f] focus:ring-[#1e3a5f]/20">
                    <SelectValue placeholder="Avenue of Service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="community_service">Community Service</SelectItem>
                    <SelectItem value="vocational_service">Vocational Service</SelectItem>
                    <SelectItem value="international_service">International Service</SelectItem>
                    <SelectItem value="new_generation_service">New Generation Service</SelectItem>
                    <SelectItem value="public_image_initiative">Public Image Initiative</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {loadingProjects && (
                <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>
              )}

              {!loadingProjects && projects.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <FolderKanban className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                  <p>No projects found for this year.</p>
                </div>
              )}

              {!loadingProjects && projects.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {projects.map((p: any) => (
                    <div
                      key={p.id}
                      onClick={() => setDetailProjectId(p.id)}
                      className="rounded-2xl border border-slate-200 shadow-sm bg-white hover:shadow-md hover:border-slate-300 transition-all overflow-hidden cursor-pointer"
                    >
                      {p.primaryPhoto && (
                        <img
                          src={getPhotoUrl(p.primaryPhoto)}
                          alt={p.title}
                          className="w-full h-36 object-cover"
                        />
                      )}
                      <div className="p-4 space-y-2">
                        <p className="font-semibold text-sm text-slate-800">{p.title}</p>
                        <div className="flex flex-wrap gap-1">
                          {p.moduleName && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-slate-200 bg-slate-50 text-slate-700"
                            >
                              {p.moduleName}
                            </Badge>
                          )}
                          {(p.areaOfFocusName || p.otherAreaOfFocus) && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-[#1e3a5f]/20 bg-[#1e3a5f]/5 text-[#1e3a5f]"
                            >
                              {p.areaOfFocusName || p.otherAreaOfFocus}
                            </Badge>
                          )}
                        </div>
                        {p.projectDate && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <CalendarDays className="h-3 w-3" />{formatDate(p.projectDate)}
                          </div>
                        )}
                        {p.location && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{p.location}</span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs text-slate-500 pt-1">
                          {p.directBeneficiaries > 0 && (
                            <span><strong className="text-slate-700">{p.directBeneficiaries}</strong> Beneficiaries</span>
                          )}
                          {p.manHours > 0 && (
                            <span><strong className="text-slate-700">{p.manHours}</strong> Man Hours</span>
                          )}
                          {p.rotariansInvolved > 0 && (
                            <span><strong className="text-slate-700">{p.rotariansInvolved}</strong> Rotarians</span>
                          )}
                          {p.projectCost > 0 && (
                            <span>
                              <strong className="text-slate-700">
                                {formatMoney(p.projectCost, p.currency)}
                              </strong>
                            </span>
                          )}
                        </div>
                        {p.description && (
                          <p className="text-xs text-slate-500 line-clamp-2">{p.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <ProjectDetailModal
        clubId={clubId}
        yearId={Number(projectYearId) || 0}
        projectId={detailProjectId}
        onClose={() => setDetailProjectId(null)}
      />
    </ProtectedRoute>
  );
}
