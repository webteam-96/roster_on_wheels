export interface AreaOfFocus {
  id: number;
  moduleId: number | null;
  moduleName: string | null;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Category {
  id: number;
  areaOfFocusId: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface SubCategory {
  id: number;
  categoryId: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Funding {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ProjectPhoto {
  id: number;
  projectId: number;
  imagePath: string;
  description: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ProjectListItem {
  id: number;
  clubId: number;
  moduleId: number;
  yearId: number;
  yearLabel: string;
  projectType: string;
  parentProjectId: number | null;
  ongoingGroupTitle: string | null;
  isJointProject: boolean;
  coHostName: string | null;
  clubRole: string | null;
  title: string;
  location: string | null;
  areaOfFocusName: string | null;
  otherAreaOfFocus: string | null;
  categoryName: string | null;
  otherCategory: string | null;
  subCategoryName: string | null;
  otherSubCategory: string | null;
  projectDate: string | null;
  projectCost: number | null;
  currency: string;
  fundingName: string | null;
  directBeneficiaries: number | null;
  meetingType: string | null;
  attendance: number | null;
  attendancePercentage: number | null;
  isActive: boolean;
  approvalStatus: string | null;
  primaryPhotoPath: string | null;
}

export interface ProjectDetail {
  id: number;
  clubId: number;
  moduleId: number;
  yearId: number;
  yearLabel: string;
  projectType: string;
  parentProjectId: number | null;
  ongoingGroupTitle: string | null;
  isJointProject: boolean;
  coHostName: string | null;
  clubRole: string | null;
  title: string;
  description: string | null;
  location: string | null;
  areaOfFocusId: number | null;
  areaOfFocusName: string | null;
  otherAreaOfFocus: string | null;
  categoryId: number | null;
  categoryName: string | null;
  otherCategory: string | null;
  subCategoryId: number | null;
  subCategoryName: string | null;
  otherSubCategory: string | null;
  projectDate: string | null;
  projectCost: number | null;
  currency: string;
  fundingId: number | null;
  fundingName: string | null;
  directBeneficiaries: number | null;
  manHours: number | null;
  rotariansInvolved: number | null;
  rotaractorsInvolved: number | null;
  rccInvolved: number | null;
  sendWhatsapp: boolean;
  sendEmail: boolean;
  meetingType: string | null;
  agendaDocument: string | null;
  minutesDocument: string | null;
  attendance: number | null;
  attendancePercentage: number | null;
  // Funding-conditional (Global Grant / CSR)
  globalGrantNumber: string | null;
  amountSanctioned: number | null;
  amountReceived: number | null;
  amountSpent: number | null;
  hostClubsDistricts: string | null;
  globalPartnerClubsDistricts: string | null;
  csrCompanyName: string | null;
  isActive: boolean;
  photos: ProjectPhoto[];
}

export interface ProjectPhotoInput {
  imagePath: string;
  description: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface CreateProjectRequest {
  moduleId: number;
  projectType: string;
  parentProjectId?: number | null;
  ongoingGroupTitle?: string | null;
  isJointProject: boolean;
  coHostName?: string | null;
  clubRole?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  areaOfFocusId?: number | null;
  otherAreaOfFocus?: string | null;
  categoryId?: number | null;
  otherCategory?: string | null;
  subCategoryId?: number | null;
  otherSubCategory?: string | null;
  projectDate?: string | null;
  projectCost?: number | null;
  currency?: string;
  fundingId?: number | null;
  directBeneficiaries?: number | null;
  manHours?: number | null;
  rotariansInvolved?: number | null;
  rotaractorsInvolved?: number | null;
  rccInvolved?: number | null;
  sendWhatsapp: boolean;
  meetingType?: string | null;
  agendaDocument?: string | null;
  minutesDocument?: string | null;
  attendance?: number | null;
  attendancePercentage?: number | null;
  // Funding-conditional (Global Grant / CSR)
  globalGrantNumber?: string | null;
  amountSanctioned?: number | null;
  amountReceived?: number | null;
  amountSpent?: number | null;
  hostClubsDistricts?: string | null;
  globalPartnerClubsDistricts?: string | null;
  csrCompanyName?: string | null;
  photos?: ProjectPhotoInput[];
}

export interface UpdateProjectRequest {
  projectType: string;
  parentProjectId?: number | null;
  ongoingGroupTitle?: string | null;
  isJointProject: boolean;
  coHostName?: string | null;
  clubRole?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  areaOfFocusId?: number | null;
  otherAreaOfFocus?: string | null;
  categoryId?: number | null;
  otherCategory?: string | null;
  subCategoryId?: number | null;
  otherSubCategory?: string | null;
  projectDate?: string | null;
  projectCost?: number | null;
  currency?: string;
  fundingId?: number | null;
  directBeneficiaries?: number | null;
  manHours?: number | null;
  rotariansInvolved?: number | null;
  rotaractorsInvolved?: number | null;
  rccInvolved?: number | null;
  sendWhatsapp: boolean;
  meetingType?: string | null;
  agendaDocument?: string | null;
  minutesDocument?: string | null;
  attendance?: number | null;
  attendancePercentage?: number | null;
  // Funding-conditional (Global Grant / CSR)
  globalGrantNumber?: string | null;
  amountSanctioned?: number | null;
  amountReceived?: number | null;
  amountSpent?: number | null;
  hostClubsDistricts?: string | null;
  globalPartnerClubsDistricts?: string | null;
  csrCompanyName?: string | null;
  photos?: ProjectPhotoInput[];
}

export interface OngoingProject {
  id: number;
  title: string;
}
