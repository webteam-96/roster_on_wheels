"use client";

/** Page-load "I Agree" disclaimer (ported from the v1 listing page), shared by the v2 project Add pages. */

import { Info } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import AgreeText from "@/components/AgreeText";

type Props = {
  open: boolean;
  text: string;
  onCancel: () => void;
  onAgree: () => void;
};

export default function AgreeDialog({ open, text, onCancel, onAgree }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Info className="text-blue-600" size={20} />
            I Agree
          </DialogTitle>
        </DialogHeader>
        <div className="whitespace-pre-line text-sm text-slate-700">
          <AgreeText text={text} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onAgree}>I Agree & Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
