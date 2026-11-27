import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// The one badge (design.md 8.3): globals.css `.row-badge`.
const badgeVariants = cva("row-badge", {
  variants: {
    variant: {
      default: "bg-blue-100 text-azure",
      secondary: "bg-amber-100 text-amber-900",
      destructive: "bg-red-100 text-red-800",
      outline: "bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
