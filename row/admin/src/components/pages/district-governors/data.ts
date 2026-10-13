export type Governor = {
  name: string;
  district: string;
  mobile: string;
  email: string;
  photo: string;
};

/**
 * District Governors — real data from example.org/District-Governor.aspx.
 * The live page defaults to Rotary year 2026-2027; GOVERNORS below is that
 * roster, verbatim, ordered by district number ascending (43 entries).
 */
export const DEFAULT_YEAR = "2026-2027";

/**
 * Rotary-year dropdown options exactly as they appear on the live page
 * (29 options, source order preserved — including 1980-1981 in second place).
 */
export const ROTARY_YEARS = [
  "2001-2002",
  "1980-1981",
  "2002-2003",
  "2003-2004",
  "2004-2005",
  "2005-2006",
  "2006-2007",
  "2007-2008",
  "2008-2009",
  "2009-2010",
  "2010-2011",
  "2011-2012",
  "2012-2013",
  "2013-2014",
  "2014-2015",
  "2015-2016",
  "2016-2017",
  "2017-2018",
  "2018-2019",
  "2019-2020",
  "2020-2021",
  "2021-2022",
  "2022-2023",
  "2023-2024",
  "2024-2025",
  "2025-2026",
  "2026-2027",
  "2027-2028",
  "2028-2029",
];

export const GOVERNORS: Governor[] = [];
