export const GITHUB_REPO_URL = "https://github.com/panda-on-pedal/caro-engine";
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/panda-on-pedal/caro-engine/releases/latest";
export const NPM_LATEST_URL = "https://registry.npmjs.org/caro-tournament/latest";

/** owner/repo path derived from GITHUB_REPO_URL for raw.githubusercontent.com. */
const GITHUB_RAW_REPO = GITHUB_REPO_URL.replace("https://github.com/", "");

/** Injected by Vite from package.json. */
declare const __APP_VERSION__: string;

function resolveBundledVersion(): string {
  if (typeof __APP_VERSION__ === "string" && __APP_VERSION__.length > 0) {
    return __APP_VERSION__;
  }
  return "0.0.0";
}

export const APP_VERSION: string = resolveBundledVersion();

/** GitHub raw base for release-tagged experience books under data/cache/. */
export function experienceCacheBaseUrl(version: string = APP_VERSION): string {
  const tag = normalizeVersion(version);
  return `https://raw.githubusercontent.com/${GITHUB_RAW_REPO}/${tag}/data/cache`;
}

/** Full URL for one difficulty book (e.g. easy.json) on the release tag. */
export function experienceCacheUrl(
  difficulty: string,
  version: string = APP_VERSION
): string {
  return `${experienceCacheBaseUrl(version)}/${difficulty}.json`;
}

export const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STORAGE_KEY = "caro.versionCheck";

export type VersionCheckCache = {
  checkedAt: number;
  latestVersion: string | null;
};

/** Strip a leading `v` / `V` from a tag or version string. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^[vV]/, "");
}

/** Build the GitHub release-notes URL for a specific version tag. */
export function releaseTagUrl(version: string): string {
  return `${GITHUB_REPO_URL}/releases/tag/${normalizeVersion(version)}`;
}

/**
 * Compare two dotted numeric versions (e.g. 1.2.3).
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Non-numeric segments compare as 0.
 */
export function compareSemver(a: string, b: string): number {
  const left = normalizeVersion(a).split(".");
  const right = normalizeVersion(b).split(".");
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = Number.parseInt(left[i] ?? "0", 10);
    const r = Number.parseInt(right[i] ?? "0", 10);
    const lv = Number.isFinite(l) ? l : 0;
    const rv = Number.isFinite(r) ? r : 0;
    if (lv !== rv) {
      return lv - rv;
    }
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

export function readVersionCheckCache(): VersionCheckCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.checkedAt !== "number") {
      return null;
    }
    const latestVersion =
      record.latestVersion === null
        ? null
        : typeof record.latestVersion === "string"
          ? record.latestVersion
          : null;
    return { checkedAt: record.checkedAt, latestVersion };
  } catch {
    return null;
  }
}

export function writeVersionCheckCache(cache: VersionCheckCache): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

export function shouldFetchLatest(
  cache: VersionCheckCache | null,
  now = Date.now(),
  intervalMs = VERSION_CHECK_INTERVAL_MS
): boolean {
  if (!cache) {
    return true;
  }
  return now - cache.checkedAt >= intervalMs;
}

/** Parse `tag_name` from a GitHub releases/latest JSON body. */
export function parseGithubLatestTag(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const tag = (payload as Record<string, unknown>).tag_name;
  if (typeof tag !== "string" || tag.trim() === "") {
    return null;
  }
  return normalizeVersion(tag);
}

/** Parse `version` from an npm registry `/latest` JSON body. */
export function parseNpmLatestVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const version = (payload as Record<string, unknown>).version;
  if (typeof version !== "string" || version.trim() === "") {
    return null;
  }
  return normalizeVersion(version);
}

export type LatestVersionResult = {
  latestVersion: string | null;
  fromCache: boolean;
};

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  headers?: Record<string, string>
): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url, headers ? { headers } : undefined);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Resolve the latest published version (GitHub release, then npm fallback).
 * Results are cached for at least one hour so we do not hammer the APIs.
 */
export async function resolveLatestVersion(options?: {
  fetchImpl?: typeof fetch;
  now?: number;
  githubApiUrl?: string;
  npmUrl?: string;
}): Promise<LatestVersionResult> {
  const now = options?.now ?? Date.now();
  const cache = readVersionCheckCache();
  if (!shouldFetchLatest(cache, now)) {
    return { latestVersion: cache?.latestVersion ?? null, fromCache: true };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const githubApiUrl = options?.githubApiUrl ?? GITHUB_LATEST_RELEASE_API;
  const npmUrl = options?.npmUrl ?? NPM_LATEST_URL;

  const githubPayload = await fetchJson(fetchImpl, githubApiUrl, {
    Accept: "application/vnd.github+json",
  });
  let latestVersion = parseGithubLatestTag(githubPayload);

  if (!latestVersion) {
    const npmPayload = await fetchJson(fetchImpl, npmUrl);
    latestVersion = parseNpmLatestVersion(npmPayload);
  }

  if (!latestVersion) {
    latestVersion = cache?.latestVersion ?? null;
  }

  writeVersionCheckCache({ checkedAt: now, latestVersion });
  return { latestVersion, fromCache: false };
}
