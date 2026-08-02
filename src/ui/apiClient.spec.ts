// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { fetchWithRetry } from "./apiClient.ts";

describe("fetchWithRetry", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the response on first success", async () => {
    const response = new Response("ok", { status: 200 });
    global.fetch = jest.fn().mockResolvedValue(response);

    const result = await fetchWithRetry("/api/state");

    expect(result).toBe(response);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network failure and succeeds later", async () => {
    const response = new Response("ok", { status: 200 });
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response);
    const onRetry = jest.fn();

    const result = await fetchWithRetry("/api/state", undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
      onRetry,
    });

    expect(result).toBe(response);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, 3);
  });

  it("throws after exhausting retries", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const onRetry = jest.fn();

    await expect(
      fetchWithRetry("/api/state", undefined, {
        maxAttempts: 2,
        baseDelayMs: 1,
        onRetry,
      })
    ).rejects.toThrow("Failed to fetch");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
