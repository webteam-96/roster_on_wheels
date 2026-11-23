import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Button } from "./button"
import { Badge } from "./badge"

const Lead = () => h("svg", { "data-icon": "lead" })
const Chevron = () => h("svg", { "data-icon": "chevron" })

// Icons inside the label text wrapped onto their own line; they must go to Astryx's own icon slots.
describe("Button / Badge icon slots", () => {
  it("button: leading icon, then the text, then the chevron, as siblings outside the text span", () => {
    const html = renderToStaticMarkup(h(Button, { variant: "outline" }, h(Lead), " Tools", h(Chevron)))
    expect(html).toMatch(/<svg data-icon="lead"><\/svg><\/span><span[^>]*> Tools<\/span><span[^>]*><svg data-icon="chevron">/)
    expect(html).not.toContain("rounded-full")
  })

  it("a download / blob: link stays a plain anchor (no router prefetch of the blob URL)", () => {
    const html = renderToStaticMarkup(h(Button, { asChild: true }, h("a", { href: "blob:https://x/1", download: "qr.png" }, "QR code")))
    expect(html).toMatch(/^<a [^>]*href="blob:https:\/\/x\/1"[^>]*download="qr.png"/)
    expect(html).not.toContain("astryx-button")
  })

  it("button with only text is unchanged", () => {
    expect(renderToStaticMarkup(h(Button, null, "Save"))).toContain(">Save<")
  })

  it("badge: the icon sits before the text span, not inside it", () => {
    const html = renderToStaticMarkup(h(Badge, null, h(Lead), " Year rule ON"))
    expect(html).toMatch(/<svg data-icon="lead"><\/svg><span[^>]*> Year rule ON<\/span>/)
  })
})
