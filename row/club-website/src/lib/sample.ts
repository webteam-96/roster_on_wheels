// Sample content for theme previews (owner 2026-10-29): a preview (?preview-theme=<key>, see middleware) shows the
// club's real data and fills only the sections the club has left empty. Live visits never see any of this; an
// empty section there stays empty. People and numbers below are invented and marked as samples on the page.
import "server-only";
import { headers } from "next/headers";
import type {
  AboutPayload, Banner, BoardDirector, CalendarDay, DirectoryMember, PastPresident, PublicNewsletter,
  PublicProject, PublicProjectDetail, PublicSpeaker, PublicUpcomingEvent,
} from "./publicApi";
import { SAMPLE_PHOTOS } from "./samplePhotos";
import { pickRows } from "./sampleRule";

/** True on a theme-preview request. Outside a request (build time) there is no preview. */
export function inPreview(): boolean {
  try {
    return Boolean(headers().get("x-preview-theme"));
  } catch {
    return false;
  }
}

/** The real list when it has rows or this is not a preview; otherwise the sample rows. */
export async function orSample<T>(real: Promise<T[] | null>, sample: () => T[]): Promise<T[] | null> {
  return pickRows(await real, inPreview(), sample);
}

/** Sample ids sit far above real ones, so a sample project link opens the sample detail page. */
export const SAMPLE_ID_BASE = 990000;
export const isSampleId = (id: number) => id > SAMPLE_ID_BASE;

const photo = (i: number) => SAMPLE_PHOTOS.scenes[i % SAMPLE_PHOTOS.scenes.length] ?? null;
const face = (i: number) => SAMPLE_PHOTOS.people[i % Math.max(1, SAMPLE_PHOTOS.people.length)] ?? null;
const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const PEOPLE = [
  "Margaret Ellison", "David Okafor", "Helen Fischer", "Robert Lindqvist", "Susan Carter", "James O'Neill",
  "Anna Kowalski", "Peter Hughes", "Claire Dubois", "Michael Brennan", "Ruth Andersen", "Thomas Whitaker",
  "Elena Rossi", "George Patel", "Linda Morgan", "William Hart",
];
const ROLES = ["President", "Vice President", "Secretary", "Treasurer", "President-Elect", "Club Service Director",
  "Community Service Director", "Youth Service Director"];
const PROFESSIONS = ["Family doctor", "Architect", "Retired teacher", "Solicitor", "Accountant", "Civil engineer",
  "Pharmacist", "Small business owner", "Nurse", "Bank manager", "Librarian", "Estate agent", "Dentist",
  "Chef and restaurateur", "Software engineer", "Veterinary surgeon"];

const PROJECTS: [string, string, string, string][] = [
  // [title, avenue key, avenue name, location]
  ["Riverside tree planting", "community_service", "Community service", "Riverside Park"],
  ["Winter coat drive", "community_service", "Community service", "Town Hall"],
  ["Reading buddies at Elm Street School", "new_generation_service", "Youth service", "Elm Street Primary"],
  ["Clean water for Kisumu schools", "international_service", "International service", "Kisumu, Kenya"],
  ["Careers evening for school leavers", "vocational_service", "Vocational service", "Community College"],
  ["Food bank weekend", "community_service", "Community service", "St Mary's Hall"],
  ["Charity fun run", "club_service", "Club service", "Harbour Front"],
  ["Mental health first aid course", "vocational_service", "Vocational service", "Library meeting room"],
];

export const sampleProjects = (): PublicProject[] =>
  PROJECTS.map(([title, moduleKey, moduleName, location], i) => ({
    id: SAMPLE_ID_BASE + i + 1, yearId: 0, yearLabel: "This year", moduleKey, moduleName, title,
    description: "Members and volunteers gave a weekend to this project. The full story, photos and results appear here once the club writes it up.",
    location, projectDate: day(-14 - i * 19), areaOfFocus: null, primaryPhotoPath: photo(i),
    createdDate: null, modifiedDate: null,
  }));

export const sampleMeetings = (): PublicProject[] =>
  ["Fellowship evening", "Speaker: local hospice", "Club assembly", "Business meeting"].map((title, i) => ({
    id: SAMPLE_ID_BASE + 100 + i, yearId: 0, yearLabel: "This year", moduleKey: "club_service", moduleName: "Meetings",
    title, description: null, location: "The Grand Hotel", projectDate: day(-7 * (i + 1)), areaOfFocus: null,
    primaryPhotoPath: null, createdDate: null, modifiedDate: null,
  }));

export function sampleProjectDetail(id: number): PublicProjectDetail | null {
  const all = [...sampleProjects(), ...sampleMeetings()];
  const p = all.find((x) => x.id === id);
  if (!p) return null;
  const i = id - SAMPLE_ID_BASE - 1; // the list numbers from SAMPLE_ID_BASE + 1
  return {
    ...p, projectType: null, ongoingGroupTitle: null, isJointProject: false, coHostName: null, clubRole: null,
    funding: "Club funds and local sponsors", projectCost: 2400 + i * 350, currency: null,
    directBeneficiaries: 120 + i * 15, manHours: 80 + i * 12, rotariansInvolved: 14 + i, rotaractorsInvolved: 4,
    photos: [photo(i), photo(i + 1), photo(i + 2)].filter((x): x is string => Boolean(x)),
    children: [], summedProjectCost: null, summedDirectBeneficiaries: null, summedManHours: null,
    summedRotariansInvolved: null, summedRotaractorsInvolved: null,
  };
}

