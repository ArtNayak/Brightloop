"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// "2026-07" -> "Jul 26"
const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" });

// Bar chart of money collected per month. It is a client component only because recharts draws in the browser.
// Quiet on purpose: a few faint gridlines, no axis lines, the current month in the accent colour and the
// earlier months a paler tint of it. No animation, so it paints immediately.
export default function RevenueChart({ data }: { data: { month: string; revenue: number }[] }) {
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} tickFormatter={label} />
          <YAxis fontSize={11} width={56} tickLine={false} axisLine={false} tickCount={4} />
          <Tooltip cursor={{ fill: "var(--muted)" }} formatter={(v) => Number(v).toFixed(2)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.month} fill={i === data.length - 1 ? "var(--chart-1)" : "var(--chart-2)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
