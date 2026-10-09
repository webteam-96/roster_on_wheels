import type { Claims } from "./jwt.service";

/**
 * The signed-in principal, the port of ControllerBase.User. Ported code reads
 * claims the way the C# does: user.findFirst("memberId"), user.isInRole("Admin").
 */
export class CurrentUser {
  constructor(readonly claims: Claims | null) {}

  get isAuthenticated(): boolean {
    return this.claims !== null;
  }

  /** User.FindFirst(type)?.Value */
  findFirst(type: string): string | undefined {
    return this.claims?.[type];
  }

  /** int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : null */
  intClaim(type: string): number | null {
    const v = this.findFirst(type);
    if (v === undefined || !/^-?\d+$/.test(v.trim())) return null;
    return parseInt(v, 10);
  }

  /** The member id claim, or 0 as most RIZones controllers default it. */
  get memberId(): number {
    return this.intClaim("memberId") ?? 0;
  }

  /** The "roles" claim split on commas, trimmed. */
  get roles(): string[] {
    return (this.findFirst("roles") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  }

  /** roles.Contains(role), case-sensitive like the C# List<string>.Contains. */
  hasRole(role: string): boolean {
    return this.roles.includes(role);
  }

  /** User.IsInRole: the role claim type is not mapped in RIZones, so this mirrors hasRole on "roles". */
  isInRole(role: string): boolean {
    return this.hasRole(role);
  }
}
