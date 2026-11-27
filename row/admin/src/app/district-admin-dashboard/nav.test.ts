import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DISTRICT_ADMIN_PAGE_TITLES, districtPageTitle } from "./nav";

describe("districtPageTitle", () => {
  it("uses the exact route, else the nearest mapped parent", () => {
    expect(districtPageTitle("/district-admin-dashboard/rcc/clubs/goals")).toBe("RCC Club Goals");
    expect(districtPageTitle("/district-admin-dashboard/grants/42")).toBe("Grants");
    expect(districtPageTitle("/district-admin-dashboard/quick-links/web-links/7/edit")).toBe("Web Links");
    expect(districtPageTitle("/district-admin-dashboard")).toBe("District Dashboard");
  });

  it("every static page under the folder has its own title", () => {
    const dir = __dirname;
    const routes: string[] = [];
    const walk = (d: string, route: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (!n.startsWith("[")) walk(p, `${route}/${n}`); }
        else if (n === "page.tsx") routes.push(route);
      }
    };
    walk(dir, "/district-admin-dashboard");
    expect(routes.filter((r) => !DISTRICT_ADMIN_PAGE_TITLES[r])).toEqual([]);
  });
});
