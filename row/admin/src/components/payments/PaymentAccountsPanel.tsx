"use client";

/**
 * Connect payments (master plan WS6-07, WS6-12). A district or club connects its
 * own Stripe or PayPal account: members pay into it directly and the platform
 * takes no split. Only gateways that can receive money in the owner's country
 * are offered. Keys are write-only: after saving, only their last four
 * characters come back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2, Plus, ShieldCheck, ShieldAlert, PowerOff, Power, RefreshCw, Info } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBrand } from "@/contexts/BrandContext";
import { useFormat } from "@/hooks/useFormat";
import { getErrorMessage } from "@/lib/errors";
import {
  connectPaymentAccount,
  getGatewayCoverage,
  getPaymentAccounts,
  reverifyPaymentAccount,
  setPaymentAccountActive,
} from "@/services/api";
import type { AccountOwnerType, GatewayCode, GatewayCoverage, PaymentAccount } from "@/types/payments";

/** Credential fields per gateway; names are the keys of ConnectAccountRequest.credentials. */
const CREDENTIAL_FIELDS: Record<"stripe" | "paypal", { name: string; secret: boolean }[]> = {
  stripe: [
    { name: "secretKey", secret: true },
    { name: "webhookSecret", secret: true },
  ],
  paypal: [
    { name: "clientId", secret: false },
    { name: "clientSecret", secret: true },
    { name: "webhookId", secret: false },
  ],
};

const CONNECTABLE: GatewayCode[] = ["stripe", "paypal"];

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("payments.accounts");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 gap-1.5"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

