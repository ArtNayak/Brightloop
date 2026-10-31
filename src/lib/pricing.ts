import { Prisma } from "@prisma/client";

type Decimal = Prisma.Decimal;

/** Return the catalog unit price including an optional variant surcharge. */
export function unitPrice(
  product: { salesPrice: Decimal },
  variant?: { extraPrice: Decimal } | null,
): Decimal {
  return product.salesPrice
    .plus(variant?.extraPrice ?? new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
