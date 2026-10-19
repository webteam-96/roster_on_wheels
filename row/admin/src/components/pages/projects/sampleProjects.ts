import type { Project } from "@/lib/projectsApi";

// Bundled fallback so /projects is never empty when the live projects API is
// unreachable (the hub prefers live data and falls back to this). Curated to
// span every state/district/club/area-of-focus/year the filters expose, with
// realistic titles, costs, beneficiaries and dates. Photos are intentionally
// null — the cards render their text-header variant, no broken image links.

export type BundledProject = Project & { primaryPhoto: string | null };

/** Compact builder — positional args, sensible derived defaults. */
function mk(
  id: number,
  title: string,
  areaOfFocus: string,
  projectCost: number,
  directBeneficiaries: number,
  projectDate: string,
  clubName: string,
  districtNumber: string,
  clubCity: string,
  clubState: string,
  zoneName: string
): BundledProject {
  return {
    id,
    title,
    description: null,
    projectDate,
    projectCost,
    directBeneficiaries,
    manHours: Math.max(40, Math.round(directBeneficiaries / 2.5)),
    rotariansInvolved: 8 + (id % 20),
    rotaractorsInvolved: id % 7,
    rccInvolved: id % 3,
    location: `${clubCity}, ${clubState}`,
    areaOfFocus,
    category: null,
    subCategory: null,
    funding: "Club",
    clubId: id,
    clubName,
    clubRotaryId: null,
    clubCity,
    clubState,
    districtNumber,
    zoneName,
    primaryPhoto: null,
  };
}

// Area-of-focus names use the API's natural spellings; normArea() matches them
// to the canonical cause tabs, so tab filtering works against this data.
const DPT = "Disease Prevention and Treatment";
const BEL = "Basic Education and Literacy";
const WSH = "Water, Sanitation and Hygiene";
const ENV = "Environment";
const MCH = "Maternal and Child Health";
const CED = "Community Economic Development";
const PCP = "Peacebuilding and Conflict Prevention";
const OTH = "Others";

