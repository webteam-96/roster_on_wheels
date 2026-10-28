// ROW Showcase Publisher (build spec 3.12): sign in to ROW, pick a club project, fill the Rotary Showcase form in the
// current tab. The ROW token is kept in chrome.storage.local until "Sign out"; nothing is sent anywhere but ROW.
import { SHOWCASE_FIELDS, showcaseValues } from "./mapping.js";

const $ = (id) => document.getElementById(id);
const say = (t) => { $("status").textContent = t; };
const store = {
  get: () => chrome.storage.local.get(["api", "token", "clubs"]),
  set: (v) => chrome.storage.local.set(v),
  clear: () => chrome.storage.local.remove(["token", "clubs"]),
};

async function rowFetch(path, opts = {}) {
  const { api, token } = await store.get();
  const r = await fetch(api.replace(/\/+$/, "") + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers },
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { await store.clear(); await show(); }
  if (!r.ok) throw new Error(body.message || `ROW answered ${r.status}.`);
  return body;
}

async function show() {
  const { token, clubs, api } = await store.get();
  $("signin").hidden = !!token;
  $("work").hidden = !token;
  if (api) $("api").value = api;
  if (!token) return;
  $("club").replaceChildren(...(clubs || []).map((c) => new Option(c.name, c.id)));
  await loadProjects();
}

async function loadProjects() {
  const clubId = $("club").value;
  if (!clubId) { say("Your ROW account manages no club."); return; }
  say("Loading projects...");
  try {
    const projects = await rowFetch(`/api/clubs/${clubId}/showcase/projects`);
    $("project").replaceChildren(...projects.map((p) =>
      new Option(`${p.title} (${p.yearLabel})`, JSON.stringify({ id: p.id, yearId: p.yearId }))));
    say(projects.length ? "" : "No service projects this Rotary year.");
  } catch (e) { say(e.message); }
}

$("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const api = $("api").value.trim();
  // the ROW address is the user's: Chrome asks once for access to it
  const origin = new URL(api).origin + "/*";
  if (!(await chrome.permissions.request({ origins: [origin] }))) { say("Allow access to your ROW address to sign in."); return; }
  await store.set({ api });
  say("Signing in...");
  try {
    const r = await rowFetch("/api/auth/login", {
      method: "POST", body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
    });
    const clubs = (r.accessibleClubs || []).map((c) => ({ id: c.id, name: c.name }));
    await store.set({ token: r.token, clubs });
    $("password").value = "";
    say("");
    await show();
  } catch (err) { say(err.message); }
});

$("club").addEventListener("change", loadProjects);
$("signout").addEventListener("click", async () => { await store.clear(); say("Signed out."); await show(); });

$("fill").addEventListener("click", async () => {
  try {
    const { id, yearId } = JSON.parse($("project").value || "{}");
    if (!id) { say("Pick a project."); return; }
    const detail = await rowFetch(`/api/clubs/${$("club").value}/projects/${yearId}/${id}`);
    const values = showcaseValues(detail);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillForm, args: [SHOWCASE_FIELDS, values] });
    say(result.filled.length
      ? `Filled: ${result.filled.join(", ")}.${result.missing.length ? ` Not found on this page: ${result.missing.join(", ")}.` : ""} Check them, then submit on Showcase.`
      : "This page has no Showcase project form. Open Showcase's add project page first.");
  } catch (err) { say(err.message); }
});

// Runs inside the Showcase page: sets each field through its native setter so the page's own scripts see the change.
function fillForm(fields, values) {
  const filled = [], missing = [];
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const el = fields[key].map((s) => document.querySelector(s)).find(Boolean);
    if (!el) { missing.push(key); continue; }
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === value.toLowerCase());
      if (!opt) { missing.push(key); continue; }
      el.value = opt.value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled.push(key);
  }
  return { filled, missing };
}

show();
