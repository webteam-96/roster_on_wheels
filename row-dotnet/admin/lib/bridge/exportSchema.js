// shared/exportSchema.js
//
// The ROW "project export" contract (v1.0). This is the single boundary
// between the ROW backend (producer, Phase 2) and the mapping engine
// (consumer, Phase 1). Keep it stable and versioned; change the version if the
// shape changes so both sides can negotiate.

export const EXPORT_SCHEMA_VERSION = '1.0';

/**
 * @typedef {Object} ProjectExport
 * @property {string} schemaVersion
 * @property {Object} meta
 * @property {string} meta.projectId
 * @property {string} [meta.clubId]
 * @property {string} [meta.clubName]
 * @property {string} [meta.district]
 * @property {string} meta.avenue          // e.g. "Community Service"
 * @property {string} [meta.yearId]
 * @property {string} [meta.status]
 * @property {string} title                // <=50
 * @property {string} description          // <=1000
 * @property {string} [projectType]        // "One Time Project" | "Ongoing/Repeat"
 * @property {string} [dateOfProject]      // YYYY-MM-DD
 * @property {string} [locationText]
 * @property {Object} [classification]
 * @property {string} [classification.areaOfFocus]
 * @property {string} [classification.category]
 * @property {string} [classification.subCategory]
 * @property {number[]} [classification.pathIds]
 * @property {number} projectCostINR
 * @property {string} [funding]                // resolved funding name, e.g. "Global Grant"
 * @property {OrgExportFinancial} [financial]  // Grant/CSR detail (optional; back-compat)
 * @property {number} directBeneficiaries
 * @property {number} manHours
 * @property {number} rotariansInvolved
 * @property {number} rotaractorsInvolved
 * @property {Array<{url:string,isPrimary:boolean,caption:string}>} photos
 */

/**
 * Financial & Impact funding detail. Amounts are in ₹ (the consumer converts to
 * US$ at the live rate, like projectCostINR). All fields optional so legacy
 * producers that omit `financial` stay valid.
 * @typedef {Object} OrgExportFinancial
 * @property {('global_grant'|'csr'|'district_grant'|'self'|'other'|'')} [fundingClass]
 * @property {string} [globalGrantNumber]
 * @property {number} [amountSanctionedINR]
 * @property {number} [amountReceivedINR]
 * @property {number} [amountSpentINR]
 * @property {string} [hostClubsDistricts]
 * @property {string} [globalPartnerClubsDistricts]
 * @property {string} [csrCompanyName]
 */

/**
 * Validate a project export against the contract.
 * @param {ProjectExport} ex
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateExport(ex) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
  const isNum = (v) => Number.isFinite(v);

  req(ex && typeof ex === 'object', 'export must be an object');
  if (!ex || typeof ex !== 'object') return { ok: false, errors };

  req(ex.schemaVersion === EXPORT_SCHEMA_VERSION,
    `schemaVersion must be "${EXPORT_SCHEMA_VERSION}"`);
  req(ex.meta && isStr(ex.meta.projectId), 'meta.projectId is required');
  req(ex.meta && isStr(ex.meta.avenue), 'meta.avenue is required');
  req(isStr(ex.title), 'title is required');
  req(!ex.title || ex.title.length <= 50, 'title exceeds 50 chars');
  req(isStr(ex.description), 'description is required');
  req(!ex.description || ex.description.length <= 1000, 'description exceeds 1000 chars');

  for (const f of ['projectCostINR', 'directBeneficiaries', 'manHours', 'rotariansInvolved', 'rotaractorsInvolved']) {
    req(isNum(ex[f]), `${f} must be a number`);
  }

  req(Array.isArray(ex.photos), 'photos must be an array');
  if (Array.isArray(ex.photos)) {
    ex.photos.forEach((p, i) => req(p && isStr(p.url), `photos[${i}].url is required`));
  }

  // `financial` is optional; validate types only when present (never required).
  if (ex.financial != null) {
    req(typeof ex.financial === 'object', 'financial must be an object');
    if (typeof ex.financial === 'object') {
      const FC = ['global_grant', 'csr', 'district_grant', 'self', 'other', ''];
      if (ex.financial.fundingClass != null) {
        req(FC.includes(ex.financial.fundingClass), 'financial.fundingClass must be a known funding class');
      }
      for (const f of ['amountSanctionedINR', 'amountReceivedINR', 'amountSpentINR']) {
        if (ex.financial[f] != null) req(isNum(ex.financial[f]), `financial.${f} must be a number`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