export const SAMPLE_PROJECTS: BundledProject[] = [
  // ——— Tamil Nadu ———
  mk(70801, "Diabetes & Diabetic Retinopathy Screening Camp", DPT, 250000, 1200, "2025-08-26", "Chennai Coromandel", "3232", "Chennai", "Tamil Nadu", "Zone 6"),
  mk(70802, "Free Cataract Surgery Camp", DPT, 480000, 320, "2025-02-14", "Chennai Coromandel", "3232", "Chennai", "Tamil Nadu", "Zone 6"),
  mk(70803, "Smart Digital Classroom for Govt School", BEL, 615000, 540, "2024-11-05", "Madras East", "3232", "Chennai", "Tamil Nadu", "Zone 6"),
  mk(70804, "RO Drinking Water Plant, Village School", WSH, 340000, 2100, "2025-06-18", "Coimbatore Metro", "3234", "Coimbatore", "Tamil Nadu", "Zone 6"),
  mk(70805, "Miyawaki Urban Forest: 3,000 Saplings", ENV, 195000, 3000, "2024-08-09", "Coimbatore Metro", "3234", "Coimbatore", "Tamil Nadu", "Zone 6"),
  mk(70806, "Anganwadi Nutrition Kits", MCH, 128000, 460, "2025-01-22", "Madurai Central", "3000", "Madurai", "Tamil Nadu", "Zone 6"),
  mk(70807, "Tailoring Skills Centre for Women", CED, 220000, 85, "2024-09-30", "Madurai Central", "3000", "Madurai", "Tamil Nadu", "Zone 6"),
  mk(70808, "School Toilets & Handwash Stations", WSH, 410000, 780, "2023-12-11", "Pondicherry Auro City", "2981", "Pondicherry", "Tamil Nadu", "Zone 6"),

  // ——— Karnataka ———
  mk(70811, "Community Blood Donation Drive", DPT, 90000, 640, "2025-05-03", "Bangalore Orchards", "3190", "Bengaluru", "Karnataka", "Zone 6"),
  mk(70812, "Dialysis Unit Support: District Hospital", DPT, 1250000, 210, "2024-10-19", "Bangalore Orchards", "3190", "Bengaluru", "Karnataka", "Zone 6"),
  mk(70813, "Library & 2,000 Books for Rural Schools", BEL, 175000, 1500, "2025-03-27", "Mysore Brindavan", "3181", "Mysuru", "Karnataka", "Zone 6"),
  mk(70814, "Rainwater Harvesting: 12 Schools", WSH, 560000, 3400, "2024-07-14", "Mysore Brindavan", "3181", "Mysuru", "Karnataka", "Zone 6"),
  mk(70815, "Lake Rejuvenation & Cleanup", ENV, 720000, 8000, "2025-09-01", "Mangalore Coast", "3182", "Mangaluru", "Karnataka", "Zone 6"),
  mk(70816, "Maternal Health Awareness & Iron Kits", MCH, 96000, 380, "2024-12-05", "Mangalore Coast", "3182", "Mangaluru", "Karnataka", "Zone 6"),

  // ——— Maharashtra ———
  mk(70821, "Vocational Training: Two-Wheeler Repair", CED, 285000, 120, "2025-04-08", "Pune Heritage", "3131", "Pune", "Maharashtra", "Zone 5"),
  mk(70822, "Solar Rooftop for Zilla Parishad School", ENV, 890000, 620, "2024-11-28", "Pune Heritage", "3131", "Pune", "Maharashtra", "Zone 5"),
  mk(70823, "Menstrual Hygiene Awareness & Kits", WSH, 145000, 950, "2025-07-21", "Nashik Grapes", "3132", "Nashik", "Maharashtra", "Zone 5"),
  mk(70824, "Adult Literacy Evening Classes", BEL, 88000, 210, "2024-06-16", "Nashik Grapes", "3132", "Nashik", "Maharashtra", "Zone 5"),
  mk(70825, "TB Detection & Nutrition Support", DPT, 310000, 540, "2025-02-02", "Mumbai Gateway", "3141", "Mumbai", "Maharashtra", "Zone 5"),
  mk(70826, "Youth Peace Fellowship & Exchange", PCP, 175000, 60, "2024-09-12", "Mumbai Gateway", "3141", "Mumbai", "Maharashtra", "Zone 5"),
  mk(70827, "Child Immunisation Camp", MCH, 132000, 720, "2025-06-30", "Thane Creek", "3142", "Thane", "Maharashtra", "Zone 5"),

  // ——— Delhi ———
  mk(70831, "Mega Eye Screening & Spectacles", DPT, 265000, 1600, "2025-01-11", "New Delhi Central", "3011", "New Delhi", "Delhi", "Zone 4"),
  mk(70832, "Scholarships for Underprivileged Girls", BEL, 540000, 90, "2024-08-24", "New Delhi Central", "3011", "New Delhi", "Delhi", "Zone 4"),
  mk(70833, "Plastic-Free Neighbourhood Drive", ENV, 72000, 4200, "2025-05-18", "Delhi South Ridge", "3012", "New Delhi", "Delhi", "Zone 4"),
  mk(70834, "Sewing Machines for Self-Help Groups", CED, 198000, 75, "2024-12-20", "Delhi South Ridge", "3012", "New Delhi", "Delhi", "Zone 4"),
  mk(70835, "Community Toilet Block", WSH, 460000, 1300, "2023-11-09", "New Delhi Central", "3011", "New Delhi", "Delhi", "Zone 4"),

  // ——— West Bengal ———
  mk(70841, "Thalassemia Detection Camp", DPT, 210000, 880, "2025-03-15", "Calcutta Nabodiganta", "3291", "Kolkata", "West Bengal", "Zone 6"),
  mk(70842, "Digital Literacy for Rural Youth", BEL, 245000, 340, "2024-10-02", "Calcutta Nabodiganta", "3291", "Kolkata", "West Bengal", "Zone 6"),
  mk(70843, "Deep Tube Well: Arsenic-Free Water", WSH, 380000, 2600, "2025-08-07", "Siliguri Terai", "3240", "Siliguri", "West Bengal", "Zone 6"),
  mk(70844, "Mangrove Plantation, Sundarbans", ENV, 320000, 5500, "2024-07-26", "Siliguri Terai", "3240", "Siliguri", "West Bengal", "Zone 6"),
  mk(70845, "Newborn Care Kits for PHC", MCH, 110000, 300, "2025-04-19", "Calcutta Nabodiganta", "3291", "Kolkata", "West Bengal", "Zone 6"),

  // ——— Gujarat ———
  mk(70851, "Mega Health Check-up Camp", DPT, 340000, 1450, "2025-02-27", "Ahmedabad Riverfront", "3054", "Ahmedabad", "Gujarat", "Zone 5"),
  mk(70852, "STEM Lab for Municipal School", BEL, 700000, 480, "2024-09-05", "Ahmedabad Riverfront", "3054", "Ahmedabad", "Gujarat", "Zone 5"),
  mk(70853, "Check Dam & Watershed Revival", WSH, 950000, 6200, "2025-06-11", "Surat Diamond", "3060", "Surat", "Gujarat", "Zone 5"),
  mk(70854, "Organic Farming Training for Tribals", CED, 265000, 160, "2024-11-15", "Surat Diamond", "3060", "Surat", "Gujarat", "Zone 5"),
  mk(70855, "Skill & Livelihood Fair", CED, 180000, 540, "2023-12-02", "Ahmedabad Riverfront", "3054", "Ahmedabad", "Gujarat", "Zone 5"),
  mk(70856, "Community Kitchen: Meals for Elders", OTH, 155000, 2200, "2025-01-30", "Surat Diamond", "3060", "Surat", "Gujarat", "Zone 5"),
];
