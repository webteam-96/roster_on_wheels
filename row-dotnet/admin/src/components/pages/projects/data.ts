// ROW project analytics — real "All Year" data scraped from
// example.org (StateList.aspx / ClubListhomePage.aspx). Cumulative totals.

export type Metric = { n: string; c: number; p: number; inr: number; usd: number };
export type ClubMetric = { n: string; p: number };

export const TOTALS = {
  projects: 0,
  clubs: 0,
  inr: 0,
  usd: 0,
  manHours: 0,
};

export const YEARS = ["All Year", "2025-2026", "2024-2025", "2023-2024", "2022-2023", "2021-2022", "2020-2021", "2019-2020", "2018-2019", "2017-2018", "2016-2017", "2015-2016", "2014-2015", "2013-2014", "2012-2013", "2011-2012", "2010-2011", "2009-2010", "2008-2009", "2007-2008", "2006-2007", "2005-2006", "2004-2005", "2003-2004", "2002-2003", "2001-2002", "2000-2001", "1999-2000", "1998-1999", "1997-1998", "1996-1997", "1995-1996", "1994-1995", "1993-1994", "1992-1993", "1991-1992", "1990-1991", "1989-1990", "1988-1989", "1987-1988", "1986-1987", "1985-1986", "1984-1985", "1983-1984", "1982-1983", "1981-1982", "1980-1981"];

export const AREAS_OF_FOCUS = ["Basic Education & Literacy", "Community Economic Development", "Disease Prevention & Treatment", "Environment", "Maternal & Child Health", "Peace Building & Conflict Prevention", "Water, Sanitation & Hygiene"];

export const STATES: Metric[] = [];

export const DISTRICTS: Metric[] = [];

export const CLUBS: ClubMetric[] = [];
