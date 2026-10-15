import type { Values } from "./actions";

// The demo request email, in the site's colours. Email clients only keep inline styles and tables.
const C = { ink: "#1B2C42", soft: "#64748B", azure: "#17458F", gold: "#F7A81B", wash: "#EDF4FB", line: "#E3E9F0" };
const FONT = "font-family:Inter,'Segoe UI',Arial,sans-serif;";

const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function demoEmailHtml(v: Values) {
  const name = esc(v["Full name"]);
  const email = esc(v["Email address"]);
  const phone = esc(v["Phone number, with country code"]);
  const tel = (v["Phone number, with country code"] ?? "").replace(/[^\d+]/g, "");
  const rows = (["Email address", "Phone number, with country code", "Rotary club name", "District number", "Your role", "I am interested in"] as const)
    .filter((f) => v[f])
    .map((f) => `<tr>
      <td style="${FONT}padding:12px 0;border-bottom:1px solid ${C.line};color:${C.soft};font-size:13px;width:38%;vertical-align:top">${f === "Phone number, with country code" ? "Phone" : f}</td>
      <td style="${FONT}padding:12px 0;border-bottom:1px solid ${C.line};color:${C.ink};font-size:15px;font-weight:600">${esc(v[f])}</td>
    </tr>`).join("");
  const message = v.Message ? `
    <p style="${FONT}margin:28px 0 8px;color:${C.soft};font-size:13px">Message</p>
    <div style="${FONT}background:${C.wash};border-left:4px solid ${C.gold};border-radius:8px;padding:16px 18px;color:${C.ink};font-size:15px;line-height:1.6">${esc(v.Message).replace(/\n/g, "<br>")}</div>` : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:${C.wash}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.wash};padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
    <tr><td style="background:${C.azure};padding:22px 32px">
      <span style="${FONT}color:#fff;font-size:18px;font-weight:800;letter-spacing:.5px">ROSTER <span style="color:${C.gold}">ON</span> WHEELS</span>
    </td></tr>
    <tr><td style="padding:32px">
      <span style="${FONT}display:inline-block;background:#FEF3DC;color:#8A5A00;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:6px 12px;border-radius:999px">New demo request</span>
      <h1 style="${FONT}margin:16px 0 6px;color:${C.ink};font-size:26px;line-height:1.25">${name} would like a demo</h1>
      <p style="${FONT}margin:0 0 24px;color:${C.soft};font-size:15px">${esc(v["Rotary club name"])} · District ${esc(v["District number"])}</p>
      <div>
        <a href="mailto:${email}?subject=${encodeURIComponent("Your Roster On Wheels demo")}" style="${FONT}display:inline-block;white-space:nowrap;margin:0 8px 10px 0;background:${C.gold};color:${C.ink};font-size:15px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">Reply by email</a>
        ${tel ? `<a href="tel:${tel}" style="${FONT}display:inline-block;white-space:nowrap;margin:0 0 10px;border:2px solid ${C.azure};color:${C.azure};font-size:15px;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:999px">Call ${phone}</a>` : ""}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${C.line}">${rows}</table>
      ${message}
    </td></tr>
    <tr><td style="${FONT}padding:18px 32px;background:#F7F9FC;color:${C.soft};font-size:12px;line-height:1.5">
      Sent from the Book a free demo form on rosteronwheels.com. Replying to this email goes straight to ${name}.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
