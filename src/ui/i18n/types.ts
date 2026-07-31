export type Locale = "en" | "vi";

/** Inferred from English catalog — add keys in `en.ts` only. */
export type Messages = typeof import("./en.ts").en;

export type MessageKey = keyof Messages;
