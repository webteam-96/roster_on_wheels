import { apiClient as api } from "./api";

// Clear (soft delete) a district goal for one rotary year. 404 = nothing to clear.
export async function clearDistrictMembershipGoal(districtId: number, yearId: number): Promise<void> {
  await api.delete("/api/district-admin-dashboard/membership-goal", { params: { districtId, yearId } });
}

export async function clearDistrictFoundationGoal(districtId: number, yearId: number): Promise<void> {
  await api.delete("/api/district-admin-dashboard/foundation-goal", { params: { districtId, yearId } });
}
