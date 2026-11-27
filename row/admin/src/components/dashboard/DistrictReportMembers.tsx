import { getDistrictAdminRotaryNetwork, getPotentialMembers } from "@/services/api";
import { Users, UserCircle } from "@/components/icons";
import { NetworkDownloadRow, SubsectionHeader, appUserTally, ClubFilterRow } from "./DistrictReportRows";
import { AgFilterRow, BodMultiFilterRow } from "./DistrictReportFilterRows";
import { DistrictReportState } from "./useDistrictReport";

export default function DistrictReportMembers({ r }: { r: DistrictReportState }) {
  const { hideClubFilter, showBloodGroup, effectiveDistrictId, showAgRows, report, setErrorMessage, districtNumber, exportWithFilename, membersCols, clubsDropdown, agsDropdown } = r;
  return (
    <>
      <SubsectionHeader title="Members" />

      {/* Rotary Network — Terminated Members (club dropdown: All + each club). */}
      <NetworkDownloadRow
        title="Terminated Members"
        icon={Users}
        clubs={clubsDropdown}
        defaultFile="Terminated_Members"
        fetchFn={async (clubId) => {
          try {
            const data = await getDistrictAdminRotaryNetwork(undefined, effectiveDistrictId, undefined, clubId);
            return (data.terminatedMembers || []).map((m: any) => ({
              districtNumber,
              clubName: m.clubName,
              memberId: m.memberId,
              name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(" ").trim(),
              memberType: m.memberType,
              admissionDate: m.admissionDate ? new Date(m.admissionDate).toLocaleDateString("en-GB") : "",
              terminationDate: m.terminationDate ? new Date(m.terminationDate).toLocaleDateString("en-GB") : "",
              terminationReason: m.terminationReason || "",
              mobile: m.mobile || "",
              email: m.email || "",
            }));
          } catch { setErrorMessage("Failed to load Terminated Members."); return []; }
        }}
        columns={[
          { key: "srNo", label: "Sr. No.", width: 8, index: true },
          { key: "districtNumber", label: "District Number", width: 14 },
          { key: "clubName", label: "Club Name", width: 30 },
          { key: "memberId", label: "Member ID", width: 14 },
          { key: "name", label: "Name", width: 28 },
          { key: "memberType", label: "Member Type", width: 16 },
          { key: "admissionDate", label: "Admission Date", width: 16 },
          { key: "terminationDate", label: "Termination Date", width: 16 },
          { key: "terminationReason", label: "Termination Reason", width: 30 },
          { key: "mobile", label: "Mobile", width: 16 },
          { key: "email", label: "Email", width: 28 },
        ]}
        onExport={exportWithFilename}
      />

      {/* Rotary Network — Prospective Members / All Clubs (club dropdown: All + each
          club). These are the per-club "potential/prospective" new-member entries; the
          old "Prospective Members (All Clubs)" coming-soon placeholder was the same data
          and has been removed in favour of this working report. */}
      <NetworkDownloadRow
        title="Prospective Members"
        icon={Users}
        clubs={clubsDropdown}
        defaultFile="Prospective_Members"
        fetchFn={async (clubId) => {
          try {
            // Potential members live per-club in the DB — the district-network endpoint doesn't
            // populate them. Fetch per club (one club, or every club of the district for "All").
            const targets = clubId ? clubsDropdown.filter((c) => c.clubId === clubId) : clubsDropdown;
            const perClub = await Promise.all(targets.map(async (c) => {
              const res = await getPotentialMembers(c.clubId, 1, 5000);
              return (res.items || []).map((m) => ({
                districtNumber,
                clubName: c.clubName,
                name: m.name,
                email: m.email || "",
                mobile: m.mobileNumber || "",
                referenceDetails: m.referenceDetails || "",
              }));
            }));
            return perClub.flat();
          } catch { setErrorMessage("Failed to load Potential Members."); return []; }
        }}
        columns={[
          { key: "srNo", label: "Sr. No.", width: 8, index: true },
          { key: "districtNumber", label: "District Number", width: 14 },
          { key: "clubName", label: "Club Name", width: 30 },
          { key: "name", label: "Name", width: 28 },
          { key: "email", label: "Email", width: 28 },
          { key: "mobile", label: "Mobile", width: 16 },
          { key: "referenceDetails", label: "Reference Details", width: 40 },
        ]}
        onExport={exportWithFilename}
      />

      {/* 1. Board of Directors — designation + club dropdowns */}
      <BodMultiFilterRow
        title="Board of Directors (BOD)"
        icon={UserCircle}
        rows={report.bod || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Board_of_Directors"
        baseColumns={[
          { key: "srNo", label: "Sr. No.", width: 8, index: true },
          { key: "clubName", label: "Club", width: 25 },
          { key: "designation", label: "Designation", width: 25 },
          { key: "memberName", label: "Member Name", width: 25 },
          { key: "email", label: "Email ID", width: 30 },
          { key: "mobile", label: "Mobile Number", width: 16 },
          { key: "autoManual", label: "Auto/Manual", width: 12 },
        ]}
        onDownload={exportWithFilename}
      />

      {/* 2. Members — club dropdown */}
      <ClubFilterRow
        title="Members"
        icon={Users}
        rows={report.members || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Members"
        baseColumns={membersCols}
        onDownload={exportWithFilename}
      />

      {/* 2b. Blood Group — emergency call-list: every member AND their family
          members as rows, each with their own blood group + contact. Member row
          first, then their family beneath. Filter by Blood Group in Excel to find
          donors fast. District report shows Club Name (no district number). */}
      {showBloodGroup && (
      <ClubFilterRow
        title="Blood Group"
        icon={Users}
        rows={report.bloodGroups || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="Blood_Group"
        baseColumns={[
          { key: "srNo", label: "Sr. No.", width: 8, index: true },
          { key: "clubName", label: "Club Name", width: 25 },
          { key: "personName", label: "Member Name", width: 25 },
          { key: "relation", label: "Relation", width: 16 },
          { key: "mobile", label: "Mobile Number", width: 16 },
          { key: "email", label: "Email Id", width: 30 },
          { key: "bloodGroup", label: "Blood Group", width: 12 }, { key: "tshirtSize", label: "T-Shirt Size", width: 12 },
        ]}
        onDownload={exportWithFilename}
      />
      )}

      {/* 3. Members (AG wise) — hidden on the AG report (redundant) and when
          AG-wise reports are suppressed (hideAgReports). */}
      {showAgRows && (
      <AgFilterRow
        title="Members (AG wise)"
        icon={Users}
        rows={report.members || []}
        ags={agsDropdown}
        defaultFile="Members_AG_wise"
        baseColumns={membersCols}
        onDownload={exportWithFilename}
      />
      )}

      {/* 4. Members (Active users in Rotary Zones App) — club dropdown */}
      <ClubFilterRow
        title="Members (Active users in ROW App)"
        icon={Users}
        rows={report.appUsers || []}
        clubs={clubsDropdown}
        hideClub={hideClubFilter}
        defaultFile="App_Active_Users"
        baseColumns={[
          { key: "srNo", label: "Sr. No.", width: 8, index: true },
          { key: "clubName", label: "Club Name", width: 25 },
          { key: "memberName", label: "Member Name", width: 25 },
          { key: "mobile", label: "Mobile Number", width: 16 },
          { key: "email", label: "Email Id", width: 30 },
          { key: "downloaded", label: "Downloaded", width: 12 },
          { key: "platform", label: "Device Name", width: 14 },
        ]}
        summaryText={(list) => {
          const { notDownloaded, android, ios } = appUserTally(list);
          return `Not Downloaded: ${notDownloaded}  |  Android: ${android}  |  iOS: ${ios}`;
        }}
        onDownload={exportWithFilename}
      />
    </>
  );
}
