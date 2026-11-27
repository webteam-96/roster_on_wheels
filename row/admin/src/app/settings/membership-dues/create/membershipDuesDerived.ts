import { recordMembershipDuesOffline, approveMembershipDuesPayment, sendMembershipDuesReceipt, sendMembershipDuesReminder, bulkMembershipDuesReminderEmail, updateMembershipDuesMemberFee } from "@/services/api";
import { appLocale } from "@/lib/appFormat";
import { VendorSplit, isDefaultSettlementVendorId, computeDefaultAccountAmount } from "./membershipDuesShared";
import type { useMembershipDuesForm } from "./useMembershipDuesForm";

// Values the page computed after its early returns; same statements, same order.
export function deriveMembershipDuesForm(h: ReturnType<typeof useMembershipDuesForm>) {
  const { currentStep, totalSteps, kycVendors, splitSurchargePercent, enabledFeeTypes, feeType1Amount, feeType2Amount, feeType3Amount, vendorSplits, setVendorSplits, amountType, isEdit, originalMode, originalFees, setMemberFeeOverrides, addedVendorIds, defaultAccountRatePercent, setMemberVendorOverrides, editMembersFetched, editMembersLoading, editMembers, getEditFeePaid, getEditFeeAmount, getEditVendors, setEditMemberChanges, isDefaultEditVendor, getEditFeeStatus, setOfflineDialogOpen, setOfflineMember, setOfflineFeeType, setOfflinePaymentMode, setOfflineTxnId, setOfflineGivenTo, setOfflineDate, setOfflineRemark, setOfflineAttachment, setOfflineSendEmail, offlineMember, offlineFeeType, offlineDate, setErrorMessage, offlinePaymentMode, offlineGivenTo, setOfflineSaving, offlineTxnId, offlineRemark, offlineSendEmail, offlineAttachment, editId, setSuccessMessage, refreshEditMembers, rejectPaymentId, rejectReason, setRejectDialogOpen, setRejectReason, emailRemark, validateEditMemberBalances, setSavingEditMembers, editMemberChanges, bulkRemark, setBulkRemarkDialogOpen, setBulkRemark } = h;

  const isLastStep = currentStep === totalSteps - 1;

  // Computes the default vendor's split per fee type from the CURRENT base
  // amount + online surcharge %. Shared by the auto-add (on amount-type
  // change) and the manual Refresh button — the auto-add can go stale if the
  // vendor was added before the Default Amount / Surcharge % fields were
  // filled in, since it only runs once at that moment.
  const computeDefaultVendorSplits = (forAmountType: string): VendorSplit[] => {
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return [];
    const defaultPer = splitSurchargePercent;
    return enabledFeeTypes.map(ft => {
      let amount = defaultPer;
      if (forAmountType === "1") {
        const feeAmount = ft.type === 1 ? Number(feeType1Amount) || 0
                         : ft.type === 2 ? Number(feeType2Amount) || 0
                         : Number(feeType3Amount) || 0;
        amount = Number((feeAmount * defaultPer / 100).toFixed(2));
      }
      return {
        fkFeeType: ft.type,
        fkKycId: defaultVendor.id,
        vendorId: defaultVendor.vendorId,
        vendorName: defaultVendor.name,
        splitAmount: amount,
        isSelf: false,
      };
    });
  };

  const handleRefreshDefaultVendor = () => {
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return;
    const filtered = vendorSplits.filter(s => s.fkKycId !== defaultVendor.id);
    setVendorSplits([...filtered, ...computeDefaultVendorSplits(amountType)]);
  };

  // Auto-add default vendor when amount type is selected
  const handleAutoAddDefaultVendor = (newAmountType: string) => {
    if (isEdit) return; // Don't auto-add on edit mode — vendors already loaded from DB
    const defaultVendor = kycVendors.find(k => isDefaultSettlementVendorId(k.vendorId));
    if (!defaultVendor) return;

    // Remove existing default vendor splits
    const filtered = vendorSplits.filter(s => s.fkKycId !== defaultVendor.id);
    const newSplits = computeDefaultVendorSplits(newAmountType);

    setVendorSplits([...filtered, ...newSplits]);
  };

  // ---- Edit mode freeze/lock helpers ----
  const shouldDisableMode = (val: string) => {
    if (!isEdit) return false;
    if (originalMode === "3") return val !== "3"; // Both: can't change
    if (originalMode === "1") return val === "2"; // Online: can't go to Offline
    if (originalMode === "2") return val === "1"; // Offline: can't go to Online
    return false;
  };

  const isNewFeeType = (ft: number) => isEdit && (
    (ft === 1 && !originalFees.isFees1) ||
    (ft === 2 && !originalFees.isFees2) ||
    (ft === 3 && !originalFees.isFees3)
  );

  const isOriginalFeeType = (ft: number) => isEdit && (
    (ft === 1 && originalFees.isFees1) ||
    (ft === 2 && originalFees.isFees2) ||
    (ft === 3 && originalFees.isFees3)
  );
  const setMemberFee = (memberId: number, feeType: number, val: number) => {
    setMemberFeeOverrides(prev => ({ ...prev, [`${memberId}_${feeType}`]: val }));

    // The locked DEFAULT account is DERIVED from this member's own fee amount, so it
    // has to follow the edit — otherwise it keeps showing the figure computed for the
    // previous amount (a row dropped 18,000 -> 11,000 kept the 18,000 default of
    // 547.20). Per fee type, so Annual / Semi 1 / Semi 2 each track their own base.
    // Only the default account is touched; the hand-edited vendors are left alone,
    // and no Balance moves because the default account is balance-excluded.
    //
    // Percentage mode (amountType "2") is skipped: its vendor columns hold percentages,
    // not rupees, so the rupee formula does not apply there.
    if (amountType === "2") return;
    const defaultKycIds = addedVendorIds.filter(kycId => isDefaultKyc(kycId));
    if (defaultKycIds.length === 0) return;
    const defaultAmount = computeDefaultAccountAmount(
      val, splitSurchargePercent, defaultAccountRatePercent,
    );
    setMemberVendorOverrides(prev => {
      const next = { ...prev };
      defaultKycIds.forEach(kycId => { next[`${memberId}_${feeType}_${kycId}`] = defaultAmount; });
      return next;
    });
  };
  const setMemberVendor = (memberId: number, feeType: number, kycId: number, val: number) => {
    setMemberVendorOverrides(prev => ({ ...prev, [`${memberId}_${feeType}_${kycId}`]: val }));
  };

  /** The locked, auto-computed default settlement account. */
  const isDefaultKyc = (kycId: number) =>
    isDefaultSettlementVendorId(kycVendors.find(k => k.id === kycId)?.vendorId);
  const getEditFeeBalance = (m: any, ft: number) => ft === 1 ? (m.annualBalance ?? m.annualAmount ?? 0) : ft === 2 ? (m.semi1Balance ?? m.semi1Amount ?? 0) : (m.semi2Balance ?? m.semi2Amount ?? 0);

  // Whether the default amount for a fee type is safe to edit: true only when
  // every member who hasn't already paid that fee type currently has the same
  // amount (matches the same rule the backend enforces before cascading a
  // changed default onto existing members — see UpdateAsync's
  // CascadeDefaultIfUniform). Members who already paid are excluded since
  // their fee is closed history and doesn't count as a "divergence". While
  // member data hasn't loaded yet, default to false (locked) rather than
  // risk a flash of "editable" that isn't actually backed by data.
  const allMembersSameAmount = (ft: number): boolean => {
    if (!editMembersFetched || editMembersLoading) return false;
    const unpaid = editMembers.filter(m => getEditFeePaid(m, ft) <= 0);
    if (unpaid.length === 0) return true;
    const first = Number(getEditFeeAmount(unpaid[0], ft));
    return unpaid.every(m => Number(getEditFeeAmount(m, ft)) === first);
  };

  const getEditPaymentInfo = (m: any, ft: number): string => {
    const mode = ft === 1 ? m.annualPaymentMode : ft === 2 ? m.semi1PaymentMode : m.semi2PaymentMode;
    const date = ft === 1 ? m.annualPaymentDate : ft === 2 ? m.semi1PaymentDate : m.semi2PaymentDate;
    if (!mode) return "\u2014";
    if (date) {
      const d = new Date(date);
      return `${mode} | ${d.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" })} ${d.toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" })}`;
    }
    return mode;
  };

  /**
   * Edit-mode counterpart of setMemberFee: records the member's new fee amount AND
   * re-derives the locked DEFAULT account's split for that same fee type, writing both
   * into `editMemberChanges`.
   *
   * Using the same override map is what makes the recomputed figure persist: the
   * `${memberFeeId}_v_${feeType}_${index}` key is picked up by the `parts[1] === "v"`
   * branch in handleNext / handleSaveEditMemberChanges and posted as a vendorOverride.
   * The index matches the render's `vendors.map((v, i) => ...)` because both read the
   * same getEditVendors(m, feeType) array.
   *
   * Balances are untouched — isBalanceExcludedEditVendor skips the default account in
   * both the table's total and validateEditMemberBalances.
   */
  const setEditMemberFee = (m: { memberFeeId: number }, feeType: number, raw: string) => {
    const key = `${m.memberFeeId}_fee_${feeType}`;
    // Percentage mode keeps percentages in the vendor columns — the rupee formula
    // does not apply, so only the fee itself is recorded there.
    const recomputeDefault = amountType !== "2";
    const defaultAmount = computeDefaultAccountAmount(
      Number(raw), splitSurchargePercent, defaultAccountRatePercent,
    );
    const vendors = getEditVendors(m, feeType);
    setEditMemberChanges(prev => {
      const next = { ...prev, [key]: raw };
      if (recomputeDefault) {
        vendors.forEach((v, i) => {
          if (isDefaultEditVendor(v)) next[`${m.memberFeeId}_v_${feeType}_${i}`] = defaultAmount;
        });
      }
      return next;
    });
  };

  const getUnpaidFeeTypes = (m: any): {type: number, label: string}[] => {
    return enabledFeeTypes.filter(ft => getEditFeeStatus(m, ft.type) === "Unpaid");
  };

  const hasAnyPaidFee = (m: any): boolean => {
    return enabledFeeTypes.some(ft => getEditFeeStatus(m, ft.type) === "Paid");
  };

  const resetOfflineDialog = () => {
    setOfflineDialogOpen(false);
    setOfflineMember(null);
    setOfflineFeeType("");
    setOfflinePaymentMode("Cash");
    setOfflineTxnId("");
    setOfflineGivenTo("");
    setOfflineDate("");
    setOfflineRemark("");
    setOfflineAttachment(null);
    setOfflineSendEmail(false);
  };

  const handleOfflineSave = async () => {
    if (!offlineMember || !offlineFeeType || !offlineDate) {
      setErrorMessage("Fee Type and Date are required."); return;
    }
    if ((offlinePaymentMode === "Cash" || offlinePaymentMode === "Cheque") && !offlineGivenTo.trim()) {
      setErrorMessage("'Given To' is required for Cash and Cheque payments."); return;
    }
    setOfflineSaving(true);
    try {
      const fd = new FormData();
      fd.append("feeType", offlineFeeType);
      fd.append("fkMemberProfileId", String(offlineMember.memberId));
      fd.append("transactionType", offlinePaymentMode);
      fd.append("transactionId", offlineTxnId);
      fd.append("givenTo", offlineGivenTo);
      fd.append("paymentDate", offlineDate);
      fd.append("remark", offlineRemark);
      fd.append("sendReceiptEmail", String(offlineSendEmail));
      if (offlineAttachment) fd.append("attachment", offlineAttachment);
      await recordMembershipDuesOffline(Number(editId), offlineMember.memberFeeId, fd);
      setSuccessMessage("Offline payment recorded!");
      resetOfflineDialog();
      refreshEditMembers();
    } catch (e: any) {
      setErrorMessage(e?.response?.data?.message || "Failed to record offline payment.");
    } finally { setOfflineSaving(false); }
  };

  const handleApprove = async (paymentId: number) => {
    try {
      await approveMembershipDuesPayment(paymentId, { isApproved: true });
      setSuccessMessage("Payment approved!");
      refreshEditMembers();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to approve."); }
  };

  const handleRejectSubmit = async () => {
    try {
      await approveMembershipDuesPayment(rejectPaymentId, { isApproved: false, rejectionReason: rejectReason });
      setSuccessMessage("Payment rejected.");
      setRejectDialogOpen(false);
      setRejectReason("");
      refreshEditMembers();
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to reject."); }
  };

  const handleEmailReminder = async (memberFeeId: number, feeType: number) => {
    try {
      await sendMembershipDuesReminder(Number(editId), memberFeeId, { feeType, remark: emailRemark || undefined });
      setSuccessMessage("Email reminder sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send reminder."); }
  };


  const handleReceipt = async (memberFeeId: number) => {
    try {
      await sendMembershipDuesReceipt(memberFeeId);
      setSuccessMessage("Receipt sent!");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed to send receipt."); }
  };

  const handleSaveEditMemberChanges = async () => {
    // Validate balances first
    const balanceErr = validateEditMemberBalances();
    if (balanceErr) { setErrorMessage(balanceErr); document.querySelector("main")?.scrollTo(0, 0); return; }

    setSavingEditMembers(true);
    try {
      // Group changes by memberFeeId
      const memberUpdates: Record<number, any> = {};
      let changeCount = 0;
      for (const [key, value] of Object.entries(editMemberChanges)) {
        const parts = key.split("_");
        const memberFeeId = Number(parts[0]);
        if (!memberUpdates[memberFeeId]) memberUpdates[memberFeeId] = {};

        if (parts[1] === "cat") {
          memberUpdates[memberFeeId].categoryType = value;
        } else if (parts[1] === "fee") {
          const ft = Number(parts[2]);
          if (ft === 1) memberUpdates[memberFeeId].annualAmount = Number(value);
          if (ft === 2) memberUpdates[memberFeeId].semi1Amount = Number(value);
          if (ft === 3) memberUpdates[memberFeeId].semi2Amount = Number(value);
        } else if (parts[1] === "v") {
          // Vendor override: feeType and vendorIdx
          const ft = Number(parts[2]);
          const vIdx = Number(parts[3]);
          // Find the member to get vendor kycId
          const member = editMembers.find(m => m.memberFeeId === memberFeeId);
          if (member) {
            const vendors = getEditVendors(member, ft);
            if (vendors[vIdx]) {
              if (!memberUpdates[memberFeeId].vendorOverrides) memberUpdates[memberFeeId].vendorOverrides = [];
              memberUpdates[memberFeeId].vendorOverrides.push({
                vendorId: vendors[vIdx].vendorId || vendors[vIdx].VendorId,
                feeType: ft,
                amount: Number(value)
              });
            }
          }
        }
      }

      for (const [mfId, changes] of Object.entries(memberUpdates)) {
        changeCount++;
        await updateMembershipDuesMemberFee(Number(editId), Number(mfId), changes);
      }

      if (changeCount === 0) {
        setErrorMessage("No changes detected to save.");
        setSavingEditMembers(false);
        return;
      }

      setEditMemberChanges({});
      setSuccessMessage("Member changes saved successfully!");
      await refreshEditMembers();
    } catch (e: any) {
      setErrorMessage("Failed to save: " + (e?.response?.data?.message || e?.message || ""));
    } finally {
      setSavingEditMembers(false);
    }
  };

  const handleBulkEmailReminder = async () => {
    try {
      await bulkMembershipDuesReminderEmail(Number(editId), { remark: bulkRemark || undefined });
      setSuccessMessage("Bulk email reminders sent!");
      setBulkRemarkDialogOpen(false);
      setBulkRemark("");
    } catch (e: any) { setErrorMessage(e?.response?.data?.message || "Failed."); }
  };
  return { isLastStep, computeDefaultVendorSplits, handleRefreshDefaultVendor, handleAutoAddDefaultVendor, shouldDisableMode, isNewFeeType, isOriginalFeeType, setMemberFee, setMemberVendor, isDefaultKyc, getEditFeeBalance, allMembersSameAmount, getEditPaymentInfo, setEditMemberFee, getUnpaidFeeTypes, hasAnyPaidFee, resetOfflineDialog, handleOfflineSave, handleApprove, handleRejectSubmit, handleEmailReminder, handleReceipt, handleSaveEditMemberChanges, handleBulkEmailReminder };
}
