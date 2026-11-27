"use client";

/**
 * The one-time service-project form (v2 add and edit) shared by Vocational, International and New
 * Generation Service. Module differences come from the config; add/edit differences from `mode`.
 */

import FieldLabel from "@/components/form/FieldLabel";
import SectionCard from "@/components/form/SectionCard";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import DateField from "@/components/DateField";
import { Info, MapPin, Target, IndianRupee, Users } from "@/components/icons";
import ClassificationAssist from "@/components/projects/ClassificationAssist";
import { currencyOptions, getCurrencySymbol } from "@/lib/currency";
import { currencySymbol } from "@/lib/appFormat";
import V2FormShell from "@/components/v2/V2FormShell";
import ErrorAlert from "@/components/ErrorAlert";
import ProtectedRoute from "@/components/ProtectedRoute";
import ClubAdminShell from "@/components/v2/ClubAdminShell";
import RecipientBadge from "@/components/RecipientBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ImageCropDialog from "@/components/ImageCropDialog";
import { ListPageSkeleton } from "@/components/row/AppKit";
import AgreeDialog from "./AgreeDialog";
import type { ServiceFormConfig } from "./config";
import { onlyDigits, type ServiceProjectFields } from "./useServiceProjectFields";
import ServicePhotosSection from "./ServicePhotosSection";

// Project photos are shown 16:9 on the public site (components/pages/projects/shared.tsx),
// so the crop is locked to that shape. 1600×900 keeps the widest card retina-sharp.
const PROJECT_PHOTO_ASPECT = 16 / 9;
const PROJECT_PHOTO_MAX_WIDTH = 1600;

type Common = ServiceProjectFields & {
  clubId: number;
  navigateAfterSave: () => void;
  handleSave: () => void | Promise<void>;
};

type AddExtras = {
  agreementOpen: boolean;
  handleAgree: () => void;
  handleAgreeCancel: () => void;
  classUnlocked: boolean;
  unlockClassification: () => void;
  buildSwitchDraft: () => Record<string, unknown>;
};

type Props =
  | { cfg: ServiceFormConfig; mode: "add"; form: Common & AddExtras }
  | { cfg: ServiceFormConfig; mode: "edit"; form: Common };

