"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getClub, getGreetingSettings, updateGreetingSettings } from "@/services/api";
import { UpdateGreetingSettingsRequest } from "@/types/greeting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, MessageSquare, Mail, Send, Info } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import { useSyncClubIdFromUrl } from "@/hooks/useSyncClubIdFromUrl";
import { useAuth } from "@/contexts/AuthContext";
import GreetingPauseNotice from "@/components/GreetingPauseNotice";

function Section({ icon: Icon, title, number, children }: {
  icon: React.ElementType; title: string; number: number; children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 bg-muted/40 border-b">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</div>
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-base">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function GreetingsSettingsPage() {
  useSyncClubIdFromUrl();
  const params = useParams();
  const router = useRouter();
  const clubId = Number(params.id);
  const searchParams = useSearchParams();
  // Return target for Back / post-save — honors ?returnTo= (e.g. the Communication
  // tab's "Edit messages" link); falls back to the legacy club dashboard hub.
  const backTo = searchParams.get("returnTo") || `/clubs/${clubId}/dashboard`;
  const { isSuperAdmin, isAdmin } = useAuth();
  const canManage = isSuperAdmin || isAdmin;

  const [clubName, setClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [birthdayGreeting, setBirthdayGreeting] = useState("");
  const [isEnableBirthdayNotification, setIsEnableBirthdayNotification] = useState(false);
  const [anniversaryGreeting, setAnniversaryGreeting] = useState("");
  const [isEnableAnniversaryNotification, setIsEnableAnniversaryNotification] = useState(false);
  const [isEnableBirthdayEmail, setIsEnableBirthdayEmail] = useState(false);
  const [birthdayEmailFrom, setBirthdayEmailFrom] = useState("");
  const [birthdayEmailSubject, setBirthdayEmailSubject] = useState("");
  const [birthdayEmailMessage, setBirthdayEmailMessage] = useState("");
  const [isEnableAnniversaryEmail, setIsEnableAnniversaryEmail] = useState(false);
  const [anniversaryEmailFrom, setAnniversaryEmailFrom] = useState("");
  const [anniversaryEmailSubject, setAnniversaryEmailSubject] = useState("");
  const [anniversaryEmailMessage, setAnniversaryEmailMessage] = useState("");

  const [pauseInfo, setPauseInfo] = useState<{ paused: boolean; reviewedYear: string | null; currentYear: string | null }>({ paused: false, reviewedYear: null, currentYear: null });

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [club, settings] = await Promise.all([
          getClub(clubId),
          getGreetingSettings(clubId),
        ]);
        setClubName(club.clubName);
        setPauseInfo({ paused: !!settings.isGreetingPaused, reviewedYear: settings.greetingReviewedYearLabel || null, currentYear: settings.currentYearLabel || null });
        setBirthdayGreeting(settings.birthdayGreeting || "");
        setIsEnableBirthdayNotification(settings.isEnableBirthdayNotification);
        setAnniversaryGreeting(settings.anniversaryGreeting || "");
        setIsEnableAnniversaryNotification(settings.isEnableAnniversaryNotification);
        setIsEnableBirthdayEmail(settings.isEnableBirthdayEmail);
        setBirthdayEmailFrom(settings.birthdayEmailFrom || "");
        setBirthdayEmailSubject(settings.birthdayEmailSubject || "");
        setBirthdayEmailMessage(settings.birthdayEmailMessage || "");
        setIsEnableAnniversaryEmail(settings.isEnableAnniversaryEmail);
        setAnniversaryEmailFrom(settings.anniversaryEmailFrom || "");
        setAnniversaryEmailSubject(settings.anniversaryEmailSubject || "");
        setAnniversaryEmailMessage(settings.anniversaryEmailMessage || "");
      } catch (err: any) {
        setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to load settings.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [clubId]);

  const handleSave = async () => {
    // Validation: mandatory fields when checkboxes are enabled
    if (isEnableBirthdayNotification && !birthdayGreeting.trim()) {
      setErrorMessage("Birthday Greeting is required when Birthday Notification is enabled.");
      return;
    }
    if (isEnableAnniversaryNotification && !anniversaryGreeting.trim()) {
      setErrorMessage("Anniversary Greeting is required when Anniversary Notification is enabled.");
      return;
    }
    if (isEnableBirthdayEmail) {
      if (!birthdayEmailSubject.trim()) { setErrorMessage("Birthday Email 'Subject' is required when Birthday Email is enabled."); return; }
      if (!birthdayEmailMessage.trim()) { setErrorMessage("Birthday Email 'Message' is required when Birthday Email is enabled."); return; }
    }
    if (isEnableAnniversaryEmail) {
      if (!anniversaryEmailSubject.trim()) { setErrorMessage("Anniversary Email 'Subject' is required when Anniversary Email is enabled."); return; }
      if (!anniversaryEmailMessage.trim()) { setErrorMessage("Anniversary Email 'Message' is required when Anniversary Email is enabled."); return; }
    }

    setSaving(true);
    try {
      const data: UpdateGreetingSettingsRequest = {
        birthdayGreeting: birthdayGreeting.trim() || null,
        isEnableBirthdayNotification,
        anniversaryGreeting: anniversaryGreeting.trim() || null,
        isEnableAnniversaryNotification,
        isEnableBirthdayEmail,
        birthdayEmailFrom: birthdayEmailFrom.trim() || null,
        birthdayEmailSubject: birthdayEmailSubject.trim() || null,
        birthdayEmailMessage: birthdayEmailMessage.trim() || null,
        isEnableAnniversaryEmail,
        anniversaryEmailFrom: anniversaryEmailFrom.trim() || null,
        anniversaryEmailSubject: anniversaryEmailSubject.trim() || null,
        anniversaryEmailMessage: anniversaryEmailMessage.trim() || null,
      };
      await updateGreetingSettings(clubId, data);
      setSuccessMessage("Greeting settings saved successfully.");
      setTimeout(() => router.push(backTo), 2000);
    } catch (err: any) {
      setErrorMessage(err?.response?.data?.message || err?.response?.data || "Failed to save greeting settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ClubAdminShell pageTitle="Greetings Settings" activeNavHref="/club-admin-dashboard/communication">
        <div className="flex items-center justify-center py-20">
          <RotaryLoader size="lg" />
        </div>
      </ClubAdminShell>
    );
  }

  return (
    <ClubAdminShell pageTitle="Greetings Settings" pageSubtitle={clubName} activeNavHref="/club-admin-dashboard/communication">
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={backTo}><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Greetings Settings</h2>
            <p className="text-muted-foreground text-base">{clubName}</p>
          </div>
        </div>

        <GreetingPauseNotice paused={pauseInfo.paused} reviewedYear={pauseInfo.reviewedYear} currentYear={pauseInfo.currentYear} />

        <Section icon={MessageSquare} title="In-App Notifications" number={1}>
          <div className="space-y-5">
            {/* Enable Birthday Notification */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isEnableBirthdayNotification}
                onChange={(e) => setIsEnableBirthdayNotification(e.target.checked)}
                disabled={!canManage}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Enable Birthday Notifications</span>
            </label>

            {/* Birthday Greeting - shown only when enabled */}
            {isEnableBirthdayNotification && (
              <div className="space-y-1.5 pl-7">
                <Label className="text-sm font-semibold text-foreground">
                  Birthday Greeting<span className="text-destructive ml-0.5">*</span>
                  <span className="text-muted-foreground font-normal ml-1">(Any language, max 700 characters)</span>
                </Label>
                <Textarea
                  value={birthdayGreeting}
                  onChange={(e) => setBirthdayGreeting(e.target.value)}
                  placeholder="Enter birthday greeting message..."
                  rows={4}
                  maxLength={700}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground text-right">{birthdayGreeting.length}/700</p>
              </div>
            )}

            {/* Enable Anniversary Notification */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isEnableAnniversaryNotification}
                onChange={(e) => setIsEnableAnniversaryNotification(e.target.checked)}
                disabled={!canManage}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Enable Anniversary Notifications</span>
            </label>

            {/* Anniversary Greeting - shown only when enabled */}
            {isEnableAnniversaryNotification && (
              <div className="space-y-1.5 pl-7">
                <Label className="text-sm font-semibold text-foreground">
                  Anniversary Greeting<span className="text-destructive ml-0.5">*</span>
                  <span className="text-muted-foreground font-normal ml-1">(Any language, max 700 characters)</span>
                </Label>
                <Textarea
                  value={anniversaryGreeting}
                  onChange={(e) => setAnniversaryGreeting(e.target.value)}
                  placeholder="Enter anniversary greeting message..."
                  rows={4}
                  maxLength={700}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground text-right">{anniversaryGreeting.length}/700</p>
              </div>
            )}

          </div>
        </Section>

        {/* ── 2. Email Settings ── */}
        <Section icon={Mail} title="Email Settings" number={2}>
          <div className="space-y-5">
            {/* Birthday Email */}
            <div className="space-y-4 border rounded-lg p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnableBirthdayEmail}
                  onChange={(e) => setIsEnableBirthdayEmail(e.target.checked)}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-semibold">Enable Birthday Email</span>
              </label>

              {isEnableBirthdayEmail && (
                <div className="space-y-4 pl-7">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">Subject<span className="text-destructive ml-0.5">*</span></Label>
                    <Input
                      value={birthdayEmailSubject}
                      onChange={(e) => setBirthdayEmailSubject(e.target.value)}
                      placeholder="Email subject"
                      disabled={!canManage}
                    />
                  </div>
                  <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>Every email will start with: Dear Rotarian &lt;Recipient Name&gt;</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">
                      Message<span className="text-destructive ml-0.5">*</span>
                      <span className="text-muted-foreground font-normal ml-1">(max 10,000 characters)</span>
                    </Label>
                    <Textarea
                      value={birthdayEmailMessage}
                      onChange={(e) => setBirthdayEmailMessage(e.target.value)}
                      placeholder="Enter birthday email message..."
                      rows={6}
                      maxLength={10000}
                      disabled={!canManage}
                    />
                    <p className="text-xs text-muted-foreground text-right">{birthdayEmailMessage.length}/10000</p>
                  </div>
                </div>
              )}
            </div>

            {/* Anniversary Email */}
            <div className="space-y-4 border rounded-lg p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnableAnniversaryEmail}
                  onChange={(e) => setIsEnableAnniversaryEmail(e.target.checked)}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-sm font-semibold">Enable Anniversary Email</span>
              </label>

              {isEnableAnniversaryEmail && (
                <div className="space-y-4 pl-7">
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">Subject<span className="text-destructive ml-0.5">*</span></Label>
                    <Input
                      value={anniversaryEmailSubject}
                      onChange={(e) => setAnniversaryEmailSubject(e.target.value)}
                      placeholder="Email subject"
                      disabled={!canManage}
                    />
                  </div>
                  <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <p>Every email will start with: Dear Rotarian &lt;Recipient Name&gt;</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">
                      Message<span className="text-destructive ml-0.5">*</span>
                      <span className="text-muted-foreground font-normal ml-1">(max 10,000 characters)</span>
                    </Label>
                    <Textarea
                      value={anniversaryEmailMessage}
                      onChange={(e) => setAnniversaryEmailMessage(e.target.value)}
                      placeholder="Enter anniversary email message..."
                      rows={6}
                      maxLength={10000}
                      disabled={!canManage}
                    />
                    <p className="text-xs text-muted-foreground text-right">{anniversaryEmailMessage.length}/10000</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* Save Button */}
        {canManage && (
          <div className="flex justify-end pb-8">
            <Button onClick={handleSave} disabled={saving} size="lg" className="shadow-md">
              {saving ? <RotaryLoader size="sm" /> : <><Send className="mr-2 h-4 w-4" />Save Settings</>}
            </Button>
          </div>
        )}

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => router.push(backTo)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ClubAdminShell>
  );
}
