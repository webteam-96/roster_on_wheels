"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getMember, getPhotoUrl } from "@/services/api";
import { Member } from "@/types/member";
import { User, Mail, Phone, MapPin, Calendar, Heart, Globe, Briefcase, Users, IdCard, Award, Building2 } from "lucide-react";
import Image from "next/image";
import RotaryLoader from "@/components/RotaryLoader";
import { formatBirthAnniversary } from "@/lib/dateUtils";
import { useFeature } from "@/contexts/BrandContext";

interface MemberDetailDialogProps {
  memberId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function MemberDetailDialog({ memberId, open, onClose }: MemberDetailDialogProps) {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(false);
  const showBloodGroup = useFeature("member.bloodGroup");
  const showFamily = useFeature("member.familyDetails");

  useEffect(() => {
    if (!open || !memberId) { setMember(null); return; }
    setLoading(true);
    getMember(memberId)
      .then(setMember)
      .catch(() => setMember(null))
      .finally(() => setLoading(false));
  }, [open, memberId]);

  const photoUrl = member?.profilePhotoPath ? getPhotoUrl(member.profilePhotoPath) : null;
  const familyPhotoUrl = member?.familyPhotoPath ? getPhotoUrl(member.familyPhotoPath) : null;

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center items-center py-16"><RotaryLoader size="lg" /></div>
        ) : !member ? (
          <div className="text-center py-16 text-muted-foreground">Failed to load member details.</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-muted border-2 border-primary/20">
                  {photoUrl ? (
                    <Image src={photoUrl} alt={member.memberName} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><User className="h-7 w-7" /></div>
                  )}
                </div>
                <div>
                  <p className="text-xl font-bold text-primary">{member.memberName}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {member.rotaryId && <Badge variant="secondary" className="text-xs"><IdCard className="h-3 w-3 mr-1" />{member.rotaryId}</Badge>}
                    {member.gender && <Badge variant="outline" className="text-xs">{member.gender}</Badge>}
                    {showBloodGroup && member.bloodGroup && <Badge variant="outline" className="text-xs text-red-600 border-red-200">{member.bloodGroup}</Badge>}
                    {member.isYouth && <Badge className="text-xs bg-blue-500">Youth</Badge>}
                  </div>
                </div>
              </DialogTitle>
            </DialogHeader>

            {/* Contact */}
            <Section icon={<Phone className="h-4 w-4" />} title="Contact">
              <Field label="Email" value={member.emailId} />
              <Field label="Mobile" value={member.primaryMobileNumber ? `${member.primaryCountryPhoneCode || ""} ${member.primaryMobileNumber}` : null} />
              {member.secondaryMobileNumber && <Field label="Secondary Mobile" value={`${member.secondaryCountryPhoneCode || ""} ${member.secondaryMobileNumber}`} />}
            </Section>

            {/* Personal */}
            <Section icon={<Calendar className="h-4 w-4" />} title="Personal">
              {/* Birthday + anniversary display as DD-MM only (year saved in DB, never shown). */}
              <Field label="Date of Birth" value={formatBirthAnniversary(member.birthDate)} />
              <Field label="Anniversary" value={formatBirthAnniversary(member.anniversaryDate)} />
              <Field label="Language" value={member.primaryLanguage} />
              {member.donorRecognition && <Field label="Donor Recognition" value={member.donorRecognition} />}
              {/* Designation + Classification are member-level (stored on club_members) */}
              {member.designation && <Field label="Designation" value={member.designation} />}
              {member.classificationProfession && <Field label="Classification / Profession" value={member.classificationProfession} />}
            </Section>

            {/* Introduction */}
            {member.memberIntroduction && (
              <Section icon={<Award className="h-4 w-4" />} title="Introduction">
                <p className="text-sm text-muted-foreground col-span-2">{member.memberIntroduction}</p>
              </Section>
            )}

            {/* Addresses */}
            {member.addresses && member.addresses.length > 0 && (
              <Section icon={<MapPin className="h-4 w-4" />} title="Addresses">
                {member.addresses.map((addr, i) => (
                  <div key={i} className="col-span-2 rounded-lg border p-3 space-y-1 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">{addr.addressType}</Badge>
                      {addr.businessName && <span className="font-medium text-primary">{addr.businessName}</span>}
                    </div>
                    <p className="text-muted-foreground">{[addr.address, addr.city, addr.state, addr.pinCode, addr.country].filter(Boolean).join(", ")}</p>
                    {addr.phoneNumber && <p className="text-muted-foreground">Phone: {addr.countryPhoneCode} {addr.phoneNumber}</p>}
                    {addr.businessEmailId && <p className="text-muted-foreground">Email: {addr.businessEmailId}</p>}
                  </div>
                ))}
              </Section>
            )}

            {/* Social */}
            {(member.facebook || member.instagram || member.linkedIn || member.twitter || member.youtube || member.website) && (
              <Section icon={<Globe className="h-4 w-4" />} title="Social Links">
                {member.facebook && <Field label="Facebook" value={member.facebook} />}
                {member.instagram && <Field label="Instagram" value={member.instagram} />}
                {member.linkedIn && <Field label="LinkedIn" value={member.linkedIn} />}
                {member.twitter && <Field label="Twitter" value={member.twitter} />}
                {member.youtube && <Field label="YouTube" value={member.youtube} />}
                {member.website && <Field label="Website" value={member.website} />}
              </Section>
            )}

            {/* Family */}
            {showFamily && member.familyMembers && member.familyMembers.length > 0 && (
              <Section icon={<Users className="h-4 w-4" />} title="Family Members">
                {member.familyMembers.map((fm) => (
                  <div key={fm.id} className="col-span-2 flex items-center gap-3 rounded-lg border p-3">
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-muted">
                      {fm.photoPath ? (
                        <Image src={getPhotoUrl(fm.photoPath) || ""} alt={fm.name} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary"><User className="h-5 w-5" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-sm">
                      <p className="font-medium">{fm.name} <Badge variant="outline" className="text-xs ml-1">{fm.relation}</Badge></p>
                      <p className="text-muted-foreground text-xs">
                        {[fm.phoneNumber && `${fm.countryPhoneCode} ${fm.phoneNumber}`, fm.emailId, showBloodGroup && fm.bloodGroup && `Blood: ${fm.bloodGroup}`, fm.birthDate && `DOB: ${formatBirthAnniversary(fm.birthDate)}`].filter(Boolean).join(" | ")}
                      </p>
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Separator />
      <h4 className="text-sm font-semibold flex items-center gap-2 text-primary">{icon}{title}</h4>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || value === "—") return null;
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
