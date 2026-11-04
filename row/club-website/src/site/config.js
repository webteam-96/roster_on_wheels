// The RIZones club site's appSettings, as far as ROW's ported theme code needs them.
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '')

export const appSettings = {
  ApiBaseUrl: API,
  MediaBaseUrl: API,
  // Sample event pictures for local previews: not used in ROW (preview content comes from real data).
  PreviewEventImages: '',
  // Footer visitor counter (api/Controllers/ClubWebsiteVisitsController.cs); the component appends ?club=<id>.
  VisitorCountUrl: API + '/api/public/club-website/visits',
  VisitorCountSeed: 0,
}

/** Local-preview-only behaviour in the source; always off in ROW. */
export function isLocalRequest() {
  return false
}
