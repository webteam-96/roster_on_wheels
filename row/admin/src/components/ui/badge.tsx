import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge as AstryxBadge } from "@astryxdesign/core/Badge"

// Kept for the variant prop type; the rendering is Astryx's Badge.
const badgeVariants = cva("", {
  variants: { variant: { default: "", secondary: "", destructive: "", outline: "" } },
  defaultVariants: { variant: "default" },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

// default = azure, secondary = marigold, destructive = red, outline = neutral. Page classNames still win
// (Tailwind utilities sit above Astryx in the cascade, see app/layers.css).
const ASTRYX_VARIANT = { default: "blue", secondary: "yellow", destructive: "error", outline: "neutral" } as const

function Badge({ variant, children, ...props }: BadgeProps) {
  return (
    <AstryxBadge
      variant={ASTRYX_VARIANT[variant ?? "default"]}
      label={children}
      {...(props as Omit<React.HTMLAttributes<HTMLSpanElement>, "color">)}
    />
  )
}

export { Badge, badgeVariants }
