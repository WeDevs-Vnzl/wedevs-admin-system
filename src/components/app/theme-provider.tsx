"use client";

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

// Class strategy (`.dark` on <html>), light/dark/system, persisted locally (PRD §7.8).
// suppressHydrationWarning on <html> in the root layout prevents a flash of the wrong theme.
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
