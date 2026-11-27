/** The menu item a page belongs to: the longest link the path starts with ("/settings/currency" before "/settings"). */
export function navMatch(links: string[], path: string): string | undefined {
  return links
    .filter((to) => path === to || path.startsWith(to + "/"))
    .sort((a, b) => b.length - a.length)[0];
}
