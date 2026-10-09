"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocaleControl } from "@/i18n/IntlProvider";
import { nativeLanguageName } from "@/i18n/config";
import { updateMyLanguage } from "@/services/api";
import { cn } from "@/lib/utils";

/**
 * Lists the instance's languages by their own names. Renders nothing when the
 * instance has a single language (RIZones). When signed in, the choice is also
 * stored on the member so it follows them to other devices.
 */
export default function LanguagePicker({ className, signedIn = false }: { className?: string; signedIn?: boolean }) {
  const t = useTranslations("common.language");
  const { locale, available, setLocale } = useLocaleControl();

  if (available.length <= 1) return null;

  const change = (next: string) => {
    setLocale(next);
    if (signedIn) {
      // Best effort: the cookie already holds the choice for this browser.
      updateMyLanguage(next).catch(() => {});
    }
  };

  return (
    <Select value={locale} onValueChange={change}>
      <SelectTrigger aria-label={t("choose")} className={cn("h-9 w-auto min-w-[8rem] gap-2", className)}>
        <Globe className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map((code) => (
          <SelectItem key={code} value={code} lang={code}>
            {nativeLanguageName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
