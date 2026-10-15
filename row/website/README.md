# Roster On Wheels website

The ROW marketing site: nine pages plus the Privacy, Terms and Refund policies, copy taken word for word from
`ROW Website Content V2 Updated.docx`, in the approved "Fellowship" design (concept 03).

Built with Next.js 16 (App Router, static pages), GSAP and Lenis. Hosted on IIS in front of Node.js 22
(see Deploy below).

## Run it

```
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (all pages are static)
npm start
```

Node.js 22 is required.

## Deploy (IIS)

```
npm run package:iis
```

builds the site and writes a clean, ready-to-run copy to `../ROW-website-iis`: `server.js`, the built pages, only the
packages they need, `web.config` and the setup guide. The server needs only Node.js 22. The full IIS steps are in
[`deploy/README.md`](deploy/README.md), which is copied into that folder.

## Contact form email

The Contact Us form posts each demo request to a Google Apps Script web app (`apps-script/Code.gs`), which emails
it to support@rosteronwheels.com from the Google account it is deployed under. Copy `.env.example` to `.env.local`
(or set the same names on the server) and fill in `MAIL_SCRIPT_URL` and `MAIL_SECRET`. Without them the form shows
its "did not go through" message.

## Where things are

| Path | What it is |
| --- | --- |
| `app/page.tsx` | Home |
| `app/<page>/page.tsx` | The eight inner pages: about-us, club-management, district-management, mobile-app, pricing, how-to-get-started, faq, contact-us |
| `app/privacy-policy`, `terms-of-service`, `refund-policy` | The policy pages (shared frame: `components/Legal.tsx`) |
| `app/contact-us/actions.ts`, `email.ts` | The demo form's sender and its HTML email |
| `apps-script/Code.gs` | The Google Apps Script that emails the form (deployed under support@rosteronwheels.com) |
| `deploy/` | IIS files: `web.config`, `start.cmd`, the setup guide and the packaging script |
| `app/layout.tsx` | Fonts, loader, header, footer |
| `app/globals.css` | Design tokens and all shared styles |
| `components/kit.tsx` | Shared page sections (hero, section, cards, steps, FAQ, stats) |
| `components/art.tsx` | Small drawing pieces and icons for the text-free pictures |
| `components/SiteHeader.tsx` | Header, full-screen menu, smooth scrolling |
| `lib/row-fx.js` | Page animations (reveals, roster wheel, sync, district hub, pictures that build in view) |
| `lib/site.ts` | Page list, contact details, policy links, the demo and Login links |

Every "Book a free demo" button links to the Contact Us page's demo form.
