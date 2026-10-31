import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { subscriptionInput, subscriptionListWhere } from "@/lib/subscriptions";
import { unitPrice } from "@/lib/pricing";

const valid = { customerId: "cust", planId: "plan", startDate: "2026-01-01", expiryDate: "2027-01-01", paymentTerms: "NET_30", lines: [{ productId: "product", variantId: "variant", quantity: 3 }] };
assert.equal(subscriptionInput.safeParse(valid).success, true);
assert.equal(subscriptionInput.safeParse({ ...valid, lines: [{ ...valid.lines[0], quantity: 0 }] }).success, false);
assert.equal(subscriptionInput.safeParse({ ...valid, paymentTerms: "NET_60" }).success, false);
assert.deepEqual(subscriptionListWhere({ status: "ACTIVE", planId: "p", customer: "ada" }), {
  AND: [
    { status: "ACTIVE" }, { planId: "p" },
    { customer: { OR: [{ name: { contains: "ada", mode: "insensitive" } }, { email: { contains: "ada", mode: "insensitive" } }] } },
  ],
});
const snap = unitPrice({ salesPrice: new Prisma.Decimal("10.20") }, { extraPrice: new Prisma.Decimal("0.35") });
assert.equal(snap.toFixed(2), "10.55");
assert.equal(snap.mul(3).toFixed(2), "31.65");
console.log("Subscription input, filter, and catalog price checks passed");
