"use client";

/**
 * Member map for a club or a district: members who opted in (from the app) shown as a circle about 1 km wide around
 * their rounded point, never an address, and the clubs' meeting places as pins. Leaflet + OpenStreetMap tiles, the
 * same setup as MapPicker. Below the map, the same people listed by city.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { getMemberMap, type MapScope, type MemberMap } from "@/services/api";

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist";

/** Popup content built as DOM text, so names typed by members can never inject markup. */
function popup(lines: (string | null | undefined)[]) {
  const div = document.createElement("div");
  lines.filter(Boolean).forEach((t, i) => {
    const p = document.createElement(i === 0 ? "strong" : "div");
    p.textContent = t!;
    div.appendChild(p);
  });
  return div;
}

const meetingLine = (p: MemberMap["meetingPlaces"][number]) =>
  [p.meetingDay, p.meetingFromTime && (p.meetingToTime ? `${p.meetingFromTime} to ${p.meetingToTime}` : p.meetingFromTime)]
    .filter(Boolean).join(", ");

export default function MemberMapView({ scope, id }: { scope: MapScope; id: number }) {
  const [data, setData] = useState<MemberMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setData(null);
    getMemberMap(scope, id)
      .then(setData)
      .catch((err) => setError(err?.response?.data?.message || "Could not load the map."));
  }, [scope, id]);

  const hasPoints = !!data && (data.members.length > 0 || data.meetingPlaces.length > 0);

  useEffect(() => {
    if (!data || !hasPoints || !box.current) return;
    let map: any = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = `${LEAFLET}/leaflet.css`;
        document.head.appendChild(link);
      }
      // @ts-ignore bundlers break Leaflet's default icon paths
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: `${LEAFLET}/images/marker-icon-2x.png`,
        iconUrl: `${LEAFLET}/images/marker-icon.png`,
        shadowUrl: `${LEAFLET}/images/marker-shadow.png`,
      });
      if (cancelled || !box.current) return;
      const color = `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()})`;
      map = L.map(box.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 16, // no street-level zoom: the points are approximate
      }).addTo(map);
      const bounds: [number, number][] = [];
      for (const m of data.members) {
        L.circle([m.latitude, m.longitude], { radius: 1000, color, weight: 1, fillOpacity: 0.25 })
          .bindPopup(popup([m.name, m.clubName, [m.area, m.city].filter(Boolean).join(", ")]))
          .addTo(map);
        bounds.push([m.latitude, m.longitude]);
      }
      for (const p of data.meetingPlaces) {
        L.marker([p.latitude, p.longitude])
          .bindPopup(popup([p.clubName, "Meeting place", p.meetingAddress, meetingLine(p)]))
          .addTo(map);
        bounds.push([p.latitude, p.longitude]);
      }
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [data, hasPoints]);

  const byCity = useMemo(() => {
    const groups = new Map<string, MemberMap["members"]>();
    for (const m of data?.members ?? []) {
      const key = m.city || "City not given";
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (!data && !error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[420px] w-full" />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data && !hasPoints && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Nothing to show yet. Members appear here once they choose to show their area on the map in the app, and
            clubs appear once their meeting place has a location (club settings).
          </CardContent>
        </Card>
      )}
      {data && hasPoints && (
        <>
          <div ref={box} className="h-[420px] w-full overflow-hidden rounded-md border" aria-label="Map of members and meeting places" />
          <p className="text-sm text-muted-foreground">
            {data.members.length} members on the map, {data.meetingPlaces.length} meeting places. Each circle is about
            1 km wide: members choose to show only their area, never their address.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardContent className="space-y-4 p-6">
                <h3 className="text-lg font-semibold">Members by city</h3>
                {byCity.length === 0 && <p className="text-sm text-muted-foreground">No member has opted in yet.</p>}
                {byCity.map(([city, list]) => (
                  <div key={city}>
                    <p className="font-medium">{city} <span className="text-muted-foreground">({list.length})</span></p>
                    <ul className="text-sm text-muted-foreground">
                      {list.map((m, i) => (
                        <li key={i}>{m.name}{m.area ? `, ${m.area}` : ""}{scope === "district" ? ` (${m.clubName})` : ""}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 p-6">
                <h3 className="text-lg font-semibold">Meeting places</h3>
                {data.meetingPlaces.length === 0 && <p className="text-sm text-muted-foreground">No club has a meeting place on the map yet.</p>}
                {data.meetingPlaces.map((p) => (
                  <div key={p.clubId} className="text-sm">
                    <p className="font-medium">{p.clubName}</p>
                    {p.meetingAddress && <p className="text-muted-foreground">{p.meetingAddress}</p>}
                    {meetingLine(p) && <p className="text-muted-foreground">{meetingLine(p)}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <ErrorAlert open={!!error} title="Could not load the map" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}
