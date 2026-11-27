"use client";
import { Suspense } from "react";
import "react-quill-new/dist/quill.snow.css";
import { Button } from "@/components/ui/button";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, ArrowRight, Save, Loader2, Check } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { formatDraftTime } from "@/lib/duesDraft";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { useMembershipDuesForm } from "./useMembershipDuesForm";
import { deriveMembershipDuesForm } from "./membershipDuesDerived";
import BasicInfoPaymentStep from "./BasicInfoPaymentStep";
import FeeTypesAmountsStep from "./FeeTypesAmountsStep";
import VendorSplitsStep from "./VendorSplitsStep";
import MemberListStep from "./MemberListStep";
import ImagesEmailStep from "./ImagesEmailStep";
import { SPLIT_STEP } from "./membershipDuesShared";

export default function CreateEditMembershipDuesPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <CreateEditMembershipDuesPage />
    </Suspense>
  );
}

function CreateEditMembershipDuesPage() {
  const h = useMembershipDuesForm();
  const { isSuperAdmin, isAdmin, isEdit, loading, isAdminEdit, currentStep, successMessage, setSuccessMessage, errorMessage, setErrorMessage, selectedClubId, totalSteps, draftSavedAt, activeStepLabels, skipsVendorStep, handleBack, handleSubmit, saving, handleNext } = h;

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  // Admin can only edit, not create new
  if (isAdmin && !isSuperAdmin && !isEdit) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3><p className="text-muted-foreground">Only SuperAdmin can create new Club Dues.</p></div></ProtectedRoute>);
  }

  if (loading) {
    return (<ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>);
  }
  const d = deriveMembershipDuesForm(h);
  const v = { ...h, ...d };
  const { isLastStep } = d;
  const renderStep1BasicInfoPayment = () => <BasicInfoPaymentStep v={v} />;
  const renderStep2FeeTypesAmounts = () => <FeeTypesAmountsStep v={v} />;
  const renderStep3VendorSplits = () => <VendorSplitsStep v={v} />;
  const renderStep4MemberList = () => <MemberListStep v={v} />;
  const renderStep5ImagesEmail = () => <ImagesEmailStep v={v} />;

  const renderCurrentStep = () => {
    if (isAdminEdit) {
      // Admin edit: Step 0 = Basic Info (read-only except title/description), Step 1 = Images & Email
      switch (currentStep) {
        case 0: return renderStep1BasicInfoPayment();
        case 1: return renderStep5ImagesEmail();
        default: return null;
      }
    }
    switch (currentStep) {
      case 0: return renderStep1BasicInfoPayment();
      case 1: return renderStep2FeeTypesAmounts();
      case 2: return renderStep3VendorSplits();
      case 3: return renderStep4MemberList();
      case 4: return renderStep5ImagesEmail();
      default: return null;
    }
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        {/* Header */}
        <PageHeader
          title={isEdit ? "Edit Club Dues" : "Create Club Dues"}
          back={isAdminEdit && selectedClubId ? `/clubs/${selectedClubId}/membership-dues` : "/settings/membership-dues"}
          actions={
            <>
<p className="text-muted-foreground text-base">Step {currentStep + 1} of {totalSteps}</p>
{!isEdit && draftSavedAt && (
              <p className="text-xs text-amber-700 mt-0.5">
                Draft kept in this browser · {formatDraftTime(draftSavedAt)} · images must be picked again if you continue later
              </p>
            )}
            </>
          }
        />

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {activeStepLabels.map((s, i) => (skipsVendorStep && i === SPLIT_STEP) ? null : (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : (skipsVendorStep && i > SPLIT_STEP ? i : i + 1)}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < activeStepLabels.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {renderCurrentStep()}

        {/* Navigation Buttons */}
        <div className="flex justify-between pb-8">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          <div className="flex flex-wrap gap-2">
            {isLastStep ? (
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Club Dues" : "Create Club Dues")}
              </Button>
            ) : (
              <Button onClick={handleNext} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {saving ? "Saving..." : "Next"}
                {!saving && <ArrowRight className="h-4 w-4 ml-2" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
