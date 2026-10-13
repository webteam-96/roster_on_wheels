"use client";

import { useBrand } from "@/contexts/BrandContext";
import { cn } from "@/lib/utils";

/**
 * The instance logo, or the product name as text when no logo is configured.
 * `tone="light"` is for dark backgrounds (logoUrl), `"dark"` for light ones (logoDarkUrl).
 */
export default function BrandLogo({ tone = "light", className, textClassName }: { tone?: "light" | "dark"; className?: string; textClassName?: string }) {
  const brand = useBrand();
  const src = tone === "light" ? brand.logoUrl : brand.logoDarkUrl || brand.logoUrl;
  if (!src) {
    return <span className={cn("text-lg font-semibold tracking-tight", textClassName)}>{brand.productName}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={brand.productName} className={cn("object-contain", className)} />;
}
