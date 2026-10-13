"use client";

import { useState, useEffect, useCallback } from "react";
import { useFeature } from "@/contexts/BrandContext";
import { useParams } from "next/navigation";
import {
  getClubInfoForDistrict, getClubMembers, getClubMemberDetail, getBoardOfDirectors, getBoardYearsByClub,
  getUpcomingEvents, getNewsletters, getClubProjectsView, getClubProjectsAvailableYears,
  getRotaryYears, getPhotoUrl, getCurrentRotaryYear,
} from "@/services/api";
import { ClubMemberItem } from "@/types/club";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ArrowLeft, Users, Newspaper, CalendarDays, FolderKanban, Building2, MapPin, Clock,
  Calendar, Globe, Phone, Mail, Briefcase, Award, ChevronDown, ChevronUp, FileText, ExternalLink,
} from "lucide-react";
import RotaryLoader from "@/components/RotaryLoader";
import SendStatusBadges from "@/components/SendStatusBadges";
import Link from "next/link";
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
  try { return new Date(d).toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
}

export default function ClubDetailViewPage() {
  const params = useParams();
  const showBloodGroup = useFeature("member.bloodGroup");
  const districtId = Number(params.id);
  const clubId = Number(params.clubId);

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
  const [projectModuleFilter, setProjectModuleFilter] = useState<string>("community_service");
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);
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

  // Fetch members
  const fetchMembers = useCallback(async (page: number = 1) => {
    setLoadingMembers(true);
    try {
      const result = await getClubMembers(clubId, page, 50);
      setMembers(result.items || []);
      setMemberTotal(result.totalCount || 0);
    } catch {}
    finally { setLoadingMembers(false); }
  }, [clubId]);

  // Fetch BOD
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
  }, [activeTab, memberFilter]);

  useEffect(() => {
    if (bodYearId && memberFilter === "bod") fetchBod(Number(bodYearId));
  }, [bodYearId]);

  // Fetch communication
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
  }, [activeTab]);

  // Fetch projects
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
  }, [activeTab]);

  useEffect(() => {
    if (projectYearId) {
      setLoadingProjects(true);
      getClubProjectsView(districtId, clubId, Number(projectYearId), projectModuleFilter)
        .then((data: any[]) => setProjects(data))
        .catch(() => {})
        .finally(() => setLoadingProjects(false));
    }
  }, [projectYearId, projectModuleFilter]);

  // Expand member detail
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
      <div className="flex items-center justify-center py-20"><RotaryLoader size="lg" /></div>
    </ProtectedRoute>
  );

  if (!club) return (
    <ProtectedRoute>
      <div className="text-center py-20">
        <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Club not found</p>
      </div>
    </ProtectedRoute>
  );

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/districts/${districtId}/clubs?view=module`}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold tracking-tight text-primary">{club.clubName}</h2>
            <p className="text-muted-foreground text-sm">District {club.districtNumber}{club.zoneName ? ` | ${club.zoneName}` : ""}</p>
          </div>
        </div>

        {/* Club Info Card */}
        <Card className="border-primary/20">
          <CardContent className="p-5">
            <div className="flex flex-col md:flex-row gap-5">
              {/* Logo */}
              <div className="flex-shrink-0">
                {club.clubLogoPath ? (
                  <img src={getPhotoUrl(club.clubLogoPath)} alt={club.clubName} className="w-24 h-24 rounded-xl object-cover border-2 border-primary/20" />
                ) : (
                  <div className="w-24 h-24 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-10 w-10 text-primary" />
                  </div>
                )}
              </div>
              {/* Details Grid */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-primary flex-shrink-0" />
                  <div><span className="text-muted-foreground">Rotary ID:</span> <strong>{club.clubRotaryId}</strong></div>
                </div>
                {club.meetingDay && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
                    <div><span className="text-muted-foreground">Meeting:</span> <strong>{club.meetingDay}</strong></div>
                  </div>
                )}
                {(club.meetingFromTime || club.meetingToTime) && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary flex-shrink-0" />
                    <div><span className="text-muted-foreground">Time:</span> <strong>{formatTime(club.meetingFromTime)}{club.meetingToTime ? ` - ${formatTime(club.meetingToTime)}` : ""}</strong></div>
                  </div>
                )}
                {club.meetingAddress && (
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                    <div><span className="text-muted-foreground">Venue:</span> {club.meetingAddress}</div>
                  </div>
                )}
                {(club.city || club.state) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                    <div>{[club.city, club.state].filter(Boolean).join(", ")}{club.pincode ? ` - ${club.pincode}` : ""}</div>
                  </div>
                )}
                {club.clubCharterDate && (
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary flex-shrink-0" />
                    <div><span className="text-muted-foreground">Charter:</span> {formatDate(club.clubCharterDate)}</div>
                  </div>
                )}
                {club.clubWebsite && (
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary flex-shrink-0" />
                    <a href={club.clubWebsite.startsWith("http") ? club.clubWebsite : `https://${club.clubWebsite}`} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate">{club.clubWebsite}</a>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary flex-shrink-0" />
                  <div><strong>{club.totalMembers}</strong> <span className="text-muted-foreground">Rotarians</span></div>
                </div>
                <Badge variant={club.isActive ? "default" : "destructive"} className="w-fit">{club.isActive ? "Active" : "Inactive"}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full h-auto bg-muted/50 border p-1.5 rounded-lg gap-2 grid grid-cols-3">
            <TabsTrigger value="members" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md px-4 py-2.5"><Users className="h-4 w-4 mr-2" />Rotarians & BOD</TabsTrigger>
            <TabsTrigger value="communication" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md px-4 py-2.5"><Newspaper className="h-4 w-4 mr-2" />Communication</TabsTrigger>
            <TabsTrigger value="projects" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md px-4 py-2.5"><FolderKanban className="h-4 w-4 mr-2" />Projects</TabsTrigger>
          </TabsList>

          {/* ── Members Tab ── */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex rounded-lg border">
                <Button variant={memberFilter === "rotarians" ? "default" : "ghost"} size="sm" className="rounded-r-none" onClick={() => setMemberFilter("rotarians")}>
                  All Rotarians
                </Button>
                <Button variant={memberFilter === "bod" ? "default" : "ghost"} size="sm" className="rounded-l-none" onClick={() => setMemberFilter("bod")}>
                  Board of Directors
                </Button>
              </div>
              {memberFilter === "bod" && bodYears.length > 0 && (
                <Select value={bodYearId} onValueChange={setBodYearId}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Year" /></SelectTrigger>
                  <SelectContent>
                    {bodYears.map((y: any) => (
                      <SelectItem key={y.yearId || y.id} value={String(y.yearId || y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {loadingMembers && <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>}

            {/* Rotarians List */}
            {memberFilter === "rotarians" && !loadingMembers && (
              <div className="space-y-2">
                {members.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">No rotarians found.</div>
                )}
                {members.map((m) => (
                  <Card key={m.id} className={`cursor-pointer transition-all hover:shadow-md ${expandedMemberId === m.id ? "border-primary/40 shadow-md" : ""}`}
                    onClick={() => toggleMemberDetail(m.id)}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        {m.profilePhotoPath ? (
                          <img src={getPhotoUrl(m.profilePhotoPath)} alt={m.memberName} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{m.memberName?.charAt(0)}</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm truncate">{m.memberName}</p>
                            {m.roles && m.roles.length > 0 && m.roles.map(r => (
                              <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">{m.primaryMobileNumber || "No mobile"}</p>
                        </div>
                        {expandedMemberId === m.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>

                      {/* Expanded Detail */}
                      {expandedMemberId === m.id && (
                        <div className="mt-3 pt-3 border-t space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
                          {loadingDetail === m.id ? (
                            <div className="flex justify-center py-4"><RotaryLoader size="sm" /></div>
                          ) : memberDetails[m.id] ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {memberDetails[m.id].emailId && (
                                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /><span>{memberDetails[m.id].emailId}</span></div>
                              )}
                              {memberDetails[m.id].businessName && (
                                <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-medium">{memberDetails[m.id].businessName}</span></div>
                              )}
                              {memberDetails[m.id].designation && (
                                <div className="flex items-center gap-2"><Award className="h-3.5 w-3.5 text-muted-foreground" /><span>{memberDetails[m.id].designation}</span></div>
                              )}
                              {memberDetails[m.id].classificationProfession && (
                                <div className="flex items-center gap-2"><FolderKanban className="h-3.5 w-3.5 text-muted-foreground" /><span>{memberDetails[m.id].classificationProfession}</span></div>
                              )}
                              {memberDetails[m.id].rotaryId && (
                                <div className="flex items-center gap-2"><Award className="h-3.5 w-3.5 text-muted-foreground" /><span>Rotary ID: {memberDetails[m.id].rotaryId}</span></div>
                              )}
                              {showBloodGroup && memberDetails[m.id].bloodGroup && (
                                <div className="flex items-center gap-2"><span className="text-muted-foreground">Blood:</span> {memberDetails[m.id].bloodGroup}</div>
                              )}
                              {memberDetails[m.id].businessPhone && (
                                <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /><span>{memberDetails[m.id].businessPhone}</span></div>
                              )}
                              {memberDetails[m.id].businessCity && (
                                <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /><span>{[memberDetails[m.id].businessCity, memberDetails[m.id].businessState].filter(Boolean).join(", ")}</span></div>
                              )}
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-center py-2">No additional details.</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {memberTotal > 50 && members.length >= 50 && (
                  <div className="text-center pt-2">
                    <Button variant="outline" size="sm" onClick={() => { setMemberPage(p => p + 1); fetchMembers(memberPage + 1); }}>Load more...</Button>
                  </div>
                )}
              </div>
            )}

            {/* BOD List */}
            {memberFilter === "bod" && (
              <div className="space-y-2">
                {bodMembers.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">No board of directors found for this year.</div>
                )}
                {bodMembers.map((b: any) => (
                  <Card key={b.id} className="hover:shadow-md transition-all">
                    <CardContent className="p-3 flex items-center gap-3">
                      {b.profilePhotoPath ? (
                        <img src={getPhotoUrl(b.profilePhotoPath)} alt={b.memberName} className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{b.memberName?.charAt(0)}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{b.memberName}</p>
                        <Badge variant="secondary" className="text-xs mt-0.5">{b.designationName}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Communication Tab ── */}
          <TabsContent value="communication" className="space-y-6">
            {loadingComm && <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>}

            {!loadingComm && (
              <>
                {/* Events Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-primary" />Upcoming Events
                  </h3>
                  {events.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">No upcoming events.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {events.map((ev: any) => (
                        <Card key={ev.id} className="hover:shadow-md transition-all">
                          <CardContent className="p-0">
                            <div className="flex gap-3">
                              {ev.imagePath && (
                                <img src={getPhotoUrl(ev.imagePath)} alt={ev.title} className="w-24 h-24 object-cover rounded-l-lg flex-shrink-0" />
                              )}
                              <div className="p-3 flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{ev.title}</p>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                                  <CalendarDays className="h-3 w-3" />{formatDate(ev.eventDate)}
                                </div>
                                {ev.eventVenue && (
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                    <MapPin className="h-3 w-3" /><span className="truncate">{ev.eventVenue}</span>
                                  </div>
                                )}
                                <Badge variant={ev.status === "Published" ? "default" : ev.status === "Expired" ? "destructive" : "secondary"} className="text-xs mt-1.5">{ev.status}</Badge>
                                <SendStatusBadges item={ev} />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                {/* Newsletters Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Newspaper className="h-5 w-5 text-primary" />Newsletters
                  </h3>
                  {newsletters.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">No newsletters.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {newsletters.map((nl: any) => (
                        <Card key={nl.id} className="hover:shadow-md transition-all">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                {nl.attachmentType === "file" ? <FileText className="h-5 w-5 text-primary" /> : <ExternalLink className="h-5 w-5 text-primary" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm truncate">{nl.title}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(nl.publishDateTime)}</p>
                                <Badge variant={nl.status === "Published" ? "default" : nl.status === "Expired" ? "destructive" : "secondary"} className="text-xs mt-1.5">{nl.status}</Badge>
                              </div>
                            </div>
                            {nl.attachmentType === "file" && nl.filePath && (
                              <a href={getPhotoUrl(nl.filePath)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-2 inline-block">View PDF</a>
                            )}
                            {nl.attachmentType === "link" && nl.linkUrl && (
                              <a href={nl.linkUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-2 inline-block">Open Link</a>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Projects Tab ── */}
          <TabsContent value="projects" className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              {projectYears.length > 0 && (
                <Select value={projectYearId} onValueChange={setProjectYearId}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {projectYears.map((y: any) => (
                      <SelectItem key={y.id} value={String(y.id)}>{y.yearLabel}{y.isCurrent ? " (Current)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={projectModuleFilter} onValueChange={setProjectModuleFilter}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Avenue of Service" /></SelectTrigger>
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

            {loadingProjects && <div className="flex justify-center py-12"><RotaryLoader size="lg" /></div>}

            {!loadingProjects && projects.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FolderKanban className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p>No projects found for this year.</p>
              </div>
            )}

            {!loadingProjects && projects.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {projects.map((p: any) => (
                  <Card key={p.id} onClick={() => setDetailProjectId(p.id)} className="hover:shadow-md hover:border-slate-300 transition-all overflow-hidden cursor-pointer">
                    <CardContent className="p-0">
                      {p.primaryPhoto && (
                        <img src={getPhotoUrl(p.primaryPhoto)} alt={p.title} className="w-full h-36 object-cover" />
                      )}
                      <div className="p-4 space-y-2">
                        <p className="font-semibold text-sm">{p.title}</p>
                        {p.moduleName && <Badge variant="outline" className="text-xs">{p.moduleName}</Badge>}
                        {(p.areaOfFocusName || p.otherAreaOfFocus) && (
                          <Badge variant="secondary" className="text-xs ml-1">{p.areaOfFocusName || p.otherAreaOfFocus}</Badge>
                        )}
                        {p.projectDate && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />{formatDate(p.projectDate)}
                          </div>
                        )}
                        {p.location && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" /><span className="truncate">{p.location}</span>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
                          {p.directBeneficiaries > 0 && <span><strong>{p.directBeneficiaries}</strong> Beneficiaries</span>}
                          {p.manHours > 0 && <span><strong>{p.manHours}</strong> Man Hours</span>}
                          {p.rotariansInvolved > 0 && <span><strong>{p.rotariansInvolved}</strong> Rotarians</span>}
                          {p.projectCost > 0 && <span><strong>{formatMoney(p.projectCost, p.currency)}</strong></span>}
                        </div>
                        {p.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
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
