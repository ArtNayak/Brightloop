import { Prisma } from "@prisma/client";

// Pure invoice math, no DB. All money is Decimal, 2 places, rounded half up (decision D5).
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

const ZERO = new Decimal(0);
const round2 = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), ZERO);

export type Line = {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: Decimal;
  taxPercent: Decimal;
};

export type Disc = {
  id: string;
  type: "FIXED" | "PERCENTAGE";
  value: Decimal;
  minPurchase?: Decimal | null;
  minQuantity?: number | null;
  scope: "PRODUCT" | "SUBSCRIPTION";
  productId?: string | null;
};

export type CalcLine = Line & {
  gross: Decimal;
  discountAmount: Decimal;
  amount: Decimal; // gross - discount, before tax
  tax: Decimal;
};

export type CalcResult = {
  lines: CalcLine[];
  subtotal: Decimal; // sum of gross
  discountTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal; // subtotal - discountTotal + taxTotal
  appliedDiscountIds: string[];
};

export function calcInvoice(lines: Line[], discounts: Disc[]): CalcResult {
  const gross = lines.map((l) => round2(l.unitPrice.mul(l.quantity)));
  const lineDiscount = lines.map(() => ZERO);
  const appliedDiscountIds: string[] = [];

  for (const d of discounts) {
    const eligible = lines.map((_, i) => i).filter((i) => d.scope === "SUBSCRIPTION" || lines[i].productId === d.productId);
    if (eligible.length === 0) continue;

    const eligibleAmount = sum(eligible.map((i) => gross[i]));
    const eligibleQty = eligible.reduce((n, i) => n + lines[i].quantity, 0);
    if (eligibleAmount.lte(0)) continue;
    if (d.minQuantity != null && eligibleQty < d.minQuantity) continue;
    if (d.minPurchase != null && eligibleAmount.lt(d.minPurchase)) continue;

    // each discount is computed on the original eligible amount (D3), never more than that amount
    const raw = d.type === "PERCENTAGE" ? eligibleAmount.mul(d.value).div(100) : d.value;
    const amount = Decimal.min(round2(raw), eligibleAmount);
    if (amount.lte(0)) continue;

    // spread proportionally to gross; the rounding remainder goes on the last eligible line
    const shares = eligible.map((i) => round2(amount.mul(gross[i]).div(eligibleAmount)));
    const last = shares.length - 1;
    shares[last] = Decimal.max(ZERO, amount.minus(sum(shares.slice(0, last))));

    // a line's total discount can never exceed its gross
    let removed = ZERO;
    eligible.forEach((i, k) => {
      const take = Decimal.min(shares[k], gross[i].minus(lineDiscount[i]));
      lineDiscount[i] = lineDiscount[i].plus(take);
      removed = removed.plus(take);
    });
    if (removed.gt(0)) appliedDiscountIds.push(d.id);
  }

  const calc = lines.map((l, i): CalcLine => {
    const amount = gross[i].minus(lineDiscount[i]);
    return {
      ...l,
      gross: gross[i],
      discountAmount: lineDiscount[i],
      amount,
      tax: round2(amount.mul(l.taxPercent).div(100)), // per line, then summed
    };
  });

  const subtotal = sum(calc.map((l) => l.gross));
  const discountTotal = sum(calc.map((l) => l.discountAmount));
  const taxTotal = sum(calc.map((l) => l.tax));
  return {
    lines: calc,
    subtotal,
    discountTotal,
    taxTotal,
    total: subtotal.minus(discountTotal).plus(taxTotal),
    appliedDiscountIds,
  };
}
