// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

export type Locale = "en" | "vi";

/** Inferred from English catalog — add keys in `en.ts` only. */
export type Messages = typeof import("./en.ts").en;

export type MessageKey = keyof Messages;
