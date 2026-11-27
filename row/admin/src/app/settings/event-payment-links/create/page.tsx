"use client";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import { ArrowLeft, ArrowRight, Save, Check } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { usePaymentLinkForm, derivePaymentLinkForm } from "./usePaymentLinkForm";
import BasicInfoStep from "./BasicInfoStep";
import FormFieldsStep from "./FormFieldsStep";
import RegistrationsStep from "./RegistrationsStep";
import VendorSplitsStep from "./VendorSplitsStep";
import EmailStep from "./EmailStep";
import { SPLITS_ON, SPLIT_STEP, STEP_LABELS } from "./paymentLinkShared";

export default function CreateEditPaymentLinkPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>}>
      <CreateEditPaymentLinkPage />
    </Suspense>
  );
}

function CreateEditPaymentLinkPage() {
  const h = usePaymentLinkForm();
  const { isSuperAdmin, isAdmin, loading, currentStep, successMessage, setSuccessMessage, errorMessage, setErrorMessage, isEdit, totalSteps, handleBack, handleSubmit, saving, handleNext } = h;

  if (!isSuperAdmin && !isAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="row-h2">Access Denied</h3></div></ProtectedRoute>);
  }

  if (loading) {
    return (<ProtectedRoute><div className="flex justify-center py-20"><ListPageSkeleton /></div></ProtectedRoute>);
  }
  const d = derivePaymentLinkForm(h);
  const v = { ...h, ...d };
  const { isLastStep } = d;
  const renderStepBasicInfo = () => <BasicInfoStep v={v} />;
  const renderStepFormFields = () => <FormFieldsStep v={v} />;
  const renderStepRegistrations = () => <RegistrationsStep v={v} />;
  const renderStepVendorSplits = () => <VendorSplitsStep v={v} />;
  const renderStepEmail = () => <EmailStep v={v} />;

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0: return renderStepBasicInfo();
      case 1: return renderStepFormFields();
      case 2: return renderStepRegistrations();
      case 3: return renderStepVendorSplits();
      case 4: return renderStepEmail();
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
          title={isEdit ? "Edit Payment Link" : "Create Payment Link"}
          back="/settings/event-payment-links"
          actions={
            <>
<p className="text-muted-foreground text-base">Step {!SPLITS_ON && currentStep > SPLIT_STEP ? currentStep : currentStep + 1} of {SPLITS_ON ? totalSteps : totalSteps - 1}</p>
            </>
          }
        />

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className={`flex flex-wrap items-center gap-2 ${!SPLITS_ON && i === SPLIT_STEP ? "hidden" : ""}`}>
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                i < currentStep ? "bg-green-600 text-white" :
                i === currentStep ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < currentStep ? <Check className="h-4 w-4" /> : !SPLITS_ON && i > SPLIT_STEP ? i : i + 1}
              </div>
              <span className={`text-sm hidden md:inline ${i === currentStep ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < STEP_LABELS.length - 1 && <div className="w-8 h-[2px] bg-muted" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        {renderCurrentStep()}

        {/* Navigation Buttons */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
          <div className="flex flex-wrap gap-2">
            {isLastStep ? (
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? <RotaryLoader size="sm" className="mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? (isEdit ? "Updating..." : "Creating...") : (isEdit ? "Update Link" : "Create Link")}
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Next<ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
