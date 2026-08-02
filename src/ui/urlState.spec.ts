// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import {
  getUrlState,
  hydrateFromUrl,
  isMultiAiMode,
  isTournamentMode,
  parseUrlState,
  setUrlState,
  subscribe,
} from "./urlState.ts";

describe("parseUrlState", () => {
  it("reads valid mode and ignores lang", () => {
    expect(parseUrlState("?lang=vi&mode=ai-human")).toEqual({ mode: "ai-human" });
  });

  it("defaults invalid or missing params", () => {
    expect(parseUrlState("")).toEqual({ mode: "human-ai" });
    expect(parseUrlState("?lang=fr&mode=nope")).toEqual({ mode: "human-ai" });
    expect(parseUrlState("?lang=vi")).toEqual({ mode: "human-ai" });
    expect(parseUrlState("?mode=ai-ai")).toEqual({ mode: "ai-ai" });
    expect(parseUrlState("?mode=practice")).toEqual({ mode: "practice" });
  });
});

describe("mode helpers", () => {
  it("treats practice as multi-AI but not tournament", () => {
    expect(isMultiAiMode("practice")).toBe(true);
    expect(isTournamentMode("practice")).toBe(false);
    expect(isTournamentMode("ai-ai")).toBe(true);
  });
});

describe("urlState store", () => {
  let href: string;

  beforeEach(() => {
    href = "http://localhost/?mode=human-ai";
    const location = {
      get href() {
        return href;
      },
      get search() {
        return new URL(href).search;
      },
      get pathname() {
        return new URL(href).pathname;
      },
      get hash() {
        return new URL(href).hash;
      },
    };
    const history = {
      state: {},
      replaceState(_state: unknown, _title: string, url?: string | null): void {
        if (typeof url === "string") {
          href = new URL(url, href).href;
        }
      },
    };
    (globalThis as { window: unknown }).window = { location, history };
    hydrateFromUrl();
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("hydrates from the current URL and strips legacy lang", () => {
    href = "http://localhost/?lang=vi&mode=ai-ai";
    const state = hydrateFromUrl();
    expect(state).toEqual({ mode: "ai-ai" });
    expect(getUrlState()).toEqual({ mode: "ai-ai" });
    expect(href).not.toContain("lang=");
    expect(href).toContain("mode=ai-ai");
  });

  it("notifies subscribers when setUrlState changes mode", () => {
    const seen: Array<{ next: string; prev: string }> = [];
    const unsubscribe = subscribe((next, prev) => {
      seen.push({ next: next.mode, prev: prev.mode });
    });

    setUrlState({ mode: "ai-human" });
    setUrlState({ mode: "ai-human" });

    expect(seen).toEqual([{ next: "ai-human", prev: "human-ai" }]);
    expect(href).toContain("mode=ai-human");
    expect(href).not.toContain("lang=");
    unsubscribe();
  });

  it("hydrateFromUrl with notify fires when the URL changed under us", () => {
    const seen: string[] = [];
    const unsubscribe = subscribe(next => {
      seen.push(next.mode);
    });

    href = "http://localhost/?mode=ai-ai";
    hydrateFromUrl({ notify: true });

    expect(seen).toEqual(["ai-ai"]);
    unsubscribe();
  });
});
