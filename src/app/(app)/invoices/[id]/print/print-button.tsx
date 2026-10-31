"use client";
import { Button } from "@/components/ui/button";

// Opens the browser's print dialog (which also offers "Save as PDF").
export default function PrintButton() {
  return <Button onClick={() => window.print()}>Print / Save as PDF</Button>;
}
