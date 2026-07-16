import { useEffect } from "react";

const THEMES = ["theme-mvola", "theme-domino", "theme-ludo", "theme-petanque"];

export function useThemeClass(theme: "mvola" | "domino" | "ludo" | "petanque" | null) {
  useEffect(() => {
    const el = document.documentElement;
    THEMES.forEach((t) => el.classList.remove(t));
    if (theme) el.classList.add(`theme-${theme}`);
    return () => {
      THEMES.forEach((t) => el.classList.remove(t));
    };
  }, [theme]);
}
