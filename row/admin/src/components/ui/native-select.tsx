import * as React from "react"

import { cn } from "@/lib/utils"

/** The browser's own select in the field look, for short lists and forms. */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn("row-field w-full", className)} {...props} />
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
