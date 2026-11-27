import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MenuItemButton } from "@/components/ui/text-buttons";
import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Plus, Pencil, Trash2, FolderOpen, Loader2, ChevronDown } from "@/components/icons";
import LoadingLink from "@/components/v2/LoadingLink";
import { PROJECT_LABELS, formatDate, SectionCard } from "./monthlyReportWizardShared";
import type { MonthlyReportWizardCtx } from "./useMonthlyReportWizard";

export default function StepProjects({ v }: { v: MonthlyReportWizardCtx }) {
  const { currentStep, addProjectType, setAddProjectType, getAddProjectUrl, setError, projects, collapsedSections, toggleSection, getEditProjectUrl, handleDeleteProject, deletingId } = v;
  return (
    <>
      {currentStep === 2 && (
        <SectionCard
          icon={FolderOpen}
          title="Projects"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={addProjectType}
                onChange={(e) => setAddProjectType(e.target.value)}
                className="row-field-sm w-auto"
              >
                <option value="">Select service type…</option>
                {Object.entries(PROJECT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </NativeSelect>
              <LoadingLink
                href={addProjectType ? getAddProjectUrl(addProjectType) : "#"}
                onClick={(e) => {
                  if (!addProjectType) {
                    e.preventDefault();
                    setError("Please select a service type first");
                  }
                }}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg ${
                  addProjectType
                    ? "bg-azure text-white hover:bg-navy-900"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Plus size={12} /> Add Project
              </LoadingLink>
            </div>
          }
        >
          {Object.keys(PROJECT_LABELS).every((key) => !projects[key] || projects[key].length === 0) ? (
            <div className="text-center py-12">
              <FolderOpen size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No projects for this month</p>
              <p className="text-xs text-slate-500 mt-1">Select a service type and click &quot;Add Project&quot; to create one</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(PROJECT_LABELS).map(([serviceType, label]) => {
                const items = projects[serviceType] || [];
                if (items.length === 0) return null;
                const isCollapsed = collapsedSections[serviceType];
                const isCommunity = serviceType === "community_service";
                return (
                  <div key={serviceType} className="border border-slate-200 rounded-xl overflow-hidden">
                    <MenuItemButton
                      type="button"
                      className="justify-between rounded-none px-4 py-2.5"
                      onClick={() => toggleSection(serviceType)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{label}</span>
                        <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {items.length}
                        </span>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-slate-400 transition-transform ${isCollapsed ? "" : "rotate-180"}`}
                      />
                    </MenuItemButton>
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <Table className="min-w-[640px] md:min-w-full">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-left w-12">#</TableHead>
                              <TableHead className="text-left">Date</TableHead>
                              <TableHead className="text-left">Title</TableHead>
                              {isCommunity ? (
                                <>
                                  <TableHead className="text-left">Area of Focus</TableHead>
                                </>
                              ) : (
                                <>
                                  <TableHead className="text-left">Category</TableHead>
                                </>
                              )}
                              <TableHead className="text-right w-24">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((project, idx) => (
                              <TableRow key={project.projectId}>
                                <TableCell className="text-slate-500 tabular-nums">{idx + 1}</TableCell>
                                <TableCell className="text-slate-700 whitespace-nowrap">{formatDate(project.projectDate)}</TableCell>
                                <TableCell className="font-medium text-slate-800">
                                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    {project.title}
                                    {(serviceType === "community_service" || serviceType === "public_image_initiative") && (
                                      <>
                                        {project.projectType && (
                                          <span
                                            className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                                              project.projectType === "one_time"
                                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                                : "bg-slate-50 text-slate-700 border-slate-200"
                                            }`}
                                          >
                                            {project.projectType === "one_time" ? "One Time" : "Ongoing"}
                                          </span>
                                        )}
                                        {project.parentProjectId && (
                                          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
                                            Child Project
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </span>
                                </TableCell>
                                {isCommunity ? (
                                  <>
                                    <TableCell className="text-slate-700">{project.areaOfFocusName || "-"}</TableCell>
                                  </>
                                ) : (
                                  <>
                                    <TableCell className="text-slate-700">{project.areaOfFocusName || "-"}</TableCell>
                                  </>
                                )}
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    <LoadingLink
                                      href={getEditProjectUrl(serviceType, project.projectId)}
                                      className="row-icon-btn"
                                      aria-label="Edit"
                                    >
                                      <Pencil size={12} />
                                    </LoadingLink>
                                    <IconButton
                                      type="button"
                                      onClick={() => handleDeleteProject(project.projectId, serviceType)}
                                      disabled={deletingId === project.projectId}
                                      className="text-rose-600"
                                      aria-label="Delete"
                                    >
                                      {deletingId === project.projectId
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
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}
