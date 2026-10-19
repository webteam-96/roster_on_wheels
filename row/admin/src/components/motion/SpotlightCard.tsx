import { cn } from "@/lib/utils";

/**
 * Card surface wrapper. The mouse-tracked radial spotlight, touch sheen and 3D tilt were
 * removed in the Fellowship design port (FRONTEND-RULES: no glow, no hover animation on
 * everything). `color` and `tilt` stay in the signature so existing callers keep compiling.
 */
export function SpotlightCard({
  children,
  className,
  color: _color,
  tilt: _tilt,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  color?: string;
  tilt?: boolean;
  as?: React.ElementType;
} & Record<string, unknown>) {
  return (
    <Tag className={cn("relative", className)} {...rest}>
      {children}
    </Tag>
  );
}
