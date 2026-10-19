import { AlertTriangle, Info } from "@/components/icons";

/**
 * Greetings Settings (club + district) — explains the 1-July pause rule.
 * GreetingsWorker skips every channel (email, push, digest) for a club/district whose custom
 * message was not saved for the current Rotary year, so last year's DG / President names never go out.
 */
export default function GreetingPauseNotice({ paused, reviewedYear, currentYear }: {
  paused: boolean; reviewedYear: string | null; currentYear: string | null;
}) {
  if (paused) {
    return (
      <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Birthday &amp; anniversary greetings are paused{currentYear ? ` for ${currentYear}` : ""}.</p>
          <p>
            These messages were last saved {reviewedYear ? `for ${reviewedYear}` : "in an earlier Rotary year"} and may still carry last year&apos;s
            names. Review the messages below, remove any old names, and click <strong>Save Settings</strong> to resume greetings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-800">
      <Info className="h-4 w-4 shrink-0 mt-0.5" />
      <p>Every 1 July, greetings with a custom message pause until this page is saved again for the new Rotary year.</p>
    </div>
  );
}
