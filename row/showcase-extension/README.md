# ROW Showcase Publisher (Chrome extension)

Build spec 3.12: publish a club's ROW service projects to Rotary Showcase in one click. It is browser automation (it
fills Showcase's own form in your tab), separate from the Rotary.org data sync, and RI page changes can break it.

## Use

1. Chrome > Extensions > Developer mode > "Load unpacked" > this folder (until it is published).
2. Open the popup, enter your ROW API address (for example `https://api.<your ROW domain>`), and sign in with your
   ROW admin email and password. Chrome asks once for access to that address.
3. Pick the club and the project. Open the Rotary Showcase "add project" page in the same tab, press "Fill the
   Showcase form", check every field, and submit on Showcase yourself.

The ROW token stays in the extension's local storage until "Sign out" (or until it expires). Only ROW is called; the
Showcase page is filled locally. Projects come from `GET /api/clubs/{clubId}/showcase/projects` (the club's and
district's managers) and each project's detail from `GET /api/clubs/{clubId}/projects/{yearId}/{id}`.

## Before publishing to the Chrome Web Store

- **Check the field mapping** in `mapping.js` against the live Showcase form with a Showcase account. The selectors
  are a best guess, because RI does not document the form. Fix them there; nothing else needs to change.
- Add the store listing under the ROW brand: name, icons, screenshots, and privacy text (it stores a ROW sign-in
  token locally and sends nothing to third parties).
- Put the store link in `Brand:Onboarding:ShowcaseExtensionUrl` so the clubs' onboarding kit shows it.

Test: `node --test mapping.test.mjs`.
