import {
  APP_VERSION,
  GITHUB_LATEST_RELEASE_API,
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
  NPM_LATEST_URL,
  VERSION_CHECK_INTERVAL_MS,
  compareSemver,
  isNewerVersion,
  normalizeVersion,
  parseGithubLatestTag,
  parseNpmLatestVersion,
  releaseTagUrl,
  readVersionCheckCache,
  resolveLatestVersion,
  shouldFetchLatest,
  writeVersionCheckCache,
} from "./appVersion.ts";

describe("normalizeVersion", () => {
  it("strips leading v", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("V2.0.0")).toBe("2.0.0");
    expect(normalizeVersion("1.0.0")).toBe("1.0.0");
  });
});

describe("releaseTagUrl", () => {
  it("builds a tag-specific release URL and normalizes the version", () => {
    expect(releaseTagUrl("1.2.0")).toBe(`${GITHUB_REPO_URL}/releases/tag/1.2.0`);
    expect(releaseTagUrl("v1.2.0")).toBe(`${GITHUB_REPO_URL}/releases/tag/1.2.0`);
  });
});

describe("compareSemver", () => {
  it("orders dotted versions", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
  });

  it("isNewerVersion detects upgrades only", () => {
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });
});

describe("parseGithubLatestTag / parseNpmLatestVersion", () => {
  it("reads release and npm payloads", () => {
    expect(parseGithubLatestTag({ tag_name: "v1.2.3" })).toBe("1.2.3");
    expect(parseGithubLatestTag({ tag_name: "" })).toBeNull();
    expect(parseGithubLatestTag(null)).toBeNull();
    expect(parseNpmLatestVersion({ version: "2.0.1" })).toBe("2.0.1");
    expect(parseNpmLatestVersion({})).toBeNull();
  });
});

describe("shouldFetchLatest", () => {
  it("fetches when cache is missing or older than one hour", () => {
    expect(shouldFetchLatest(null, 1000)).toBe(true);
    expect(
      shouldFetchLatest(
        { checkedAt: 0, latestVersion: "1.0.0" },
        VERSION_CHECK_INTERVAL_MS,
        VERSION_CHECK_INTERVAL_MS
      )
    ).toBe(true);
    expect(
      shouldFetchLatest(
        { checkedAt: 100, latestVersion: "1.0.0" },
        100 + VERSION_CHECK_INTERVAL_MS - 1,
        VERSION_CHECK_INTERVAL_MS
      )
    ).toBe(false);
  });
});

describe("resolveLatestVersion", () => {
  const original = globalThis.localStorage;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return store[key] ?? null;
        },
        setItem(key: string, value: string): void {
          store[key] = value;
        },
        removeItem(key: string): void {
          delete store[key];
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });

  it("uses cache within one hour and skips fetch", async () => {
    writeVersionCheckCache({ checkedAt: 1_000, latestVersion: "9.9.9" });
    let calls = 0;
    const result = await resolveLatestVersion({
      now: 1_000 + VERSION_CHECK_INTERVAL_MS - 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}");
      },
    });
    expect(calls).toBe(0);
    expect(result).toEqual({ latestVersion: "9.9.9", fromCache: true });
  });

  it("fetches GitHub and caches when interval elapsed", async () => {
    writeVersionCheckCache({ checkedAt: 0, latestVersion: "1.0.0" });
    const result = await resolveLatestVersion({
      now: VERSION_CHECK_INTERVAL_MS,
      fetchImpl: async input => {
        const url = String(input);
        if (url.includes("github.com")) {
          return new Response(JSON.stringify({ tag_name: "v1.1.0" }), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });
    expect(result).toEqual({ latestVersion: "1.1.0", fromCache: false });
    expect(readVersionCheckCache()?.latestVersion).toBe("1.1.0");
  });

  it("falls back to npm when GitHub has no release", async () => {
    const result = await resolveLatestVersion({
      now: VERSION_CHECK_INTERVAL_MS,
      fetchImpl: async input => {
        const url = String(input);
        if (url.includes("github.com")) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(JSON.stringify({ version: "1.2.0" }), { status: 200 });
      },
    });
    expect(result.latestVersion).toBe("1.2.0");
  });

  it("exports repo constants", () => {
    expect(GITHUB_REPO_URL).toContain("panda-on-pedal/caro-engine");
    expect(GITHUB_RELEASES_URL).toContain("/releases");
    expect(GITHUB_LATEST_RELEASE_API).toContain("/releases/latest");
    expect(NPM_LATEST_URL).toContain("caro-tournament");
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
