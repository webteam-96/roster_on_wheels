import Image from "next/image";
import { photoUrl, colorFromName, initials } from "@/lib/imageUrl";
import { cn } from "@/lib/cn";

// Renders a member photo, falling back to a coloured initial tile when missing.
// Used by Directors / Directory / Past Presidents / Calendar.
export function Avatar({
  name,
  src,
  size = 96,
  className,
  rounded = "full",
}: {
  name: string;
  src: string | null | undefined;
  size?: number;
  className?: string;
  rounded?: "full" | "lg" | "md" | "none";
}) {
  const url = photoUrl(src);
  const radius =
    rounded === "full" ? "rounded-full" :
    rounded === "lg"   ? "rounded-lg" :
    rounded === "md"   ? "rounded-md" : "";
  if (url) {
    return (
      <Image
        src={url}
        alt={name}
        width={size}
        height={size}
        className={cn(radius, "object-cover", className)}
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  return (
    <div
      className={cn(radius, "flex items-center justify-center text-white font-semibold select-none", className)}
      style={{ width: size, height: size, backgroundColor: colorFromName(name), fontSize: size * 0.32 }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
