"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/domain/theme";

const storageKey = "depotflow-appearance";
const themeEvent = "depotflow-appearance-change";
let tabOnlyPreference: ThemePreference | null = null;

function readPreference(): ThemePreference {
  try {
    return tabOnlyPreference ?? parseThemePreference(window.localStorage.getItem(storageKey));
  } catch {
    return tabOnlyPreference ?? "system";
  }
}

function subscribePreference(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(themeEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(themeEvent, notify);
  };
}

function applyTheme(preference: ThemePreference) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = resolveTheme(preference, dark);
}

export function ThemeSelect() {
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => "system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(readPreference());
    media.addEventListener("change", update);
    window.addEventListener("storage", update);
    update();
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", update);
    };
  }, []);

  function choose(preference: ThemePreference) {
    try {
      window.localStorage.setItem(storageKey, preference);
      tabOnlyPreference = null;
    } catch {
      // Some browsers allow reading storage but deny writes. Keep this tab's
      // preference until the page closes, including on system-theme changes.
      tabOnlyPreference = preference;
    }
    applyTheme(preference);
    window.dispatchEvent(new Event(themeEvent));
  }

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <label htmlFor="appearance" className="!mb-0 hidden text-xs text-stone-600 sm:block">
        Theme
      </label>
      <select
        id="appearance"
        className="theme-select"
        aria-label="Appearance theme"
        value={preference}
        onChange={(event) => choose(event.target.value as ThemePreference)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
