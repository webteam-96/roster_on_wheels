"use client";

import * as LucideIcons from "@/components/icons";
import { LucideProps } from "@/components/icons";
import { getPhotoUrl } from "@/services/api";

interface ModuleIconProps extends Omit<LucideProps, "name"> {
  name: string | null;
  iconPath?: string | null;
}

export default function ModuleIcon({ name, iconPath, ...props }: ModuleIconProps) {
  if (iconPath) {
    const size = props.size || 24;
    return (
      <img
        src={getPhotoUrl(iconPath)}
        alt="Module icon"
        width={typeof size === "number" ? size : 24}
        height={typeof size === "number" ? size : 24}
        className={props.className}
        style={{ objectFit: "contain" }}
      />
    );
  }
  if (!name) return <LucideIcons.Box {...props} />;
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<LucideProps>>)[name];
  if (!Icon) return <LucideIcons.Box {...props} />;
  return <Icon {...props} />;
}
