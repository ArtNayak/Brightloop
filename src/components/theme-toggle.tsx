"use client";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Flips between light and dark. The first visit follows the computer's setting; after a click the choice is remembered.
// It only draws its label once mounted, because the server can't know which theme the visitor has.
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="block text-left underline-offset-2 hover:text-foreground hover:underline"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {mounted ? (dark ? "Light mode" : "Dark mode") : "Theme"}
    </button>
  );
}
