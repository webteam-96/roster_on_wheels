"use client";
import { Suspense } from "react";
import "react-quill-new/dist/quill.snow.css";
import { Button } from "@/components/ui/button";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, ArrowRight, Check, Save } from "@/components/icons";
import { formatDraftTime } from "@/lib/duesDraft";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { useClubDuesForm, deriveClubDuesForm } from "./useClubDuesForm";
import BasicStep from "./BasicStep";
import PaymentStep from "./PaymentStep";
import ClubsStep from "./ClubsStep";
import ImagesEmailStep from "./ImagesEmailStep";
import { STEP_LABELS } from "./clubDuesShared";

function CreateClubDuesInner() {
  const h = useClubDuesForm();
  const { isSuperAdmin, ready, currentStep, success, router, error, setError, editId, totalSteps, draftSavedAt, handleBack, submit, loading, handleNext } = h;

  if (!isSuperAdmin) {
    return <ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3><p className="text-muted-foreground">Only SuperAdmin can manage district dues.</p></div></ProtectedRoute>;
  }
  if (!ready) return <ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>;
  const d = deriveClubDuesForm(h);
  const v = { ...h, ...d };
  const { isLastStep } = d;
  const renderBasic = () => <BasicStep v={v} />;
  const renderPayment = () => <PaymentStep v={v} />;
  const renderClubs = () => <ClubsStep v={v} />;
  const renderImagesEmail = () => <ImagesEmailStep v={v} />;
  const stepContent = [renderBasic, renderPayment, renderClubs, renderImagesEmail][currentStep];

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!success} title="Saved" description={success || ""} onOk={() => router.push("/settings/club-dues")} />
        <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />

        {/* Header */}
        <PageHeader
          title={editId ? "Edit District Dues" : "Create District Dues"}
          back="/settings/club-dues"
          actions={
            <>
<p className="text-muted-foreground text-base">Step {currentStep + 1} of {totalSteps}</p>
{!editId && draftSavedAt && (
              <p className="text-xs text-amber-700 mt-0.5">
                Draft kept in this browser · {formatDraftTime(draftSavedAt)} · images must be picked again if you continue later
              </p>
            )}
            </>
          }
        />

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < STEP_LABELS.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {stepContent()}

        {/* Navigation */}
        <div className="flex justify-between pb-8">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          {isLastStep ? (
            <Button onClick={submit} disabled={loading}>
              {loading ? <RotaryLoader size="sm" /> : <Save className="h-4 w-4 mr-2" />}
              {loading ? (editId ? "Updating..." : "Creating...") : (editId ? "Update District Dues" : "Create District Dues")}
            </Button>
          ) : (
            <Button onClick={handleNext}>Next<ArrowRight className="h-4 w-4 ml-2" /></Button>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}

export default function CreateClubDuesPage() {
  return <Suspense fallback={null}><CreateClubDuesInner /></Suspense>;
}
