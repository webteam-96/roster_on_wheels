import { appFormat } from "@/lib/appFormat";
import { formatMoney } from "@/lib/currency";

type Props = {
  currency?: string | null;
  localCurrency?: string | null;
  localTotal?: number | null;
  rateDate?: string | null;
};

/** What a price is in the club's own currency today. Information only: the payer is charged in `currency`. */
export default function LocalAmountNote({ currency, localCurrency, localTotal, rateDate }: Props) {
  if (!localCurrency || localTotal == null) return null;
  return (
    <p className="mt-2 text-[13px] text-muted-foreground">
      About {formatMoney(localTotal, localCurrency)} ({localCurrency}) at the rate of {appFormat().date(rateDate ?? "")}. You are charged in {currency}.
    </p>
  );
}
