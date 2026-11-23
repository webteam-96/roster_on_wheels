import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { Button as AstryxButton } from "@astryxdesign/core/Button"

import { cn } from "@/lib/utils"

// Legacy Tailwind styles: still used for the `link` variant, for asChild on non-link children, and by
// alert-dialog's buttonVariants() calls.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-go-md text-sm font-semibold transition-[background-color,transform,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border-2 border-foreground/80 bg-transparent text-foreground hover:bg-foreground/[0.07]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        gold:
          "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-2",
        sm: "h-9 px-4 text-xs",
        lg: "h-[52px] px-7 text-base",
        icon: "h-11 w-11 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

// Our variants on Astryx's four. secondary/gold (marigold) and link have no Astryx match: they keep the legacy look.
const ASTRYX_VARIANT = {
  default: "primary",
  destructive: "destructive",
  outline: "secondary",
  ghost: "ghost",
} as const
const ASTRYX_SIZE = { default: "md", sm: "sm", lg: "lg", icon: "md" } as const
// ROW proportions on top of Astryx: 44px default, semibold (2026-11-12); 10px corners, not a pill (user, 2026-11-23).
const ROW_SIZE = {
  default: "h-11 px-6 text-sm",
  sm: "h-9 px-4 text-xs",
  lg: "h-[52px] px-7 text-base",
  icon: "h-11 w-11",
} as const

/** Visible text of a node tree, for Astryx's required accessible label. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

/** A leading icon becomes Astryx's icon slot and a trailing one (dropdown chevron) its endContent; inside the
 *  content they wrapped onto a second line ("Tools" / "Export" menus). The rest stays the visible content. */
function splitIcon(children: React.ReactNode): { icon?: React.ReactNode; rest: React.ReactNode; end?: React.ReactNode } {
  let parts = React.Children.toArray(children)
  // `{busy ? <Loader /> : <><Icon />Save</>}` hands us one Fragment: look inside it, or the icon
  // renders as a block above the text (ROW-63).
  const only = parts[0]
  if (parts.length === 1 && React.isValidElement<{ children?: React.ReactNode }>(only) && only.type === React.Fragment) {
    parts = React.Children.toArray(only.props.children)
  }
  const isIcon = (n: React.ReactNode) => React.isValidElement(n) && textOf(n).trim() === ""
  if (parts.length < 2) return { rest: children }
  const icon = isIcon(parts[0]) ? parts[0] : undefined
  const body = icon ? parts.slice(1) : parts
  const end = body.length > 1 && isIcon(body[body.length - 1]) ? body[body.length - 1] : undefined
  if (!icon && !end) return { rest: children }
  return { icon, end, rest: end ? body.slice(0, -1) : body }
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, disabled, type, title, ...props }, ref) => {
    const v = variant ?? "default"
    const s = size ?? "default"
    const astryxVariant = ASTRYX_VARIANT[v as keyof typeof ASTRYX_VARIANT]

    // asChild around a link: an Astryx link button. Any other asChild child keeps the legacy Slot rendering.
    // A download or blob:/data: link stays a plain <a> (legacy Slot below): as an Astryx link the router prefetched
    // the blob URL as a page (404 on the donation QR "download" button).
    const linkChild =
      asChild && React.isValidElement<{ href?: unknown; download?: unknown; children?: React.ReactNode }>(children) &&
      typeof children.props.href === "string" && children.props.download === undefined &&
      !/^(blob|data):/i.test(children.props.href)
        ? children
        : null

    if (!astryxVariant || (asChild && !linkChild)) {
      const Comp = asChild ? Slot : "button"
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          disabled={disabled}
          type={type}
          title={title}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    // HTML default: a button without a type submits its form; Astryx defaults to "button", so restore it.
    const nativeType = type ?? "submit"
    // Astryx disables with aria-disabled only, which still lets a click submit the form. Keep the native attribute.
    const nativeDisabled = { disabled } as Record<string, unknown>
    const content = linkChild ? linkChild.props.children : children
    const label =
      textOf(content).trim() || (props["aria-label"] as string | undefined) || title || "Button"
    // Phosphor icons default to 24px app-wide; inside buttons they stay at the old 16px.
    const cls = cn("rounded-go-md whitespace-nowrap font-semibold [&_svg]:size-4 [&_svg]:shrink-0", ROW_SIZE[s as keyof typeof ROW_SIZE], className)

    if (s === "icon") {
      return (
        <AstryxButton
          ref={ref}
          label={label}
          variant={astryxVariant}
          size="md"
          isIconOnly
          icon={content}
          isDisabled={disabled}
          {...nativeDisabled}
          type={nativeType}
          tooltip={title}
          // Without this every icon-only `asChild` <Link> (the back arrows) rendered a dead button (ROW-61).
          href={linkChild ? (linkChild.props.href as string) : undefined}
          className={cls}
          {...props}
        />
      )
    }

    const { icon, rest, end } = splitIcon(content)
    return (
      <AstryxButton
        ref={ref}
        label={label}
        variant={astryxVariant}
        size={ASTRYX_SIZE[s as keyof typeof ASTRYX_SIZE] ?? "md"}
        icon={icon}
        endContent={end}
        isDisabled={disabled}
          {...nativeDisabled}
        type={nativeType}
        tooltip={title}
        href={linkChild ? (linkChild.props.href as string) : undefined}
        className={cls}
        {...props}
      >
        {rest}
      </AstryxButton>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
