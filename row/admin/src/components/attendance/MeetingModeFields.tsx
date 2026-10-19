"use client";

import { MEETING_MODES, type MeetingMode } from "@/lib/meeting";

/** Meeting mode (in person / online / hybrid) and, for online or hybrid, the join link. */
export default function MeetingModeFields({
  mode,
  link,
  onModeChange,
  onLinkChange,
}: {
  mode: MeetingMode;
  link: string;
  onModeChange: (m: MeetingMode) => void;
  onLinkChange: (l: string) => void;
}) {
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Meeting mode</legend>
        <div className="inline-flex rounded-full border border-slate-200 p-1" role="radiogroup">
          {MEETING_MODES.map((m) => (
            <label
              key={m.value}
              className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium ${
                mode === m.value ? "bg-azure text-cream" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <input
                type="radio"
                name="meetingMode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => onModeChange(m.value)}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {mode !== "in_person" && (
        <div>
          <label htmlFor="meetingLink" className="mb-1.5 block text-sm font-medium text-slate-700">
            Join link
          </label>
          <input
            id="meetingLink"
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => onLinkChange(e.target.value)}
            placeholder="https://zoom.us/j/… or a Google Meet / Teams link"
            maxLength={1000}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}
