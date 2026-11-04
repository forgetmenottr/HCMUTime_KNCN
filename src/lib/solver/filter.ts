import { programOf, type Group } from "../parser";
import type { IndexedCourse, IndexedGroup } from "../timing";
import { DAY_PARTS } from "./constants";
import { CONSTRAINTS, type ConstraintName, type Mode, type Preferences } from "./types";

/**
 * True unless the user has not chosen anything yet: `programs` and `partsOff`
 * with an empty list cannot filter or penalize, so they are neither applied nor
 * reported as relaxed. (The older constraints keep their Phase 3 behavior.)
 */
export function isActive(name: ConstraintName, prefs: Preferences): boolean {
  if (name === "programs") return prefs.programs.allowed.length > 0;
  if (name === "partsOff") return prefs.partsOff.parts.length > 0;
  return true;
}

/** Constraint names whose mode equals `mode` and that have something selected, in the fixed CONSTRAINTS order. */
export function constraintsWithMode(prefs: Preferences, mode: Mode): ConstraintName[] {
  return CONSTRAINTS.filter((name) => prefs[name].mode === mode && isActive(name, prefs));
}

/** True if `group` breaks the constraint (regardless of its mode). */
export function violates(name: ConstraintName, group: Group, prefs: Preferences): boolean {
  switch (name) {
    case "programs":
      // Nothing chosen yet → no group breaks it.
      return prefs.programs.allowed.length > 0 && !prefs.programs.allowed.includes(programOf(group));
    case "campuses":
      // A session with an unknown campus (null) is not on an allowed campus.
      return group.sessions.some((s) => s.campus === null || !prefs.campuses.allowed.includes(s.campus));
    case "daysOff":
      return group.sessions.some((s) => prefs.daysOff.days.includes(s.day));
    case "partsOff":
      return group.sessions.some((s) =>
        prefs.partsOff.parts.some((off) => {
          if (off.day !== s.day) return false;
          const { first, last } = DAY_PARTS[off.part];
          return s.periods.some((period) => period >= first && period <= last);
        }),
      );
    case "language":
      return !prefs.language.allowed.some((lang) => lang.trim().toUpperCase() === group.language.trim().toUpperCase());
    case "freeSeats":
      return group.registered >= group.capacity;
    case "avoidLecturers":
      return teachesAvoided(group, prefs.avoidLecturers.names);
  }
}

/** Lower-case, strip Vietnamese diacritics (đ → d) and collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True if a name to avoid appears as whole words in the lecturer or lab lecturer field. */
function teachesAvoided(group: Group, names: string[]): boolean {
  const avoided = names.map(normalizeName).filter((name) => name !== "");
  const fields = [group.lecturer, group.labLecturer].filter((f): f is string => f !== null);
  return fields.some((field) => {
    const padded = ` ${normalizeName(field)} `;
    return avoided.some((name) => padded.includes(` ${name} `));
  });
}

/** Groups left after the ALWAYS-hard rules: drop excluded keys; keep only the locked group if any. */
export function applyHardRules(course: IndexedCourse, prefs: Preferences): IndexedGroup[] {
  const excluded = new Set(prefs.excluded);
  const lockedId = prefs.locked[course.code];
  return course.groups.filter((g) => !excluded.has(g.key) && (lockedId === undefined || g.group.id === lockedId));
}

/** Drops groups that break any of the given constraints. */
export function applyConstraints(groups: IndexedGroup[], names: ConstraintName[], prefs: Preferences): IndexedGroup[] {
  return groups.filter((g) => names.every((name) => !violates(name, g.group, prefs)));
}
