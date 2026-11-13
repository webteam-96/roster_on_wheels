import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-[12px] px-3.5 py-2 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground border border-[color:var(--color-border-emphasized)] bg-[color:var(--color-background-surface)] text-sm text-[color:var(--color-text-primary)] transition-[border-color] placeholder:text-[color:var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
