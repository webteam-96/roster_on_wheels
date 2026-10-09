import { defineDto } from "../common/dto";

const str = { type: "string" as const, default: () => "" };

/** DTOs/DesignationDtos.cs and DTOs/BoardDirectorDtos.cs. */
export const DesignationDto = defineDto({ Id: "int", DesignationName: str, SortOrder: "int", BodCount: "int" });
export const SaveDesignationDto = defineDto({ DesignationName: str, SortOrder: "int" });
export const ReorderDesignationsDto = defineDto({ Id1: "int", Id2: "int" });

export const BoardDirectorDto = defineDto({
  Id: "int", ClubId: "int", MemberId: "int?", IsMember: "bool", MemberName: str, ProfilePhotoPath: "string", NonMemberName: "string",
  NonMemberMobile: "string", NonMemberEmail: "string", DesignationId: "int", DesignationName: str, CustomDesignation: "string",
  YearId: "int", YearLabel: str,
});
export const BoardYearDto = defineDto({ Id: "int", YearLabel: str, StartDate: str, EndDate: str, IsCurrent: "bool" });

/** CreateBoardDirectorDto / UpdateBoardDirectorDto. */
export const SaveBoardDirectorDto = defineDto({
  MemberId: "int?", NonMemberName: "string", NonMemberMobile: "string", NonMemberEmail: "string", DesignationId: "int",
  CustomDesignation: "string", YearId: "int",
});
export type SaveBoardDirector = {
  memberId: number | null; nonMemberName: string | null; nonMemberMobile: string | null; nonMemberEmail: string | null;
  designationId: number; customDesignation: string | null; yearId: number;
};

export const ClubMemberSearchDto = defineDto({ Id: "int", MemberName: str, ProfilePhotoPath: "string" });
