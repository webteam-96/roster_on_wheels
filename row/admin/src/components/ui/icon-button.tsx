import * as React from "react"

import { cn } from "@/lib/utils"

/** Icon-only action in a table row, a card head or a bar. Give it an aria-label. Defaults to type="button" so it never
 * submits a surrounding form by accident. */
const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => <button ref={ref} type={type} className={cn("row-icon-btn", className)} {...props} />
)
IconButton.displayName = "IconButton"

export { IconButton }
