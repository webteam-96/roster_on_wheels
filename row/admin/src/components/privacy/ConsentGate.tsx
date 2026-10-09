"use client";

/**
 * Consent at first sign-in after the policy version changes (master plan WS7-05).
 * Members arrive through the Rotary.org sync and never sign up, so this is the
 * first moment they can be asked. Declining signs the member out. Inert unless
 * the instance sets privacy.enabled.
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useBrand, useFeature } from "@/contexts/BrandContext";
import { acceptConsent, getConsentStatus } from "@/services/api";
import { getErrorMessage } from "@/lib/errors";

export default function ConsentGate() {
  const enabled = useFeature("privacy.enabled");
  const { isAuthenticated, logout } = useAuth();
  const brand = useBrand();
  const locale = useLocale();
  const t = useTranslations("privacy.consent");
  const tRoot = useTranslations();
  const [policyVersion, setPolicyVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      setPolicyVersion(null);
      return;
    }
    let cancelled = false;
    getConsentStatus()
      .then((s) => {
        if (!cancelled && s.required) setPolicyVersion(s.policyVersion);
      })
      .catch(() => {
        // Endpoint unavailable: never lock members out because of it.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, isAuthenticated]);

  if (!policyVersion) return null;

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await acceptConsent(policyVersion, locale);
      setPolicyVersion(null);
    } catch (e) {
      setError(getErrorMessage(e, tRoot));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        className="max-w-lg [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-slate-700">{t("body")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-4 text-sm">
          <a href={brand.legal.privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("privacyPolicy")}
          </a>
          <a href={brand.legal.termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
            {t("terms")}
          </a>
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={logout} disabled={saving}>
            {t("decline")}
          </Button>
          <Button onClick={accept} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("saving") : t("accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
