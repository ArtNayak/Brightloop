// run: npm run test:portal   (needs `npm run dev` running and the seeded demo data; adds a second customer "PORTALCHK" and removes it)
// Proves the portal only ever shows a customer their own rows: ids that belong to someone else answer 404.
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { base, login } from "@/lib/check-helpers";

const email = `portalchk-${Date.now()}@brightloop.test`;
const day = 86_400_000;
const when = (n: number) => new Date(Date.now() + n * day);

const get = async (path: string, cookie: string) => {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: res.status, html: (await res.text()).replace(/<!-- -->/g, "") };
};
const post = (path: string, cookie: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });

async function main() {
  const plan = await db.plan.findFirstOrThrow();
  // customer B owns: a quote waiting for confirmation, a confirmed invoice, and a draft invoice nobody should see yet
  const b = await db.user.create({ data: { email, name: "Portal Check B", role: "CUSTOMER", passwordHash: await bcrypt.hash("Passw0rd!", 10) } });
  try {
    const quote = await db.subscription.create({
      data: { number: "SUB-PORTALCHK-Q", customerId: b.id, planId: plan.id, status: "QUOTATION", startDate: when(0), quoteValidUntil: when(10) },
    });
    const draftSub = await db.subscription.create({
      data: { number: "SUB-PORTALCHK-D", customerId: b.id, planId: plan.id, status: "DRAFT", startDate: when(0) },
    });
    const money = { subtotal: 100, taxTotal: 18, total: 118 };
    const inv = await db.invoice.create({
      data: { number: "INV-PORTALCHK-1", subscriptionId: quote.id, customerId: b.id, status: "CONFIRMED", periodStart: when(-30), periodEnd: when(-1), dueDate: when(-5), ...money },
    });
    const draftInv = await db.invoice.create({
      data: { number: "INV-PORTALCHK-2", subscriptionId: quote.id, customerId: b.id, status: "DRAFT", periodStart: when(-60), periodEnd: when(-31), dueDate: when(-35), ...money },
    });

    const a = await db.user.findUniqueOrThrow({ where: { email: "customer@brightloop.test" } });
    const aSub = await db.subscription.findFirstOrThrow({ where: { customerId: a.id, status: { not: "DRAFT" } } });
    const aInv = await db.invoice.findFirstOrThrow({ where: { customerId: a.id, status: { not: "DRAFT" } } });

    const cookieA = await login("customer@brightloop.test");
    const cookieB = await login(email);
    assert.ok(cookieA && cookieB, "both customers can sign in");

    // --- home page: each customer sees their own numbers and none of the other's
    const homeA = await get("/portal", cookieA);
    const homeB = await get("/portal", cookieB);
    assert.equal(homeA.status, 200);
    assert.ok(homeA.html.includes(aSub.number) && homeA.html.includes(aInv.number), "A sees their own rows");
    assert.ok(!homeA.html.includes("PORTALCHK"), "A sees nothing of B");
    assert.ok(homeB.html.includes("SUB-PORTALCHK-Q") && homeB.html.includes("INV-PORTALCHK-1"), "B sees their own rows");
    assert.ok(!homeB.html.includes(aSub.number) && !homeB.html.includes(aInv.number), "B sees nothing of A");
    assert.ok(!homeB.html.includes("SUB-PORTALCHK-D") && !homeB.html.includes("INV-PORTALCHK-2"), "drafts stay hidden from the customer");
    assert.match(homeB.html, /5 days overdue/, "overdue invoice is flagged");

    // --- detail pages: someone else's id (or a draft, or a made-up id) is a plain 404, never 403 or the page
    assert.equal((await get(`/portal/subscriptions/${quote.id}`, cookieA)).status, 404, "A opening B's subscription");
    assert.equal((await get(`/portal/invoices/${inv.id}`, cookieA)).status, 404, "A opening B's invoice");
    assert.equal((await get(`/portal/subscriptions/${aSub.id}`, cookieB)).status, 404, "B opening A's subscription");
    assert.equal((await get(`/portal/invoices/${aInv.id}`, cookieB)).status, 404, "B opening A's invoice");
    assert.equal((await get(`/portal/invoices/${draftInv.id}`, cookieB)).status, 404, "own draft invoice is hidden");
    assert.equal((await get(`/portal/subscriptions/${draftSub.id}`, cookieB)).status, 404, "own draft subscription is hidden");
    assert.equal((await get("/portal/invoices/does-not-exist", cookieB)).status, 404, "unknown id");

    // --- own pages work: invoice has the Print button, quote has the Confirm button
    const invPage = await get(`/portal/invoices/${inv.id}`, cookieB);
    assert.equal(invPage.status, 200);
    assert.ok(invPage.html.includes("INV-PORTALCHK-1") && invPage.html.includes("Print"), "invoice view + print button");
    assert.ok(!invPage.html.includes("Record payment"), "no staff buttons on the customer's invoice");
    const subPage = await get(`/portal/subscriptions/${quote.id}`, cookieB);
    assert.equal(subPage.status, 200);
    assert.ok(subPage.html.includes("Confirm"), "a quote shows the Confirm button");
    assert.ok(!subPage.html.includes("Activate") && !subPage.html.includes("Send quote"), "staff-only actions never shown");

    // --- the action API: B can't touch A's subscription, and can confirm their own quote
    assert.equal((await post(`/api/subscriptions/${aSub.id}/transition`, cookieB, { action: "close" })).status, 404, "B closing A's subscription");
    assert.equal((await post(`/api/subscriptions/${quote.id}/transition`, cookieA, { action: "close" })).status, 404, "A closing B's subscription");
    assert.equal((await post(`/api/subscriptions/${quote.id}/transition`, cookieB, { action: "activate" })).status, 403, "customers can't activate");
    assert.equal((await post(`/api/subscriptions/${quote.id}/transition`, cookieB, { action: "confirm" })).status, 200, "B confirms their own quote");
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: quote.id } })).status, "CONFIRMED");
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: aSub.id } })).status, aSub.status, "A's subscription untouched");

    // --- staff and signed-out visitors don't get the portal
    const staff = await login("staff@brightloop.test");
    assert.equal((await get("/portal", staff)).status, 307, "staff are sent away");
    assert.equal((await get("/portal", "")).status, 307, "signed-out are sent to login");
    console.log("portal ok");
  } finally {
    await db.invoice.deleteMany({ where: { customerId: b.id } });
    await db.subscription.deleteMany({ where: { customerId: b.id } });
    await db.user.delete({ where: { id: b.id } });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
