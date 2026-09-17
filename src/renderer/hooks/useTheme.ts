/**
 * Applies the theme setting to the document.
 *
 * Tailwind is configured with `darkMode: "class"`, so everything hangs off one
 * class on `<html>`. "auto" follows the OS and keeps following it: the listener
 * stays attached, so a user whose system flips to dark at sunset does not have
 * to restart the widget to see it.
 */
import { useEffect } from "react";
import type { WidgetSettings } from "@shared/types";

export type ThemePreference = WidgetSettings["theme"];

const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
}

export function useTheme(preference: ThemePreference): void {
  useEffect(() => {
    if (preference !== "auto") {
      apply(preference === "dark");
      return;
    }

    const query = window.matchMedia(DARK_QUERY);
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent): void => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);
}
