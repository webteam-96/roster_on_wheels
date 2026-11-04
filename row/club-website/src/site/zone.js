// The club's time zone label for an event time ("EDT", "BST", "AEDT"). Event times are wall-clock times in the
// club's zone (API v2/about timeZone, spec 3.3); the label makes that explicit for visitors in other zones.
// Same result on the server and in the browser (the zone is explicit), so it is safe in server-rendered markup.
export { zoneLabelAt as zoneLabel } from '@/lib/eventTime'
