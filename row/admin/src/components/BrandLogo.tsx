"use client";

import { useBrand } from "@/contexts/BrandContext";
import { cn } from "@/lib/utils";

/**
 * The instance logo, or the product name as text when no logo is configured.
 * `tone="dark"` (default) is the transparent logo for light surfaces (logoDarkUrl); `"light"` is the plated
 * logo for dark backgrounds (logoUrl). Prefer light surfaces: the plate reads as a sticker.
 */
export default function BrandLogo({ tone = "dark", className, textClassName }: { tone?: "light" | "dark"; className?: string; textClassName?: string }) {
  const brand = useBrand();
  const src = tone === "light" ? brand.logoUrl : brand.logoDarkUrl || brand.logoUrl;
  if (!src) {
    return <span className={cn("text-lg font-semibold tracking-tight", textClassName)}>{brand.productName}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={brand.productName} className={cn("object-contain", className)} />;
}
