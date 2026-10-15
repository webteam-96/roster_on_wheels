"use client";

import { useEffect } from "react";
import { initPage } from "@/lib/row-fx";

// Builds this page's reveals and scenes on mount and reverts them on unmount.
export default function PageFx() {
  useEffect(() => initPage(), []);
  return null;
}
