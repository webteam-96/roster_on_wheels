/**
 * Port of ClubScopeSql.cs: Rotaract clubs show only in Global Search; no district or
 * club screen lists or counts them, SuperAdmin included (the parameter is kept so call
 * sites read as in RIZones).
 */
export const ROTARACT_TYPE = "Rotaract Club";
export const hideRotaract = (_isSuperAdmin: boolean) => true;
/** SQL predicate dropping Rotaract clubs; alias "" = unaliased column. */
export const notRotaract = (alias = "c") => `COALESCE(${alias ? alias + "." : ""}ClubType,'') <> '${ROTARACT_TYPE}'`;
