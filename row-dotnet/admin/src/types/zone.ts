export interface ZoneListItem {
  id: number;
  zoneName: string;
  isActive: boolean;
  createdDate: string | null;
  totalDistricts: number;
  totalClubs: number;
  totalMembers: number;
  coordinatorName?: string | null;
  coordinatorEmail?: string | null;
  isZonalAwardsEnabled?: boolean;
}

export interface Zone {
  id: number;
  zoneName: string;
  isActive: boolean;
  createdBy: number | null;
  createdDate: string | null;
  modifiedBy: number | null;
  modifiedDate: string | null;
  totalDistricts: number;
  totalClubs: number;
  totalMembers: number;
}

export interface CreateZoneRequest {
  zoneName: string;
  isActive: boolean;
}

export interface UpdateZoneRequest {
  zoneName: string;
  isActive: boolean;
}
