import { intersects } from "../timing";
import { compareStrings, type Candidate } from "./equivalence";
import type { Scorer } from "./score";

/** The candidates of one course; `courseIndex` is its position in the solver input. */
export interface Domain {
  courseIndex: number;
  courseCode: string;
  candidates: Candidate[];
}

/** A complete assignment; `picks[i]` belongs to input course i. */
export interface Found {
  penalty: number;
  picks: Candidate[];
}

export interface SearchResult {
  found: Found[];
  nodes: number;
  truncated: boolean;
}

/** Deterministic order: penalty ascending, then pick keys compared course by course. */
export function compareFound(a: Found, b: Found): number {
  if (a.penalty !== b.penalty) return a.penalty - b.penalty;
  for (let i = 0; i < Math.min(a.picks.length, b.picks.length); i++) {
    const order = compareStrings(a.picks[i].group.key, b.picks[i].group.key);
    if (order !== 0) return order;
  }
  return a.picks.length - b.picks.length;
}

/** MRV: fewest candidates first; ties broken by course code. */
export function orderByMrv(domains: Domain[]): Domain[] {
  return [...domains].sort(
    (a, b) => a.candidates.length - b.candidates.length || compareStrings(a.courseCode, b.courseCode),
  );
}

/** Keeps the best `k` entries, sorted by `compareFound`. */
class TopK {
  readonly items: Found[] = [];
  private readonly k: number;

  constructor(k: number) {
    this.k = k;
  }

  /** True if an entry with this penalty and these picks would be kept. */
  accepts(entry: Found): boolean {
    return this.items.length < this.k || compareFound(entry, this.items[this.items.length - 1]) < 0;
  }

  insert(entry: Found): void {
    let at = this.items.length;
    while (at > 0 && compareFound(entry, this.items[at - 1]) < 0) at--;
    this.items.splice(at, 0, entry);
    if (this.items.length > this.k) this.items.pop();
  }
}

/** Number of 32-bit words in a bitset of `size` bits. */
function wordsFor(size: number): number {
  return (size + 31) >>> 5;
}

/**
 * Pairwise compatibility between the candidates of two domains, computed once,
 * as bitsets: for i < j, `table[i][j]` holds one row of `wordsFor(candidates_j)`
 * words per candidate of domain i, starting at `a * wordsFor(candidates_j)`; bit
 * `b` of row `a` is set when candidate `a` of domain i and candidate `b` of
 * domain j share no slot. `table[i][j]` is empty for j <= i.
 */
export function compatibilityTable(domains: Domain[]): Uint32Array[][] {
  return domains.map((earlier, i) =>
    domains.map((later, j) => {
      if (j <= i) return new Uint32Array(0);
      const words = wordsFor(later.candidates.length);
      const table = new Uint32Array(earlier.candidates.length * words);
      earlier.candidates.forEach((a, row) => {
        later.candidates.forEach((b, column) => {
          if (!intersects(a.features.mask, b.features.mask)) table[row * words + (column >>> 5)] |= 1 << (column & 31);
        });
      });
      return table;
    }),
  );
}

/**
 * Depth-first search over `domains` (already in search order), one candidate per
 * course, with forward checking: every course below the current depth keeps the
 * set of its candidates still compatible with all picks above (`live`, narrowed
 * with `compatibilityTable` on each pick), so only live candidates are tried,
 * and a branch is pruned as soon as some later course has none left. Candidates
 * are tried in index order and pruning only skips subtrees with no complete
 * assignment, so the assignments found, and their order, are those of a plain
 * DFS. A node is one candidate tried at some depth; the search stops before node
 * `maxNodes + 1`. Complete assignments are scored incrementally
 * (`Scorer.start`), with the same penalties as `Scorer.penalty`.
 */
export function search(domains: Domain[], scorer: Scorer, topK: number, maxNodes: number): SearchResult {
  const depthCount = domains.length;
  const table = compatibilityTable(domains);
  const words = domains.map((d) => wordsFor(d.candidates.length));
  // live[depth][j] (j >= depth): candidates of domain j compatible with the picks above `depth`.
  const live = domains.map((_, depth) => domains.map((__, j) => new Uint32Array(j >= depth ? words[j] : 0)));
  const chosen: Candidate[] = new Array(depthCount); // by course index (input order)
  const state = scorer.start();
  const top = new TopK(topK);
  let nodes = 0;
  let truncated = false;

  function leaf(penalty: number): void {
    const entry: Found = { penalty, picks: chosen };
    if (top.accepts(entry)) top.insert({ penalty, picks: chosen.slice() });
  }

  /**
   * Narrows every later course's live set to the candidates compatible with
   * candidate `index` of `depth`, into `live[depth + 1]`. False if one is empty.
   */
  function narrow(depth: number, index: number): boolean {
    const from = live[depth];
    const into = live[depth + 1];
    const rows = table[depth];
    for (let j = depth + 1; j < depthCount; j++) {
      const width = words[j];
      const source = from[j];
      const target = into[j];
      const row = rows[j];
      const offset = index * width;
      let any = 0;
      for (let w = 0; w < width; w++) any |= target[w] = source[w] & row[offset + w];
      if (any === 0) return false;
    }
    return true;
  }

  function visit(depth: number): void {
    const { courseIndex, candidates } = domains[depth];
    const own = live[depth][depth];
    const last = depth === depthCount - 1;
    for (let w = 0; w < own.length; w++) {
      let bits = own[w];
      while (bits !== 0) {
        const index = (w << 5) | (31 - Math.clz32(bits & -bits)); // lowest set bit first
        bits &= bits - 1;
        if (nodes >= maxNodes) {
          truncated = true;
          return;
        }
        nodes++;
        const candidate = candidates[index];
        chosen[courseIndex] = candidate;
        if (last) {
          leaf(state.penaltyWith(candidate));
          continue;
        }
        if (!narrow(depth, index)) continue;
        state.push(candidate);
        visit(depth + 1);
        state.pop(candidate);
        if (truncated) return;
      }
    }
  }

  if (depthCount === 0) {
    leaf(state.penaltyWith(null));
  } else if (domains.every((d) => d.candidates.length > 0)) {
    // Before any pick, every candidate is live.
    domains.forEach((d, j) => {
      for (let index = 0; index < d.candidates.length; index++) live[0][j][index >>> 5] |= 1 << (index & 31);
    });
    visit(0);
  }
  return { found: top.items, nodes, truncated };
}
