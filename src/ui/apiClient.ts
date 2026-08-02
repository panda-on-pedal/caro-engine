// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

const DEFAULT_MAX_ATTEMPTS = 50;
const DEFAULT_BASE_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface FetchRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

/** Fetches with exponential backoff when the network fails or the server
 * returns 5xx. Throws the last error after `maxAttempts` is exhausted. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchRetryOptions
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) {
        return response;
      }
      if (response.status >= 500 && attempt < maxAttempts) {
        options?.onRetry?.(attempt, maxAttempts);
        await delay(baseDelayMs * attempt);
        continue;
      }
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < maxAttempts) {
        options?.onRetry?.(attempt, maxAttempts);
        await delay(baseDelayMs * attempt);
        continue;
      }
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        options?.onRetry?.(attempt, maxAttempts);
        await delay(baseDelayMs * attempt);
        continue;
      }
    }
  }

  throw lastError;
}
