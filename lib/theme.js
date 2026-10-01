// lib/theme.js
// Tindahan's two looks, Light and Abyss, the dark mode.
// The first time, the app follows the phone's own light or dark setting,
// after the vendor picks one in Account, that choice is remembered.

import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Fills stay the brand colors in both looks, white text sits on them
export const EMERALD = "#059669";
export const INDIGO = "#2563EB";
export const CRIMSON = "#DC2626";

// Everything else changes with the look
export const THEMES = {
  light: {
    outer: "#E2E8F0",     // around the app on a wide PC screen
    page: "#F8FAFC",      // the page, same as the light logo background
    card: "#FFFFFF",
    line: "#E2E8F0",
    subtle: "#F1F5F9",    // small buttons and locked areas
    text: "#1E293B",
    muted: "#64748B",
    strong: "#1E293B",    // selected tabs and switches
    onStrong: "#FFFFFF",  // text on a selected tab
    good: "#059669",      // money in as text
    bad: "#DC2626",       // money out and alerts as text
    accent: "#2563EB",    // premium as text
    goodSoft: "#ECFDF5",
    badSoft: "#FEE2E2",
    accentSoft: "#EFF6FF",
    overlay: "rgba(30, 41, 59, 0.85)",
    statusBar: "dark-content",
  },
  abyss: {
    outer: "#0B1120",
    page: "#1E293B",      // same as the dark logo background
    card: "#0F172A",
    line: "#334155",
    subtle: "#273449",
    text: "#F8FAFC",
    muted: "#94A3B8",
    strong: "#F8FAFC",
    onStrong: "#0F172A",
    good: "#34D399",      // brighter shades of the same colors, readable on dark
    bad: "#F87171",
    accent: "#60A5FA",
    goodSoft: "rgba(5, 150, 105, 0.18)",
    badSoft: "rgba(220, 38, 38, 0.18)",
    accentSoft: "rgba(37, 99, 235, 0.20)",
    overlay: "rgba(2, 6, 23, 0.85)",
    statusBar: "light-content",
  },
};

const STORAGE_KEY = "tindahan_theme";
const ThemeContext = createContext({ mode: "light", colors: THEMES.light, setMode: () => {} });

// Wraps the whole app so every screen shares the same look
export function ThemeProvider({ children }) {
  const phone = useColorScheme();
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === "light" || saved === "abyss") setChosen(saved);
    }).catch(() => {});
  }, []);

  const mode = chosen || (phone === "dark" ? "abyss" : "light");

  function setMode(next) {
    setChosen(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }

  return (
    <ThemeContext.Provider value={{ mode, colors: THEMES[mode], setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

// The current look, its colors, and a way to change it
export function useTheme() {
  return useContext(ThemeContext);
}
