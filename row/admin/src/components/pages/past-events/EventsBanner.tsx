import { PageBanner } from "@/components/site/PageBanner";
import { EVENTS } from "./data";

export function EventsBanner() {
  // The archive can be empty (an instance with no past events yet).
  const first = EVENTS[EVENTS.length - 1]?.badge.year ?? "";
  const last = EVENTS[0]?.badge.year ?? "";
  return (
    <PageBanner
      eyebrow="Zonal Archive"
      subtitle="Recordings, galleries and highlights from institutes, summits and conclaves across the zones: every milestone, kept."
      rightSlot={
        <div className="text-right">
          <p
            data-counter={EVENTS.length}
            className="figure text-giant leading-none text-gold-deep"
          >
            {EVENTS.length}
          </p>
          <p className="microlabel mt-4">Events in the archive</p>
          <p className="mt-1.5 text-[13px] text-muted">
            <span className="figure">
              {first} – {last}
            </span>
          </p>
        </div>
      }
    >
      Zonal <span className="text-gold">Events</span>
    </PageBanner>
  );
}
