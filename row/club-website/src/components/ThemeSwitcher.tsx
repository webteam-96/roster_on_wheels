"use client";

// Review-only theme picker (THEME_SWITCHER=1): reloads the current page with ?preview-theme=<key>, which the
// middleware turns into a session cookie, so the choice sticks while the reviewer clicks around. The club's own
// theme setting is never changed. Plain inline styles so every theme renders it the same.
// Keys come from the server layout: the theme registry reads request headers, so it cannot load in the browser.
export default function ThemeSwitcher({ active, keys }: { active: string; keys: readonly string[] }) {
  function pick(key: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("preview-theme", key);
    window.location.assign(url.toString());
  }

  return (
    <label
      style={{
        position: "fixed",
        left: 12,
        bottom: 12,
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px 6px 12px",
        background: "#1B2C42",
        color: "#F7F9FC",
        borderRadius: 999,
        font: "600 13px/1.2 system-ui, sans-serif",
      }}
    >
      Theme
      <select
        value={active}
        onChange={(e) => pick(e.target.value)}
        aria-label="Preview theme"
        // Explicit colours: some themes restyle every <select> (dark backgrounds, transparent fills).
        style={{
          font: "inherit",
          fontWeight: 500,
          padding: "6px 8px",
          borderRadius: 999,
          border: 0,
          color: "#1B2C42",
          background: "#F7F9FC",
          opacity: 1,
          colorScheme: "light",
        }}
      >
        {keys.map((k) => (
          <option key={k} value={k}>
            {k.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>
    </label>
  );
}