export default function ServiceProjectForm(props: Props) {
  const { cfg, mode, form } = props;
  const add = props.mode === "add" ? props.form : null;
  const {
    clubId, clubName, moduleId, loading, saving, errorMessage, setErrorMessage,
    showProjectSuccess, setShowProjectSuccess, navigateAfterSave, handleSave,
    areasOfFocus, fundingList, title, setTitle, description, setDescription, location, setLocation,
    selectedAofId, setSelectedAofId, otherAreaOfFocus, setOtherAreaOfFocus, isOthersAof,
    projectDate, setProjectDate, frozenMonth, frozenDateMin, frozenDateMax,
    projectCost, setProjectCost, currency, setCurrency, selectedFundingId, handleFundingChange,
    showGlobalGrantBlock, showCsrBlock,
    globalGrantNumber, setGlobalGrantNumber, amountSanctioned, setAmountSanctioned,
    amountReceived, setAmountReceived, amountSpent, setAmountSpent,
    hostClubsDistricts, setHostClubsDistricts, globalPartnerClubsDistricts, setGlobalPartnerClubsDistricts,
    csrCompanyName, setCsrCompanyName, directBeneficiaries, setDirectBeneficiaries, manHours, setManHours,
    rotariansInvolved, setRotariansInvolved, rotaractorsInvolved, setRotaractorsInvolved, rccInvolved, setRccInvolved,
    sendEmail, setSendEmail, photoCrop, handleCropSave, applyClassification,
  } = form;
  const look = cfg.look;
  const isAdd = mode === "add";
  const verb = isAdd ? "Add" : "Edit";
  const classUnlocked = add ? add.classUnlocked : true;
  const csrSymbol = isAdd && cfg.csrAppSymbolOnAdd ? currencySymbol() : getCurrencySymbol(currency);

  if (loading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center py-20">
          <ListPageSkeleton />
        </div>
      </ProtectedRoute>
    );
  }

  const todayStr = new Date().toISOString().split("T")[0];

  const notifyLabel = (
    <label className={`flex items-center gap-2.5 cursor-pointer select-none${isAdd ? " mt-2" : ""}`}>
      <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className={look.checkboxClass} />
      <span className="text-sm font-medium text-slate-700">Send Email notification</span>
      {sendEmail && <RecipientBadge scope="club" clubId={clubId} />}
    </label>
  );

  const numberField = (label: string, value: string, set: (v: string) => void, required: boolean, hint?: string) => (
    <div>
      <FieldLabel required={required} hint={hint}>{label}</FieldLabel>
      <Input
        type="number"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="0"
        min={0}
      />
    </div>
  );

  return (
    <ProtectedRoute>
      <ClubAdminShell
        pageTitle={`${verb} ${cfg.name} Project`}
        pageSubtitle={isAdd ? cfg.addSubtitle : cfg.editSubtitle}
        activeNavHref="/club-admin-dashboard/service-projects-and-public-image"
      >
      <V2FormShell
        title={`${verb} ${cfg.name} Project`}
        subtitle={clubName}
        defaultBack={`/clubs/${clubId}/${cfg.slug}/v2`}
        saving={saving}
        saveLabel={isAdd ? "Save Project" : "Update Project"}
        onSave={handleSave}
        banner={
          <div className="flex items-start gap-2 text-blue-800">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{cfg.topMessage}</span>
          </div>
        }
      >
        {/* 1. Project Details */}
        <SectionCard number={1} icon={MapPin} title="Project Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <FieldLabel required hint="(max 50 chars)">Title</FieldLabel>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project title"
                maxLength={50}
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{title.length}/50</p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel required hint="(max 1000 chars)">Description</FieldLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={isAdd ? "Describe the project, its objectives, and impact…" : "Describe the project…"}
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-slate-400 text-right mt-0.5">{description.length}/1000</p>
            </div>
            <div>
              <FieldLabel required>Location of Project</FieldLabel>
              <Input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, Venue, etc."
              />
            </div>
            <div>
              <FieldLabel required>Date of Project</FieldLabel>
              <DateField value={projectDate} onChange={setProjectDate} max={frozenMonth ? frozenDateMax : todayStr} min={frozenMonth ? frozenDateMin : undefined} className="row-field w-full" />
            </div>
          </div>
        </SectionCard>

        {/* 2. Classification */}
        <SectionCard number={2} icon={Target} title="Category">
          {add ? (
            <ClassificationAssist
              clubId={clubId}
              moduleId={moduleId}
              moduleKey={cfg.moduleKey}
              title={title}
              description={description}
              onApply={applyClassification}
              {...(cfg.passSelectedAreaId ? { selectedAreaId: selectedAofId } : {})}
              enableCrossModule
              buildSwitchDraft={add.buildSwitchDraft}
              unlocked={add.classUnlocked}
              onUnlock={add.unlockClassification}
            />
          ) : (
            <ClassificationAssist
              clubId={clubId}
              moduleId={moduleId}
              moduleKey={cfg.moduleKey}
              title={title}
              description={description}
              onApply={applyClassification}
              {...(cfg.passSelectedAreaId ? { selectedAreaId: selectedAofId } : {})}
              enableCrossModule={false}
            />
          )}

          <div className={add ? `grid grid-cols-1 sm:grid-cols-2 gap-4 ${classUnlocked ? "" : "opacity-50 pointer-events-none select-none"}` : "grid grid-cols-1 sm:grid-cols-2 gap-4"}>
            <div>
              <FieldLabel required>Category</FieldLabel>
              <NativeSelect
                value={selectedAofId}
                onChange={(e) => setSelectedAofId(e.target.value)}
              >
                <option value="">Select</option>
                {areasOfFocus.map((a) => (
                  <option key={a.id} value={String(a.id)}>{a.name}</option>
                ))}
                {!areasOfFocus.some((a) => (a.name || "").trim().toLowerCase() === "others") && (
                  <option value="others">Others</option>
                )}
              </NativeSelect>
              {isOthersAof && (
                <Input
                  type="text"
                  value={otherAreaOfFocus}
                  onChange={(e) => setOtherAreaOfFocus(e.target.value)}
                  placeholder="Specify category"
                  className="mt-2"
                />
              )}
            </div>
          </div>
        </SectionCard>

        {/* 3. Financial & Impact */}
        <SectionCard number={3} icon={IndianRupee} title="Financial & Impact">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>Currency</FieldLabel>
              <NativeSelect
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencyOptions().map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <FieldLabel required>Project Cost ({getCurrencySymbol(currency)})</FieldLabel>
              <Input
                type="number"
                value={projectCost}
                onChange={(e) => setProjectCost(e.target.value)}
                placeholder="0"
                min={0}
              />
            </div>
            <div>
              <FieldLabel required>Funding</FieldLabel>
              <NativeSelect
                value={selectedFundingId}
                onChange={(e) => handleFundingChange(e.target.value)}
              >
                <option value="">Select</option>
                {fundingList.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
              </NativeSelect>
            </div>

            {/* Funding-conditional: Global Grant fields */}
            {showGlobalGrantBlock && (
              <div className={look.ggBox}>
                <h4 className={look.ggTitle}>Global Grant Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldLabel required={false}>Global Grant Number</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={globalGrantNumber}
                      onChange={(e) => setGlobalGrantNumber(onlyDigits(e.target.value))} placeholder="e.g., 2434521" />
                  </div>
                  <div>
                    <FieldLabel required={false}>Amount Sanctioned ({getCurrencySymbol(currency)})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div>
                    <FieldLabel required={false}>Amount Received ({getCurrencySymbol(currency)})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div>
                    <FieldLabel required={false}>Amount spent till date ({getCurrencySymbol(currency)})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSpent}
                      onChange={(e) => setAmountSpent(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel required>Host Clubs/Districts</FieldLabel>
                    <Input type="text" value={hostClubsDistricts}
                      onChange={(e) => setHostClubsDistricts(e.target.value)} placeholder="e.g., RC Chicago, RC Paris" />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel required>Global Partner Clubs/Districts</FieldLabel>
                    <Input type="text" value={globalPartnerClubsDistricts}
                      onChange={(e) => setGlobalPartnerClubsDistricts(e.target.value)} placeholder="e.g., RC Tokyo" />
                  </div>
                </div>
              </div>
            )}

            {/* Funding-conditional: CSR fields */}
            {showCsrBlock && (
              <div className={look.csrBox}>
                <h4 className={look.csrTitle}>CSR Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <FieldLabel required>Name of the CSR Company</FieldLabel>
                    <Input type="text" value={csrCompanyName}
                      onChange={(e) => setCsrCompanyName(e.target.value)} placeholder="e.g., ABC Industries Ltd" />
                  </div>
                  <div>
                    <FieldLabel required>Amount Sanctioned ({csrSymbol})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountSanctioned}
                      onChange={(e) => setAmountSanctioned(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                  <div>
                    <FieldLabel required>Amount Received ({csrSymbol})</FieldLabel>
                    <Input inputMode="numeric" pattern="[0-9]*" value={amountReceived}
                      onChange={(e) => setAmountReceived(onlyDigits(e.target.value))} placeholder="0" />
                  </div>
                </div>
              </div>
            )}

            {numberField("Direct Beneficiaries", directBeneficiaries, setDirectBeneficiaries, true)}
            {numberField("Man Hours", manHours, setManHours, true, "(Rotarians x Hours)")}
            {numberField("Rotarians Involved", rotariansInvolved, setRotariansInvolved, true)}
            {numberField("Rotaractors Involved", rotaractorsInvolved, setRotaractorsInvolved, false)}
            {numberField("RCC Involved", rccInvolved, setRccInvolved, false)}
          </div>
        </SectionCard>

        {/* 4. Photos */}
        <ServicePhotosSection cfg={cfg} mode={mode} form={form} />

        {look.notifyTitle == null ? (
          <div className="rounded-xl border border-slate-200 p-4">{notifyLabel}</div>
        ) : (
          <SectionCard number={5} icon={Users} title={look.notifyTitle}>{notifyLabel}</SectionCard>
        )}

        {/* Project Success Dialog */}
        <Dialog open={showProjectSuccess} onOpenChange={() => {}}>
          <DialogContent className="max-w-lg [&>button.absolute]:hidden" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>{isAdd ? "Project Saved Successfully" : "Project Updated Successfully"}</DialogTitle>
              <DialogDescription className="sr-only">{isAdd ? "Project save confirmation" : "Project update confirmation"}</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-3 py-2">
              <p className="font-medium text-foreground">Dear Club Leader,</p>
              <p>You have successfully {isAdd ? "added" : "updated"} a project in ROW. You can check after 10 minutes.</p>
              <p>Thank you,<br /><span className="font-medium text-foreground">Team ROW</span></p>
            </div>
            <Button
              type={look.okTypeButton ? "button" : undefined}
              className="w-full"
              onClick={() => { setShowProjectSuccess(false); navigateAfterSave(); }}
            >
              OK
            </Button>
          </DialogContent>
        </Dialog>

        <ImageCropDialog
          open={photoCrop.open}
          imageSrc={photoCrop.current?.dataUrl ?? null}
          aspect={PROJECT_PHOTO_ASPECT}
          allowOrientation
          maxOutputWidth={PROJECT_PHOTO_MAX_WIDTH}
          title={photoCrop.pending > 1 ? `Crop Photo (${photoCrop.pending} left)` : "Crop Photo"}
          saving={photoCrop.saving}
          onCancel={photoCrop.skip}
          onSave={handleCropSave}
        />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </V2FormShell>

      {/* Page-load "I Agree" disclaimer (ported from v1 listing page) */}
      {add && (
        <AgreeDialog open={add.agreementOpen} text={cfg.agreeMessage} onCancel={add.handleAgreeCancel} onAgree={add.handleAgree} />
      )}
      </ClubAdminShell>
    </ProtectedRoute>
  );
}
