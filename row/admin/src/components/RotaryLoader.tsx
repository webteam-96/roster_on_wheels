"use client";

import Image from "next/image";

interface RotaryLoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const sizeMap = {
  sm: { width: 20, height: 20, imgClass: "h-5 w-5" },
  md: { width: 32, height: 32, imgClass: "h-8 w-8" },
  lg: { width: 48, height: 48, imgClass: "h-12 w-12" },
};

export default function RotaryLoader({ size = "md", className = "", label }: RotaryLoaderProps) {
  const { width, height, imgClass } = sizeMap[size];

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/images/rotary-logo.png"
        alt="Loading"
        width={width}
        height={height}
        className={`${imgClass} animate-spin`}
        unoptimized
      />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </span>
  );
}