function AccountCard({ account, onChange }: { account: PaymentAccount; onChange: (a: PaymentAccount) => void }) {
  const t = useTranslations("payments");
  const tRoot = useTranslations();
  const fmt = useFormat();
  const [busy, setBusy] = useState<"verify" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gatewayName = t(`gateways.${account.gateway}`);

  const run = async (kind: "verify" | "active", call: () => Promise<PaymentAccount>) => {
    setBusy(kind);
    setError(null);
    try {
      onChange(await call());
    } catch (e) {
      setError(getErrorMessage(e, tRoot));
    } finally {
      setBusy(null);
    }
  };

  const status = !account.isActive ? "inactive" : account.verifiedAt ? "verified" : "unverified";

  return (
    <div className="rounded-[20px] border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{account.displayName}</h3>
            <Badge variant="outline">{gatewayName}</Badge>
            <Badge variant="outline">{account.currency}</Badge>
            <Badge
              className={
                status === "verified"
                  ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                  : status === "unverified"
                    ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-200"
              }
            >
              {status === "verified" ? <ShieldCheck className="mr-1 h-3.5 w-3.5" /> : <ShieldAlert className="mr-1 h-3.5 w-3.5" />}
              {t(`accounts.status.${status}`)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.secretLast4 && <span>{t("accounts.secret", { last4: account.secretLast4 })}</span>}
            {account.secretLast4 && account.verifiedAt && <span aria-hidden> · </span>}
            {account.verifiedAt && <span>{t("accounts.verifiedOn", { date: fmt.dateTime(account.verifiedAt) })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy !== null || !account.isActive}
            onClick={() => run("verify", () => reverifyPaymentAccount(account.id))}
          >
            {busy === "verify" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("accounts.reverify")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => run("active", () => setPaymentAccountActive(account.id, !account.isActive))}
          >
            {busy === "active" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : account.isActive ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
            {account.isActive ? t("accounts.deactivate") : t("accounts.activate")}
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <Label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("accounts.webhook")}</Label>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-700" title={account.webhookUrl}>
            {account.webhookUrl}
          </code>
          <CopyButton value={account.webhookUrl} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("accounts.webhookHelp", { gateway: gatewayName })}</p>
      </div>

      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
  gateways,
  ownerType,
  ownerId,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateways: GatewayCode[];
  ownerType: AccountOwnerType;
  ownerId: number;
  onConnected: (a: PaymentAccount) => void;
}) {
  const t = useTranslations("payments");
  const tRoot = useTranslations();
  const brand = useBrand();
  const [gateway, setGateway] = useState<GatewayCode>(gateways[0] ?? "stripe");
  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState(brand.locale.defaultCurrency);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGateway(gateways[0] ?? "stripe");
      setDisplayName("");
      setCurrency(brand.locale.defaultCurrency);
      setCredentials({});
      setError(null);
    }
  }, [open, gateways, brand.locale.defaultCurrency]);

  const fields = CREDENTIAL_FIELDS[gateway as "stripe" | "paypal"] ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || fields.some((f) => !credentials[f.name]?.trim())) {
      setError(t("connect.required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const account = await connectPaymentAccount({
        ownerType,
        ownerId,
        gateway,
        displayName: displayName.trim(),
        currency,
        credentials: Object.fromEntries(fields.map((f) => [f.name, credentials[f.name].trim()])),
      });
      onConnected(account);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err, tRoot));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("connect.title")}</DialogTitle>
            <DialogDescription>{t("connect.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pa-gateway">{t("connect.gateway")}</Label>
              <Select value={gateway} onValueChange={(v) => { setGateway(v as GatewayCode); setCredentials({}); }}>
                <SelectTrigger id="pa-gateway"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {gateways.map((g) => (
                    <SelectItem key={g} value={g}>{t(`gateways.${g}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-currency">{t("connect.currency")}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="pa-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {brand.locale.currencies.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pa-name">{t("connect.displayName")}</Label>
            <Input
              id="pa-name"
              value={displayName}
              maxLength={100}
              placeholder={t("connect.displayNamePlaceholder")}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          {fields.map((f) => (
            <div key={`${gateway}-${f.name}`} className="space-y-1.5">
              <Label htmlFor={`pa-${f.name}`}>{t(`fields.${gateway}.${f.name}`)}</Label>
              <Input
                id={`pa-${f.name}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
                value={credentials[f.name] ?? ""}
                onChange={(e) => setCredentials((c) => ({ ...c, [f.name]: e.target.value }))}
              />
              <p className="text-xs text-slate-500">{t(`fields.${gateway}.${f.name}Hint`)}</p>
            </div>
          ))}

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("connect.cancel")}
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? t("connect.submitting") : t("connect.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentAccountsPanel({ ownerType, ownerId }: { ownerType: AccountOwnerType; ownerId: number | null }) {
  const t = useTranslations("payments");
  const tRoot = useTranslations();
  const brand = useBrand();
  const [accounts, setAccounts] = useState<PaymentAccount[] | null>(null);
  const [coverage, setCoverage] = useState<GatewayCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setAccounts(null);
    setError(null);
    try {
      const [list, cov] = await Promise.all([getPaymentAccounts(ownerType, ownerId), getGatewayCoverage(ownerType, ownerId)]);
      setAccounts(list);
      setCoverage(cov);
    } catch (e) {
      setAccounts([]);
      setError(getErrorMessage(e, tRoot));
    }
  }, [ownerType, ownerId, tRoot]);

  useEffect(() => {
    load();
  }, [load]);

  // Offer a gateway only if the instance uses it, it can receive money in the owner's country, and we can connect it here.
  const gateways = useMemo(
    () =>
      CONNECTABLE.filter(
        (g) => brand.paymentGateways.includes(g) && (!coverage || coverage.gateways.includes(g)),
      ),
    [brand.paymentGateways, coverage],
  );
  const gatewayList = gateways.map((g) => t(`gateways.${g}`)).join(", ");

  const replace = (updated: PaymentAccount) => {
    setAccounts((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));
    setNotice(t("accounts.updated"));
  };

  if (!ownerId) {
    return <div className="p-6 text-sm text-slate-500">{t("accounts.selectOwner")}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-900">{t("accounts.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("accounts.intro")}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={accounts === null || gateways.length === 0} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("accounts.connect")}
        </Button>
      </div>

      {coverage && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            gateways.length ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {gateways.length === 0
              ? t("accounts.noCoverage", { country: coverage.countryName ?? coverage.countryIso ?? "–" })
              : coverage.countryName
                ? t("accounts.coverage", { country: coverage.countryName, gateways: gatewayList })
                : t("accounts.coverageUnknown", { gateways: gatewayList })}
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      {accounts === null ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("accounts.loading")}
        </div>
      ) : accounts.length === 0 ? (
        !error && <div className="rounded-[20px] border border-dashed bg-white p-8 text-center text-sm text-slate-600">{t("accounts.empty")}</div>
      ) : (
        <div className="space-y-4">
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} onChange={replace} />
          ))}
        </div>
      )}

      <ConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        gateways={gateways}
        ownerType={ownerType}
        ownerId={ownerId}
        onConnected={(a) => {
          setAccounts((list) => [a, ...(list ?? []).filter((x) => x.id !== a.id)]);
          setNotice(t("connect.success", { gateway: t(`gateways.${a.gateway}`) }));
        }}
      />
    </div>
  );
}
