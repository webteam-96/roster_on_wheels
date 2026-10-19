import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Official ROW masterbrand lockup (905×295 PNG).
 * tone="brand"   -> colour version, navy wordmark + gold wheel (light surfaces)
 * tone="inverse" -> all-white version (dark surfaces: mobile sheet, dark bands)
 * Sized for the 76px chrome bar.
 */
export function Logo({
  tone = "brand",
  className,
}: {
  tone?: "brand" | "inverse";
  className?: string;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark focus-visible:ring-offset-2",
        className
      )}
      aria-label="ROW: Home"
    >
      <Image
        src={tone === "brand" ? "/brand/row-logo.png" : "/brand/row-logo-inverse.png"}
        alt="ROW"
        width={905}
        height={295}
        priority
        className="h-11 w-auto"
      />
    </Link>
  );
}
