import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// The one set of buttons (design.md 8.3): shape, height and colours live in globals.css `.row-btn`.
const buttonVariants = cva("row-btn", {
  variants: {
    variant: {
      default: "row-btn-primary",
      destructive: "row-btn-danger",
      outline: "row-btn-secondary",
      secondary: "row-btn-secondary",
      ghost: "row-btn-ghost",
      link: "row-btn-link",
      // On a navy banner or header: white outline.
      onDark: "row-btn-on-dark",
    },
    size: {
      default: "",
      sm: "row-btn-sm",
      lg: "",
      icon: "row-btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
})

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
