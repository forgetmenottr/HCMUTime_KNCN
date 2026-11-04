import type { IndexedGroup } from "../timing";
import { violates } from "./filter";
import { groupFeatures, type ScoredPick } from "./score";
import type { Preferences } from "./types";

/** One searchable option of a course: a class representative plus its equivalent groups. */
export interface Candidate extends ScoredPick {
  /** Representative: the lexicographically smallest id in its class. */
  group: IndexedGroup;
  /** Keys of the other groups in the class. */
  alternatives: string[];
}

/** Plain code-unit string order (locale-independent, so results are deterministic). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Two groups of a course are equivalent when every score and constraint sees
 * them the same: identical mask words, identical sessions including campus,
 * same language, same program track, same free-seats status and same
 * lecturer-avoid status. (`daysOff` and `partsOff` follow from the sessions.)
 */
export function equivalenceKey(g: IndexedGroup, prefs: Preferences): string {
  const sessions = g.group.sessions
    .map((s) => `${s.day}|${s.periods.join(",")}|${s.weeks.join(",")}|${s.campus}`)
    .sort()
    .join(";");
  return [
    Array.from(g.mask).join(","),
    sessions,
    g.group.language,
    violates("programs", g.group, prefs),
    violates("freeSeats", g.group, prefs),
    violates("avoidLecturers", g.group, prefs),
  ].join("#");
}

/** Classes of equivalent groups; members sorted by id, classes by representative id. */
export function equivalenceClasses(groups: IndexedGroup[], prefs: Preferences): IndexedGroup[][] {
  const classes = new Map<string, IndexedGroup[]>();
  for (const group of groups) {
    const key = equivalenceKey(group, prefs);
    classes.set(key, [...(classes.get(key) ?? []), group]);
  }
  const byId = (a: IndexedGroup, b: IndexedGroup) => compareStrings(a.group.id, b.group.id);
  return [...classes.values()].map((members) => members.sort(byId)).sort((a, b) => byId(a[0], b[0]));
}

/** One candidate per equivalence class, with its scoring features precomputed. */
export function buildCandidates(courseCode: string, groups: IndexedGroup[], prefs: Preferences): Candidate[] {
  return equivalenceClasses(groups, prefs).map(([representative, ...others]) => ({
    courseCode,
    group: representative,
    alternatives: others.map((g) => g.key),
    features: groupFeatures(representative, prefs),
  }));
}
