export type Club = { name: string; id: string; url: string };

export type District = {
  number: string;
  region: string;
  states: string[];
  zone: string;
  cities: string[];
  website: string;
  clubs: Club[];
};

/** District & Club website directory — real data from example.org/Website.aspx. */
export const DISTRICTS: District[] = [];

/** Unique sorted state list for the "Filter by State" dropdown. */
export const STATE_OPTIONS = Array.from(
  new Set(DISTRICTS.flatMap((d) => d.states))
).sort();

/** Unique sorted zone list for the "Filter by Zone" dropdown. */
export const ZONE_OPTIONS = Array.from(new Set(DISTRICTS.map((d) => d.zone))).sort();
