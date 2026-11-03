import type { Group } from "./types";

/**
 * Program track ("chương trình đào tạo"). HCMUT encodes it in the leading
 * letters of the theory group code: "L01_L02" → theory group "L01" → "L".
 * An unknown prefix is kept as it is, never dropped.
 */
export function programOf(group: Pick<Group, "theoryGroup">): string {
  return /^[A-Z]+/.exec(group.theoryGroup)?.[0] ?? "";
}

/** The four known program codes, in the order the UI lists them. */
export const PROGRAM_CODES = ["L", "A", "CC", "TN"] as const;

/** Vietnamese name of each known program code. */
export const PROGRAM_LABELS: Record<string, string> = {
  L: "Mainstream Program",
  A: "PFIEV Program / Japan-Oriented Program",
  CC: "Advanced Program (English-taught)",
  TN: "Talented-Student Program",
};

/** Name of a program code; anything unknown (or an empty prefix) is "Khác". */
export function programLabel(code: string): string {
  return PROGRAM_LABELS[code] ?? "Others";
}
