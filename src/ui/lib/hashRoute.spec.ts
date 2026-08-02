// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { parseHash } from "./hashRoute.ts";

describe("hashRoute", () => {
  test("parseHash maps settings, instructions, and falls back to play", () => {
    expect(parseHash("#/settings")).toBe("settings");
    expect(parseHash("#settings")).toBe("settings");
    expect(parseHash("#/instructions")).toBe("instructions");
    expect(parseHash("#instructions")).toBe("instructions");
    expect(parseHash("#/")).toBe("play");
    expect(parseHash("")).toBe("play");
    expect(parseHash("#/other")).toBe("play");
  });
});
