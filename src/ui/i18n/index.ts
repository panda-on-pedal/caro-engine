// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { en } from "./en.ts";
import type { Locale, MessageKey, Messages } from "./types.ts";
import { vi } from "./vi.ts";

const catalogs: Record<Locale, Messages> = { en, vi };

let locale: Locale = "en";

export type { Locale, MessageKey, Messages };
export { en, vi };

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  locale = next;
}

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "vi";
}

/** Simple `{name}` interpolation. Missing keys fall back to English. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs[locale][key] ?? catalogs.en[key] ?? String(key);
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`
  );
}

/** Applies `data-i18n` / `data-i18n-param-*` on elements under `root`. */
export function applyStaticTranslations(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>("[data-i18n]");
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const key = el.dataset.i18n as MessageKey | undefined;
    if (!key) {
      continue;
    }
    const params: Record<string, string | number> = {};
    for (const attr of el.attributes) {
      if (!attr.name.startsWith("data-i18n-param-")) {
        continue;
      }
      const name = attr.name.slice("data-i18n-param-".length);
      params[name] = attr.value;
    }
    const text = t(key, Object.keys(params).length > 0 ? params : undefined);
    if (el instanceof HTMLOptionElement || el.tagName === "OPTION") {
      el.textContent = text;
    } else {
      el.textContent = text;
    }
  }
}
