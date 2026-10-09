import { cn } from "@/lib/utils";

/**
 * Rotary "Mark of Excellence" gear wheel — 24 cogs, 6 spokes, keyed hub.
 * Rendered in `currentColor`, so set the color via text-* classes
 * (gold on the header, white on the footer). This is a faithful SVG
 * approximation; swap for the official brand asset when available.
 */
export function RotaryWheel({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  const ring =
    "M50 8 L52.99 1.09 L59.77 1.98 L60.87 9.43 L65.55 3.53 L71.86 6.15 L71 13.63 L77.04 9.14 L82.47 13.3 L79.7 20.3 L86.7 17.53 L90.86 22.96 L86.37 29 L93.85 28.14 L96.47 34.45 L90.57 39.13 L98.02 40.23 L98.91 47.01 L92 50 L98.91 52.99 L98.02 59.77 L90.57 60.87 L96.47 65.55 L93.85 71.86 L86.37 71 L90.86 77.04 L86.7 82.47 L79.7 79.7 L82.47 86.7 L77.04 90.86 L71 86.37 L71.86 93.85 L65.55 96.47 L60.87 90.57 L59.77 98.02 L52.99 98.91 L50 92 L47.01 98.91 L40.23 98.02 L39.13 90.57 L34.45 96.47 L28.14 93.85 L29 86.37 L22.96 90.86 L17.53 86.7 L20.3 79.7 L13.3 82.47 L9.14 77.04 L13.63 71 L6.15 71.86 L3.53 65.55 L9.43 60.87 L1.98 59.77 L1.09 52.99 L8 50 L1.09 47.01 L1.98 40.23 L9.43 39.13 L3.53 34.45 L6.15 28.14 L13.63 29 L9.14 22.96 L13.3 17.53 L20.3 20.3 L17.53 13.3 L22.96 9.14 L29 13.63 L28.14 6.15 L34.45 3.53 L39.13 9.43 L40.23 1.98 L47.01 1.09 L50 8 Z M84 50 A34 34 0 1 1 16 50 A34 34 0 1 1 84 50 Z";
  const spokes =
    "M47.65 35.18 L46.95 15.13 L53.05 15.13 L52.35 35.18 Z M61.66 40.56 L78.67 29.92 L81.72 35.21 L64 44.62 Z M64 55.38 L81.72 64.79 L78.67 70.08 L61.66 59.44 Z M52.35 64.82 L53.05 84.87 L46.95 84.87 L47.65 64.82 Z M38.34 59.44 L21.33 70.08 L18.28 64.79 L36 55.38 Z M36 44.62 L18.28 35.21 L21.33 29.92 L38.34 40.56 Z";
  const hub =
    "M66 50 A16 16 0 1 1 34 50 A16 16 0 1 1 66 50 Z M56.5 50 A6.5 6.5 0 1 1 43.5 50 A6.5 6.5 0 1 1 56.5 50 Z M48.3 44 L51.7 44 L51.7 37 L48.3 37 Z";
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("h-10 w-10", className)}
      role="img"
      aria-label="Rotary wheel"
      fill="currentColor"
      {...rest}
    >
      <path d={ring} fillRule="evenodd" />
      <path d={spokes} />
      <path d={hub} fillRule="evenodd" />
    </svg>
  );
}
