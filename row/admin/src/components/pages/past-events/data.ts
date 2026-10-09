import type { EventButtonData } from "./parts";

// Real data scraped from https://rotaryindia.org/Past-Events.aspx.
// Photos extracted from the design comp (public/images/events/*).

export type EventBadge = { month: string; day: string; year: string };
export type MahabsLink = { label: string; url: string };
export type MahabsDay = { day: string; links: MahabsLink[] };

export type EventItem = {
  title: string;
  date: string;
  badge: EventBadge;
  venue: string;
  image: string;
  /** Zones the event belongs to — drives the listing's zone filter. */
  zones: number[];
  buttons?: EventButtonData[];
  days?: MahabsDay[]; // MAHABS-style accordion card
  trf?: MahabsLink[];
};

export const EVENTS: EventItem[] = [
  {
    title: "VISION 2030 - Regional Membership Summit Madurai & Chennai",
    date: "March 31, 2026",
    badge: { month: "MAR", day: "31", year: "2026" },
    venue: "Madurai & Chennai",
    image: "/images/events/vision-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View Video (Madurai)", kind: "video", url: "https://youtu.be/9lHqrBy66pI" },
      { label: "View Video (Chennai)", kind: "video", url: "https://youtu.be/MI5wshd1GSM" },
      { label: "View Photos (Madurai)", kind: "photos", url: "https://stories.jenophotography.com/share/VISION-2030---REGIONAL-MEMBERSHIP-SUMMIT-AT-MADURAI-Dpfe/#/" },
      { label: "View Photos (Chennai)", kind: "photos", url: "https://drive.google.com/drive/folders/1_LAmeapttTQVHjfZ17ABqSoSTfPDcaeL?usp=drive_link" },
    ],
  },
  {
    title: "TEJAS - Rotary Institute 2025",
    date: "November 14-15-16, 2025",
    badge: { month: "NOV", day: "14-16", year: "2025" },
    venue: "Yashobhoomi Convention Centre, New Delhi",
    image: "/images/events/tejas-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "Day 1 - Session 1", kind: "video", url: "https://youtu.be/RpZoSKWPf_Q" },
      { label: "Day 1 - Session 2", kind: "video", url: "https://youtu.be/0Yf4H_RtOaE" },
      { label: "Day 2 - Session 1", kind: "video", url: "https://youtu.be/NYpKoHjqTJY" },
      { label: "Day 2 - Session 2", kind: "video", url: "https://youtu.be/UPHUnZHD_f4" },
      { label: "Day 2 - Session 3", kind: "video", url: "https://youtu.be/fniqkobLhWA" },
      { label: "Day 3", kind: "video", url: "https://youtu.be/vtTH4MU_7bw" },
      { label: "View All Videos", kind: "video", url: "https://www.youtube.com/@TejasRZI2025", variant: "link" },
    ],
  },
  {
    title: "Lead25 AIM HIGH  - Rotary India Leadership Conclave",
    date: "August 23-24, 2025",
    badge: { month: "AUG", day: "23-24", year: "2025" },
    venue: "New Chennai Trade Centre, Tamilnadu",
    image: "/images/events/lead25-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "PreLead 25 - TRF Celebrations", kind: "video", url: "https://youtu.be/T_VXt3VH5Oc" },
      { label: "Rotary India Leadership Conclave", kind: "video", url: "https://youtu.be/P5OKhn-gaT8" },
      { label: "Padma Shri Mr Kamal Haasan", kind: "video", url: "https://youtu.be/fSeDkm8JG8M" },
      { label: "Lifetime Achievement Awards", kind: "video", url: "https://youtu.be/k1UPJDSpXis" },
      { label: "House of Friendship Arena", kind: "video", url: "https://youtu.be/GngTqw1n35A" },
      { label: "END POLIO", kind: "video", url: "https://youtu.be/urqD_jOnE9M" },
      { label: "Unveiling the Model of Rotary", kind: "video", url: "https://youtu.be/p9IcEfty710", full: true },
    ],
  },
  {
    title: "Disha 2025 - Zone 5 & 6",
    date: "March 18-19-20, 2025",
    badge: { month: "MAR", day: "18-20", year: "2025" },
    venue: "Hotel Taj Vivanta, Bhubaneswar, Odisha",
    image: "/images/events/disha-z56-hd.jpg",
    zones: [5, 6],
    buttons: [
      { label: "View", kind: "photos", url: "https://stories.jenophotography.com/share/Disha-25---Bhubaneshwar--XNYk/#/", full: true },
    ],
  },
  {
    title: "Disha 2025 - Zone 4 and 7",
    date: "March 15-16-17, 2025",
    badge: { month: "MAR", day: "15-17", year: "2025" },
    venue: "Hotel Intercontinental Sitapura, Jaipur",
    image: "/images/events/disha-z47-hd.jpg",
    zones: [4, 7],
    buttons: [
      { label: "Coming soon", kind: "video", full: true },
    ],
  },
  {
    title: "KOCHI - Rotary Institute 2024",
    date: "December 06-07-08, 2024",
    badge: { month: "DEC", day: "06-08", year: "2024" },
    venue: "Grand Hyatt Kochi Bolgatty",
    image: "/images/events/kochi-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View", kind: "video", url: "https://www.youtube.com/playlist?list=PLYfL_vZioGe1xQcTUJptQldlWDe3K7S-0", full: true },
    ],
  },
  {
    title: "Disha - Setting Targets For Triumph",
    date: "March 15-16-17, 2024",
    badge: { month: "MAR", day: "15-17", year: "2024" },
    venue: "Hotel Leela Ambience & Convention, Delhi",
    image: "/images/events/disha-2024-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View", kind: "video", url: "https://disha2024.rotaryindia.org/", full: true },
    ],
  },
  {
    title: "RISE - Rotary Insitute 2023",
    date: "December 15-16-17, 2023",
    badge: { month: "DEC", day: "15-17", year: "2023" },
    venue: "Chamara Vajra Convention Centre, Bengaluru",
    image: "/images/events/rise-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View", kind: "video", url: "https://www.youtube.com/playlist?list=PLYfL_vZioGe0NYGVllmTcEXCQqStsoVZM", full: true },
    ],
  },
  {
    title: "VISAKHA VISTA - Rotary Insitute 2022",
    date: "December 09-10-11, 2022",
    badge: { month: "DEC", day: "09-11", year: "2022" },
    venue: "Radisson Blu Resort, Visakhapatnam",
    image: "/images/events/visakha-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View", kind: "video", url: "https://www.youtube.com/playlist?list=PLYfL_vZioGe0SDR2-vpFJBxPAVmyrrvUd", full: true },
    ],
  },
  {
    title: "RI Presidential Conference",
    date: "April 29-30, May 01, 2022",
    badge: { month: "APR", day: "29–May 01", year: "2022" },
    venue: "Hyderabad",
    image: "/images/events/ri-presidential-hd.jpg",
    zones: [4, 5, 6, 7],
    buttons: [
      { label: "View", kind: "video", url: "https://www.youtube.com/playlist?list=PLYfL_vZioGe09BQqXOzp8Vr7ofMGXXHRt", full: true },
    ],
  },
  {
    title: "MAHABS - Rotary Insitute 2021",
    date: "December 10-11-12, 2021",
    badge: { month: "DEC", day: "10-12", year: "2021" },
    venue: "Mahabalipuram, Tamil Nadu",
    image: "/images/events/mahabs-hd.jpg",
    zones: [4, 5, 6, 7],
    days: [
      {
        day: "Day 01",
        links: [
          { label: "Day 01 Full Video", url: "https://youtube.com/@mahabs2141?si=ZMl_TpkIghCQiThX" },
          { label: "Welcome Address - PDG M. Muruganantham(MMM)", url: "https://youtu.be/UKw10GguZxE" },
          { label: "Feel The Heritage - RID A.S. Venkatesh", url: "https://youtu.be/9rIMEKisEvo" },
          { label: "Keynote Address - Shekar Mehta", url: "https://youtu.be/4TCezHStMpw" },
          { label: "Curtain Raiser - RID Dr Mahesh Kotbagi", url: "https://youtu.be/wi6yi7qO7FI" },
          { label: "Expression of Gratitude - PDG madhav Chandran", url: "https://youtu.be/pyztNaAhuCc" },
        ],
      },
      {
        day: "Day 02",
        links: [
          { label: "Day 02 Full Video", url: "https://youtube.com/@mahabs2141?si=ZMl_TpkIghCQiThX" },
          { label: "Opening Remarks - RID A.S. Venkatesh", url: "https://youtu.be/JwcF0Zq-teA" },
          { label: "Glimpses - PDG Muruganandam(MMM)", url: "https://youtu.be/QneaGTEY6xw" },
          { label: "Mr Kapil Dev Cricket Legend - Life Time Achievement Award Acceptance Speech", url: "https://youtu.be/If7neZI3JKo" },
          { label: "\"You are the Key\" Atmayogi Shri Aasaanji", url: "https://youtu.be/-mMLxtGsymk" },
          { label: "Trustee Gulam A vahanavaty -AKS Members", url: "https://youtu.be/dRNjVijhuuU" },
          { label: "PDRR Sujith CEO - Maatram Foundation", url: "https://youtu.be/X6ufvf1uABM" },
          { label: "RajeshVaidya - Indian Veena player", url: "https://youtu.be/mM8XZsglnAg" },
          { label: "Trustee Aziz Memon - 5 Years Financial Forecast", url: "https://youtu.be/TnCPdJeqJxU" },
          { label: "Entertainment - Sanjay Sawant & Team", url: "https://youtu.be/crHrrrMnnLI" },
        ],
      },
      {
        day: "Day 03",
        links: [
          { label: "Day 03 Full Video", url: "https://youtube.com/@mahabs2141?si=ZMl_TpkIghCQiThX" },
          { label: "Prakash Iyer - Leadership in Non Profit Organization", url: "https://youtu.be/IOvKSfwutQM" },
          { label: "\"Covid Warrior Award\" Honourable Minister Ma. Subramanian", url: "https://youtu.be/q1_AXOly5Vk" },
          { label: "Reflection - Shekhar Mehta", url: "https://youtu.be/-aLhgAJkRgU" },
          { label: "Impression - Trustee Aziz Memon", url: "https://youtu.be/WzokfbKc9fs" },
          { label: "Closing  Remarks  - RID A.S. Venkatesh", url: "https://youtu.be/6hmlflI1lKA" },
          { label: "Keep Going - PDG M. Muruganandam (MMM)", url: "https://youtu.be/dpN5o_jvIiY" },
          { label: "Expression of Gratitude - PDG Madhav Chandran", url: "https://youtu.be/0AJYh4fCy7k" },
        ],
      },
    ],
    trf: [
      { label: "TRF SEMINAR", url: "https://youtube.com/@mahabs2141?si=ZMl_TpkIghCQiThX" },
      { label: "TRF DINNER", url: "https://youtube.com/@mahabs2141?si=ZMl_TpkIghCQiThX" },
    ],
  },
];

/** URL slug derived from the event's image filename (e.g. "vision", "mahabs"). */
export function eventSlug(e: EventItem): string {
  return e.image.replace("/images/events/", "").replace(/(-hd)?\.jpg$/, "");
}

export function getEventBySlug(slug: string): EventItem | undefined {
  return EVENTS.find((e) => eventSlug(e) === slug);
}
