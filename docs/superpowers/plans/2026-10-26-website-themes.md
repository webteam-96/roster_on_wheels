# Club and district website themes (plan, 2026-10-26)

Status: draft for the owner's approval. Nothing is built yet.

## What the owner asked for

The owner designs themes for club and district websites. A club or district that buys a plan picks one theme from the
themes its plan includes. After picking, it fills the site with its own content and shapes it: show or hide any
component, change their order, and add custom sections of its own.

## What exists today

- `row/club-website` already has a theme registry (`src/themes/index.ts`): 8 code themes (classic-blue, modern-minimal,
  bold-color, editorial, compact-card, banner, rotaract, row). Each theme supplies its own Layout and Home; the other
  pages are shared and restyled through CSS variables. `<html data-theme>` switches the theme, and an `x-preview-theme`
  header already lets a page preview another theme.
- The API sends the theme as `ThemeKey`. `ClubWebsitePublicController.ToThemeKey` maps it from the club's chosen row in
  `theme_master` (name, image, description). `theme_master` is empty in the local copy.
- Content already comes from "Website Data" in the admin: about, banners, logos, menu list, contact details, social
  links, advertisements, languages, theme. Projects, board, events, newsletters and the rest come from the club's
  normal modules automatically.
- Editions exist (`edition_catalogue`: club_basic, club, district, rotaract, zone) with `edition_modules` per edition.
  There is no link from editions to themes yet.
- `row/district-website` has no theme registry: it is one fixed design.
- What is missing: sections are fixed by each theme's Home (no show / hide / reorder), there are no custom sections,
  and themes are not gated by plan.

## Proposed design

1. **Theme catalogue.** Each theme is code (a folder under `src/themes/<key>/`, built from the owner's designs) plus a
   row in `theme_master` with a stable `theme_key`, preview images, the site kind (club, district or both) and status
   (draft or live). Code without a live row is invisible, so a theme can be built and tested before it is sold.
2. **Plans decide the themes.** A new table `edition_themes (edition_code, theme_key)` says which plan includes which
   theme. Settings > Editions gets a Themes column. A tenant sees every live theme; the ones its plan does not include
   show as previews with an "Upgrade" note. Buying the upgrade waits for Stripe (Wave 2); until then a SuperAdmin
   changes the plan.
3. **One page layout per site, stored as data.** A new table `website_layouts` (site kind, owner id, page key,
   `sections` JSON, draft or published, version, who and when). The JSON is an ordered list of sections, each
   `{ id, type, visible, settings }`. Built-in types are the components the themes already draw (banner carousel,
   about, president message, projects by avenue, board, events, newsletters, advertisements, contact, map and so on).
   Custom types come from a fixed list (see question 2). Each theme ships a default layout. A site with no saved
   layout uses the theme's default, so existing sites keep working untouched.
4. **The theme draws the sections.** The route layer reads the layout and renders each visible section with the
   theme's component for that type. Custom section types get one shared component per type, styled by the theme's
   CSS variables, so every theme supports them without extra work. A theme can mark a type it cannot show; the editor
   then greys it out.
5. **Editor in the admin.** Website Data > Layout: the list of sections with drag to reorder, an eye toggle to show or
   hide, Edit for a section's settings and content, Add section for a custom one, a live preview in an iframe (the
   existing `x-preview-theme` path plus a draft flag), and Publish. Publishing keeps the old version, so "undo
   publish" is one click.
6. **Changing theme keeps the content.** Content and custom sections belong to the site, not to the theme. On a theme
   change the built-in sections fall back to the new theme's default order unless the owner has reordered them; a
   built-in type the new theme lacks is hidden, not deleted.
7. **District websites.** The district site gets the same registry and layout (step 6 below), so one editor serves
   both.
8. **Safety (security checklist).** Rich text goes through the existing HTML sanitiser. Images go through the existing
   upload checks: type, size, and storage under the tenant. Embeds are allow-listed: YouTube, Vimeo and Google Maps
   only, never raw HTML or scripts. Every layout write checks that the caller manages that club or district. Layout
   JSON is validated server-side against the section schema, with size caps (for example 60 sections, 200 KB). The
   audit log records every publish.

## Build order (each step shippable, behind the feature switch `website_themes`, off until ready)

| Step | Work | Size |
|---|---|---|
| 1 | `theme_master.theme_key`, status, site kind; `edition_themes`; Settings > Editions themes column; the theme picker shows locked themes as previews | S |
| 2 | `website_layouts` table + API (get draft / published, save draft, publish, history), schema validation, ownership checks, e2e | M |
| 3 | Club site renders from the layout (built-in sections only); each existing theme gets a default layout; no visible change for sites without a layout | M |
| 4 | Admin editor: reorder, show / hide, edit built-in section settings, preview, publish | M |
| 5 | Custom sections: the agreed types, shared components, editor forms, sanitising and embed allow-list | M |
| 6 | District site: theme registry + layout rendering, reusing steps 3-5 | M |
| 7 | The owner's new themes, one by one, from their designs; run `jury` on each before and after | per theme |
| 8 | Purchase of a theme upgrade (needs Stripe, Wave 2) | later |

## Questions for the owner

1. **Your designs.** What will you hand over for each theme (Figma, images, an HTML mock-up)? Does every theme use
   the same set of components, or can a theme have components of its own?
2. **Custom sections.** Which types do you want? Proposal: text block, image with text, image gallery, video (YouTube
   or Vimeo), call-to-action button, FAQ, people cards, stats / numbers, map. Raw HTML stays out (security).
3. **Pages.** Only the home page is customisable, or every page? And may a site add its own new pages (for example
   "Our history"), with a menu entry?
4. **Switching.** May a site change its theme at any time within its plan? Is there a limit?
5. **Who edits.** Club admins for club sites and district admins for district sites only, or other roles too?
