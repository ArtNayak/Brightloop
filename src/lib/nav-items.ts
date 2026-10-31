import type { Role } from "@prisma/client";

// One line per feature, add yours here. Keep one entry per line to avoid merge conflicts.
export const navItems: { href: string; label: string; roles: Role[] }[] = [
  { href: "/reports", label: "Dashboard", roles: ["ADMIN", "STAFF"] },
  { href: "/products", label: "Products", roles: ["ADMIN", "STAFF"] },
  { href: "/plans", label: "Plans", roles: ["ADMIN", "STAFF"] },
  { href: "/discounts", label: "Discounts", roles: ["ADMIN", "STAFF"] },
  { href: "/subscriptions", label: "Subscriptions", roles: ["ADMIN", "STAFF"] },
  { href: "/invoices", label: "Invoices", roles: ["ADMIN", "STAFF"] },
  { href: "/payments", label: "Payments", roles: ["ADMIN", "STAFF"] },
  { href: "/staff", label: "Staff", roles: ["ADMIN"] },
  { href: "/portal", label: "My subscriptions", roles: ["CUSTOMER"] },
];
