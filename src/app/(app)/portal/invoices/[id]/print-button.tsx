"use client";
import { Button } from "@/components/ui/button";

// Opens the browser's print dialog. The sidebar and this button hide themselves when printing (print:hidden).
export default function PrintButton() {
  return <Button variant="outline" onClick={() => window.print()}>Print</Button>;
}
