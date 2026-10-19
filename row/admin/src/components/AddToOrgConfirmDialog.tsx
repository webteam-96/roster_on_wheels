"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Send, AlertTriangle } from "@/components/icons";

/**
 * Post-save "Add To Rotary Org" prompt.
 *
 * Shown ONLY when the extension is detected, AFTER the project has already been
 * saved. "Add To Rotary Org" hands the saved project to the extension (which
 * opens the Service Project Center and fills it); "Cancel" leaves for the club's
 * Service Projects dashboard.
 *
 * IMPORTANT: the caller's onConfirm must close this dialog synchronously before
 * triggering the extension — an open Radix dialog puts `pointer-events:none` on
 * the body, which would freeze the extension's own in-page UI.
 */
export default function AddToOrgConfirmDialog({
  open, onCancel, onConfirm,
}: { open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add this project to Rotary International?</DialogTitle>
          <DialogDescription>
            Your project has been saved. You can also copy it into Rotary
            International&apos;s Service Project Center (spc.rotary.org) in one step.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          The RI Flow-Bot extension opens the Service Project Center in a new tab and
          fills the wizard from this project. You review the highlighted notes and
          publish. It only creates a new project. It never edits or deletes existing
          Rotary.org projects.
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            If this project has already been added to rotary.org, do not proceed , 
            this will create a duplicate project on the Rotary.org portal.
          </span>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={onConfirm}
            className="bg-amber-400 font-semibold text-blue-950 hover:bg-amber-500"
          >
            <Send className="mr-1.5 h-4 w-4" /> Add To Rotary Org
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
