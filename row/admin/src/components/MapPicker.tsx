"use client";

import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, LocateFixed, Search, Loader2 } from "@/components/icons";

// Leaflet CSS + JS are loaded dynamically to avoid SSR issues in Next.js.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLat?: number | null;
  initialLng?: number | null;
  onConfirm: (lat: number, lng: number) => void;
};

const DEFAULT_CENTER: [number, number] = [20, 0]; // whole world: ROW clubs are on every continent
const DEFAULT_ZOOM = 2;
const PICKED_ZOOM = 15;

export default function MapPicker({ open, onOpenChange, initialLat, initialLng, onConfirm }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [pickedLat, setPickedLat] = useState<number | null>(initialLat ?? null);
  const [pickedLng, setPickedLng] = useState<number | null>(initialLng ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Sync picked state when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      setPickedLat(initialLat ?? null);
      setPickedLng(initialLng ?? null);
      setSearchQuery("");
      setSearchError(null);
    }
  }, [open, initialLat, initialLng]);

  // Initialize the Leaflet map when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const init = async () => {
      // Dynamic import prevents Leaflet from running during SSR.
      const L = (await import("leaflet")).default;
      // Inject Leaflet CSS once (avoids TS CSS-module issues and Next.js global-CSS restriction).
      if (typeof document !== "undefined" && !document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      // Fix default icon paths (Leaflet references ./images/marker-icon.png which is broken in bundlers)
      // @ts-ignore
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (cancelled || !containerRef.current) return;

      // Dispose any existing map
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }

      const startCenter: [number, number] =
        initialLat != null && initialLng != null ? [initialLat, initialLng] : DEFAULT_CENTER;
      const startZoom = initialLat != null && initialLng != null ? PICKED_ZOOM : DEFAULT_ZOOM;

      const map = L.map(containerRef.current).setView(startCenter, startZoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Drop initial marker if coords supplied
      if (initialLat != null && initialLng != null) {
        const m = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);
        m.on("dragend", () => {
          const pos = m.getLatLng();
          setPickedLat(pos.lat);
          setPickedLng(pos.lng);
        });
        markerRef.current = m;
      }

      // Click anywhere to set/move pin
      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        setPickedLat(lat);
        setPickedLng(lng);
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          const m = L.marker([lat, lng], { draggable: true }).addTo(map);
          m.on("dragend", () => {
            const pos = m.getLatLng();
            setPickedLat(pos.lat);
            setPickedLng(pos.lng);
          });
          markerRef.current = m;
        }
      });

      mapRef.current = map;

      // Small delay to let dialog finish animation, then fix sizing
      setTimeout(() => map.invalidateSize(), 250);
    };

    init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, [open]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setSearchError("Browser does not support geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setPickedLat(lat);
        setPickedLng(lng);
        if (mapRef.current) {
          mapRef.current.setView([lat, lng], PICKED_ZOOM);
          if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
          else {
            (async () => {
              const L = (await import("leaflet")).default;
              const m = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
              m.on("dragend", () => {
                const p = m.getLatLng();
                setPickedLat(p.lat);
                setPickedLng(p.lng);
              });
              markerRef.current = m;
            })();
          }
        }
      },
      (err) => setSearchError(`Location denied: ${err.message}`),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const searchAddress = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      // OpenStreetMap Nominatim (free, public, ~1 req/sec rate limit — fine for manual admin use)
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) {
        setSearchError("No location found for that search.");
        return;
      }
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      setPickedLat(lat);
      setPickedLng(lng);
      if (mapRef.current) {
        const L = (await import("leaflet")).default;
        mapRef.current.setView([lat, lng], PICKED_ZOOM);
        if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
        else {
          const m = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
          m.on("dragend", () => {
            const p = m.getLatLng();
            setPickedLat(p.lat);
            setPickedLng(p.lng);
          });
          markerRef.current = m;
        }
      }
    } catch (err: any) {
      setSearchError("Search failed. Try again.");
    } finally {
      setSearchLoading(false);
    }
  };

  const confirm = () => {
    if (pickedLat == null || pickedLng == null) return;
    onConfirm(pickedLat, pickedLng);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" />Pick Club Location</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Search city / address (e.g., 'Paris' or '1 Main Street, Toronto')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchAddress(); } }}
              />
              <Button variant="outline" onClick={searchAddress} disabled={searchLoading || !searchQuery.trim()}>
                {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <Button variant="outline" onClick={useMyLocation} title="Use my current location (browser GPS)">
              <LocateFixed className="mr-2 h-4 w-4" />My Location
            </Button>
          </div>
          {searchError && <p className="text-xs text-red-500">{searchError}</p>}
          <p className="text-xs text-muted-foreground">Click anywhere on the map to set the pin, or drag the existing pin.</p>
        </div>

        <div ref={containerRef} className="w-full h-[60vh] rounded border" />

        <div className="text-sm flex items-center gap-4">
          <span>Latitude: <span className="font-mono">{pickedLat != null ? pickedLat.toFixed(7) : "–"}</span></span>
          <span>Longitude: <span className="font-mono">{pickedLng != null ? pickedLng.toFixed(7) : "–"}</span></span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={confirm} disabled={pickedLat == null || pickedLng == null}>Use This Location</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
