"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "@/components/icons";
import { ReCaptcha } from "./ReCaptcha";
import {
  getDistrictWebsites,
  getClubWebsites,
  type DistrictWebsite,
  type ClubWebsite,
} from "@/lib/websiteDirectory";

// Bundled district-number fallback — used only when the live website-directory
// API is unreachable, so the field never renders empty and the form still works.
const DISTRICTS = [
  "2981", "2982", "3000", "3011", "3012", "3020", "3030", "3040", "3053",
  "3055", "3056", "3060", "3070", "3080", "3090", "3100", "3110", "3120",
  "3131", "3132", "3141", "3142", "3150", "3160", "3170", "3181", "3182",
  "3191", "3192", "3201", "3203", "3204", "3211", "3212", "3231", "3233",
  "3234", "3240", "3250", "3261", "3262", "3291", "3838", "5656",
];

/* Multi-line sibling of .input-modern — same ring/focus voice. */
const AREA =
  "w-full resize-y rounded-xl bg-white px-4 py-3 text-[14px] leading-relaxed text-ink ring-1 ring-navy-950/15 transition-shadow duration-200 placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-gold-dark";

function Label({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode;
  required?: boolean;
  htmlFor: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-[13px] font-semibold text-ink/70 transition-colors duration-200 group-focus-within:text-gold-deep"
    >
      {children}
      {required && (
        <span className="ml-0.5 text-royal" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

function Counter({ value, max = 500 }: { value: string; max?: number }) {
  return (
    <p className="figure mt-1.5 text-right text-[11px] text-ink/50">
      {value.length}/{max}
    </p>
  );
}

/** One porcelain chapter panel — id feeds the page's scroll-spy ChapterRail. */
function Chapter({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-animate="up"
      data-animate-duration="0.7"
      className="scroll-mt-28 rounded-2xl bg-porcelain p-6 sm:p-8 lg:p-10"
    >
      <h3 className="font-display text-xl font-[560] tracking-tight text-navy-950">
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{hint}</p>
      <div className="mt-7">{children}</div>
    </section>
  );
}

/**
 * Prospective-member enquiry form as three porcelain chapters (Your details /
 * Your district & club / Confirm), scroll-spied by the page's ChapterRail.
 * Client component so the character counters (x/500) update live as the
 * visitor types. Verification is real Google reCAPTCHA v2 (same as the live
 * Potential_member.aspx form); submit validates the captcha and resets the
 * form — wire it to the enquiry endpoint when the backend is available
 * (field names name/email/mobile/district/club/referrerName/referrerDetails/
 * referenceDetails are stable for that wiring).
 */
export function ProspectiveForm() {
  const [referrerName, setReferrerName] = useState("");
  const [referrerDetails, setReferrerDetails] = useState("");
  const [referenceDetails, setReferenceDetails] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaError, setCaptchaError] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const widgetIdRef = useRef<number | null>(null);

  // District & club — districts load once from the live directory (bundled
  // fallback if it's unreachable); a district's clubs load only after it's
  // picked, because the clubs endpoint is scoped per-district.
  const [districts, setDistricts] = useState<DistrictWebsite[]>([]);
  const [districtNumber, setDistrictNumber] = useState("");
  const [clubs, setClubs] = useState<ClubWebsite[]>([]);
  const [clubsLoading, setClubsLoading] = useState(false);
  const [club, setClub] = useState("");
  const clubReq = useRef(0);

  useEffect(() => {
    getDistrictWebsites().then(setDistricts);
  }, []);

  const districtOptions = districts.length
    ? districts.map((d) => d.districtNumber)
    : DISTRICTS;

  const chooseDistrict = (num: string) => {
    setDistrictNumber(num);
    setClub("");
    setClubs([]);
    const id = districts.find((d) => d.districtNumber === num)?.districtId;
    if (id === undefined) return; // fallback list has no ids → club stays free text
    const my = ++clubReq.current;
    setClubsLoading(true);
    getClubWebsites(id).then((list) => {
      if (clubReq.current !== my) return; // a newer district selection superseded this
      setClubs(list);
      setClubsLoading(false);
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!captchaToken) {
      setCaptchaError(true);
      setSubmitted(false);
      return;
    }
    setCaptchaError(false);
    e.currentTarget.reset();
    setReferrerName("");
    setReferrerDetails("");
    setReferenceDetails("");
    setDistrictNumber("");
    setClub("");
    setClubs([]);
    if (widgetIdRef.current !== null) window.grecaptcha?.reset(widgetIdRef.current);
    setCaptchaToken(null);
    setSubmitted(true);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 lg:space-y-8">
      <Chapter
        id="your-details"
        title="Your details"
        hint="Who you are, how to reach you, and who pointed you our way."
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
          <div className="group sm:col-span-2">
            <Label htmlFor="name" required>
              Name
            </Label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="Enter your full name"
              className="input-modern"
            />
          </div>

          <div className="group">
            <Label htmlFor="email" required>
              Email ID
            </Label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="Enter your email address"
              className="input-modern"
            />
          </div>

          <div className="group">
            <Label htmlFor="mobile" required>
              Mobile Number
            </Label>
            <input
              id="mobile"
              name="mobile"
              type="tel"
              required
              placeholder="Enter your mobile number"
              className="input-modern"
            />
          </div>

          <div className="group sm:col-span-2">
            <Label htmlFor="referrerName" required>
              Referrers Name
            </Label>
            <input
              id="referrerName"
              name="referrerName"
              type="text"
              required
              placeholder="Enter referrer's name"
              maxLength={500}
              value={referrerName}
              onChange={(e) => setReferrerName(e.target.value)}
              className="input-modern"
            />
            <Counter value={referrerName} />
          </div>

          <div className="group">
            <Label htmlFor="referrerDetails">Referrers Details</Label>
            <textarea
              id="referrerDetails"
              name="referrerDetails"
              placeholder="Enter referrer's details"
              rows={4}
              maxLength={500}
              value={referrerDetails}
              onChange={(e) => setReferrerDetails(e.target.value)}
              className={AREA}
            />
            <Counter value={referrerDetails} />
          </div>

          <div className="group">
            <Label htmlFor="referenceDetails">Reference Details</Label>
            <textarea
              id="referenceDetails"
              name="referenceDetails"
              placeholder="Enter reference details"
              rows={4}
              maxLength={500}
              value={referenceDetails}
              onChange={(e) => setReferenceDetails(e.target.value)}
              className={AREA}
            />
            <Counter value={referenceDetails} />
          </div>
        </div>
      </Chapter>

      <Chapter
        id="district-club"
        title="Your district & club"
        hint="The Rotary district you live in and the club you'd like to join: the club validates your enquiry locally."
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
          <div className="group">
            <Label htmlFor="district" required>
              District
            </Label>
            <select
              id="district"
              name="district"
              value={districtNumber}
              onChange={(e) => chooseDistrict(e.target.value)}
              required
              className="select-ui figure"
            >
              <option value="" disabled>
                -Select-
              </option>
              {districtOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className="group">
            <Label htmlFor="club" required>
              Club
            </Label>
            {/* Clubs load only after a district is chosen (the endpoint is
                per-district). Falls back to free text when the directory has no
                list for the district — we never show fake options or block the
                enquiry. */}
            {districtNumber === "" ? (
              <input
                id="club"
                type="text"
                disabled
                placeholder="Select a district first"
                className="input-modern"
              />
            ) : clubsLoading ? (
              <input
                id="club"
                type="text"
                disabled
                placeholder="Loading clubs…"
                className="input-modern"
              />
            ) : clubs.length > 0 ? (
              <select
                id="club"
                name="club"
                value={club}
                onChange={(e) => setClub(e.target.value)}
                required
                className="select-ui figure"
              >
                <option value="" disabled>
                  -Select-
                </option>
                {clubs.map((c) => (
                  <option key={c.clubId} value={c.clubName}>
                    {c.city ? `${c.clubName}: ${c.city}` : c.clubName}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="club"
                name="club"
                type="text"
                value={club}
                onChange={(e) => setClub(e.target.value)}
                required
                placeholder="Enter the club you'd like to join"
                className="input-modern"
              />
            )}
          </div>
        </div>
      </Chapter>

      <Chapter
        id="confirm"
        title="Confirm"
        hint="A quick check so the club knows this enquiry comes from a person."
      >
        <div className="group">
          <p className="mb-2 text-[13px] font-semibold text-ink/70">
            Captcha
            <span className="ml-0.5 text-royal" aria-hidden>
              *
            </span>
          </p>
          <ReCaptcha
            widgetIdRef={widgetIdRef}
            onToken={(token) => {
              setCaptchaToken(token);
              if (token) setCaptchaError(false);
            }}
          />
          <p
            aria-live="polite"
            className="mt-2 min-h-5 text-[13px] font-semibold text-royal"
          >
            {captchaError ? "Please tick the captcha before submitting." : ""}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-5 border-t border-navy-950/10 pt-7 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            className="btn-primary shine min-h-12 w-full px-10 text-sm sm:w-auto"
          >
            Submit enquiry
          </button>
          {submitted ? (
            <p
              role="status"
              className="flex items-center gap-2 text-[13px] font-semibold text-navy-950"
            >
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-gold-deep" aria-hidden />
              Thank you! A club officer will be in touch soon.
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              Your details go only to your selected club.
            </p>
          )}
        </div>
      </Chapter>
    </form>
  );
}
