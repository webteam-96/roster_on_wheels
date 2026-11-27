import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { IconButton } from "@/components/ui/icon-button";
import { Plus, Pencil, Trash2, Calendar, Loader2 } from "@/components/icons";
import LoadingLink from "@/components/v2/LoadingLink";
import { MEETING_TYPE_LABELS, MEETING_TYPE_COLORS, formatDate, SectionCard } from "./monthlyReportWizardShared";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function StepMeetings({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, addMeetingHref, reportDetail, meetings, editMeetingHref, handleDeleteMeeting, deletingId } = v;
  return (
    <>
      {currentStep === 0 && (
        <SectionCard
          icon={Calendar}
          title="Meetings"
          action={
            <LoadingLink
              href={addMeetingHref}
              className="row-btn row-btn-primary row-btn-sm"
            >
              <Plus size={12} /> Add Meeting
            </LoadingLink>
          }
        >
          <div className="mb-3 text-xs text-slate-600">
            <span className="font-medium">Assistant Governor: </span>
            <span className="font-semibold text-slate-800">{reportDetail?.assistantGovernor || "N/A"}</span>
          </div>

          {meetings.length === 0 ? (
            <div className="text-center py-12">
              <Calendar size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No meetings for this month</p>
              <p className="text-xs text-slate-500 mt-1">Click &quot;Add Meeting&quot; to create one</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px] md:min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left w-12">#</TableHead>
                    <TableHead className="text-left">Date</TableHead>
                    <TableHead className="text-left">Title</TableHead>
                    <TableHead className="text-left">Type</TableHead>
                    <TableHead className="text-right">Attendance</TableHead>
                    <TableHead className="text-right">Attendance %</TableHead>
                    <TableHead className="text-right w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meetings.map((meeting, idx) => (
                    <TableRow key={meeting.projectId}>
                      <TableCell className="text-slate-500 tabular-nums">{idx + 1}</TableCell>
                      <TableCell className="text-slate-700 whitespace-nowrap">{formatDate(meeting.projectDate)}</TableCell>
                      <TableCell className="font-medium text-slate-800">{meeting.title}</TableCell>
                      <TableCell>
                        {meeting.meetingType ? (
                          <span
                            className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${
                              MEETING_TYPE_COLORS[meeting.meetingType] || "bg-slate-50 text-slate-700 border-slate-200"
                            }`}
                          >
                            {MEETING_TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
                          </span>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{meeting.attendance ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {meeting.attendancePercentage != null ? `${meeting.attendancePercentage}%` : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <LoadingLink
                            href={editMeetingHref(meeting.projectId)}
                            className="row-icon-btn"
                            aria-label="Edit"
                          >
                            <Pencil size={12} />
                          </LoadingLink>
                          <IconButton
                            type="button"
                            onClick={() => handleDeleteMeeting(meeting.projectId)}
                            disabled={deletingId === meeting.projectId}
                            className="text-rose-600"
                            aria-label="Delete"
                          >
                            {deletingId === meeting.projectId
                              ? <Loader2 className="animate-spin" size={12} />
                              : <Trash2 size={12} />}
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}
