import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Button } from "./button"
import { Badge } from "./badge"

const Lead = () => h("svg", { "data-icon": "lead" })
const Chevron = () => h("svg", { "data-icon": "chevron" })

describe("Button / Badge", () => {
  it("button: one class set per variant and size, icons and text as siblings", () => {
    const html = renderToStaticMarkup(h(Button, { variant: "outline", size: "sm" }, h(Lead), " Tools", h(Chevron)))
    expect(html).toMatch(/^<button class="row-btn row-btn-secondary row-btn-sm"><svg data-icon="lead"><\/svg> Tools<svg data-icon="chevron">/)
  })

  it("asChild keeps the link itself", () => {
    const html = renderToStaticMarkup(h(Button, { asChild: true }, h("a", { href: "blob:https://x/1", download: "qr.png" }, "QR code")))
    expect(html).toMatch(/^<a [^>]*href="blob:https:\/\/x\/1"/)
    expect(html).toContain("row-btn-primary")
  })

  it("badge: icon and text are siblings", () => {
    const html = renderToStaticMarkup(h(Badge, null, h(Lead), " Year rule ON"))
    expect(html).toMatch(/^<span class="row-badge [^"]*"><svg data-icon="lead"><\/svg> Year rule ON<\/span>/)
  })
})
