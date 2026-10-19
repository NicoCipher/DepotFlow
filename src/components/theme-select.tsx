"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
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
  const selectId = useId();
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
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <label htmlFor={selectId} className="!mb-0 text-sm font-semibold text-stone-800">
        Appearance
      </label>
      <select
        id={selectId}
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
