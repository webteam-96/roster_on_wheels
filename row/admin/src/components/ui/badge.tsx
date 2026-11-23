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
  // A leading icon component (<Badge><ShieldCheck /> Text</Badge>) goes to Astryx's icon slot; inside the label it
  // stacked above the text. Plain elements like <span> stay in the label.
  const parts = React.Children.toArray(children)
  const lead = parts[0]
  const hasIcon = parts.length > 1 && React.isValidElement(lead) && typeof lead.type !== "string"
  return (
    <AstryxBadge
      variant={ASTRYX_VARIANT[variant ?? "default"]}
      icon={hasIcon ? lead : undefined}
      label={hasIcon ? parts.slice(1) : children}
      {...(props as Omit<React.HTMLAttributes<HTMLSpanElement>, "color">)}
    />
  )
}

export { Badge, badgeVariants }