export const sampleBoard = (): BoardDirector[] =>
  ROLES.map((designation, i) => ({
    id: SAMPLE_ID_BASE + i, memberId: SAMPLE_ID_BASE + i, memberName: PEOPLE[i]!, profilePhotoPath: face(i),
    designation, sortOrder: i, designationSortOrder: i, memberIntroduction: null,
  }));

export const sampleDirectory = (): DirectoryMember[] =>
  PEOPLE.map((memberName, i) => ({
    memberId: SAMPLE_ID_BASE + i, memberName, profilePhotoPath: face(i), email: null, mobile: null,
    profession: PROFESSIONS[i] ?? null, designation: ROLES[i] ?? null, gender: null, memberIntroduction: null,
    isPersonalDetailsVisible: false,
  }));

export const samplePastPresidents = (): PastPresident[] => {
  const y = new Date().getUTCFullYear();
  return PEOPLE.slice(4, 14).map((memberName, i) => ({
    id: SAMPLE_ID_BASE + i, yearId: 0, yearLabel: `${y - i - 2}-${String((y - i - 1) % 100).padStart(2, "0")}`,
    memberId: SAMPLE_ID_BASE + i, memberName, profilePhotoPath: face(i + 4),
  }));
};

export const sampleEvents = (): PublicUpcomingEvent[] =>
  [["Club meeting with guest speaker", "The Grand Hotel"], ["Riverside clean-up morning", "Riverside Park"],
   ["Charity quiz night", "The Crown, High Street"], ["District conference", "City Conference Centre"]]
    .map(([title, venue], i) => ({
      id: SAMPLE_ID_BASE + i, title: title!, description: null, venue: venue!, eventDate: day(4 + i * 9),
      imagePath: null, registrationLink: null,
    }));

export const sampleNewsletters = (): PublicNewsletter[] =>
  ["Autumn bulletin", "Summer bulletin", "Spring bulletin"].map((title, i) => ({
    id: SAMPLE_ID_BASE + i, yearId: 0, title, publishDateTime: day(-30 - i * 90), filePath: null, linkUrl: null,
    attachmentType: null,
  }));

export const sampleSpeakers = (): PublicSpeaker[] =>
  [["Dr Fiona Grant", "Caring for carers"], ["Mark Ellis", "Building a town food network"], ["Priya Shah", "Young people and work"]]
    .map(([name, topic], i) => ({ meetingDate: day(5 + i * 7), name: name!, topic: topic!, bio: null, photoPath: face(i + 8) }));

export const sampleBanners = (): Banner[] =>
  [0, 1, 2].map((i) => ({
    id: SAMPLE_ID_BASE + i, bannerImagePath: photo(i) ?? "", documentPath: null, linkUrl: null, description: null, sortOrder: i,
  })).filter((b) => b.bannerImagePath);

/** Fills the club's unset About fields; the name, district and logo always stay the club's own. */
export function sampleAbout(about: AboutPayload | null): AboutPayload | null {
  if (!about || !inPreview()) return about;
  return {
    ...about,
    content: about.content || "<p>We are a group of local people who meet every week to plan service projects, hear from speakers and enjoy each other's company. Our members come from many professions and backgrounds, and we welcome new faces at every meeting.</p><p>Over the years the club has planted trees, fed families, supported schools and raised money for clean water abroad. Every project is planned and run by members and volunteers.</p>",
    meetingDay: about.meetingDay || "Wednesday",
    meetingFromTime: about.meetingFromTime || "19:00",
    meetingToTime: about.meetingToTime || "21:00",
    meetingAddress: about.meetingAddress || "The Grand Hotel, 12 Market Square",
    city: about.city || "Riverton",
    contacts: about.contacts?.length ? about.contacts : [{ email: "secretary@example.org", phone: "+44 1632 960000" }],
  };
}

export function sampleCalendar(real: CalendarDay | null, date?: string): CalendarDay | null {
  if (!inPreview()) return real;
  const base = real ?? { date: date ?? day(0), birthdays: [], anniversaries: [], events: [] };
  if (base.events.length + base.birthdays.length + base.anniversaries.length > 0) return base;
  return {
    ...base,
    events: [{ id: SAMPLE_ID_BASE, title: "Club meeting with guest speaker", description: null, imagePath: null,
      eventDate: `${base.date.slice(0, 10)}T19:00:00`, venue: "The Grand Hotel", registrationLink: null }],
    birthdays: [{ memberId: SAMPLE_ID_BASE + 1, memberName: PEOPLE[1]!, profilePhotoPath: face(1) }],
  };
}
