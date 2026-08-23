// ─────────────────────────────────────────────────
// autolayout/types.ts  –  standalone types (no external imports)
// ─────────────────────────────────────────────────

/** Bounding box relative to parent origin */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snapshot of a child before conversion */
export interface ChildSnapshot {
  nodeId: string;
  name: string;
  index: number;        // original child index (z-order)
  bounds: Bounds;
  nodeType: string;
  /** true if the node is a text node with auto-resize */
  isAutoResizeText: boolean;
  /** true if child is itself a frame with children */
  isContainer: boolean;
}

/** Snapshot of the parent container */
export interface ContainerSnapshot {
  nodeId: string;
  name: string;
  width: number;
  height: number;
  children: ChildSnapshot[];
}

// ── Classification ──────────────────────────────

export type ChildRole = "AUTO" | "ABSOLUTE";

export interface ClassifiedChild {
  snapshot: ChildSnapshot;
  role: ChildRole;
}

// ── Direction / Alignment ───────────────────────

export type Direction = "HORIZONTAL" | "VERTICAL";

export type PrimaryAlign =
  | "MIN"
  | "MAX"
  | "CENTER"
  | "SPACE_BETWEEN";

export type CounterAlign =
  | "MIN"
  | "MAX"
  | "CENTER";

// ── Sizing ──────────────────────────────────────

export type SizingMode = "FIXED" | "HUG" | "FILL";

export interface SizingPair {
  horizontal: SizingMode;
  vertical: SizingMode;
}

// ── Constraints (for ABSOLUTE children) ─────────

export type HConstraint =
  | "MIN"      // left-pinned
  | "MAX"      // right-pinned
  | "CENTER"   // center-width
  | "STRETCH"  // left+right
  | "SCALE";

export type VConstraint =
  | "MIN"      // top-pinned
  | "MAX"      // bottom-pinned
  | "CENTER"   // center-height
  | "STRETCH"  // top+bottom
  | "SCALE";

export interface ConstraintPair {
  horizontal: HConstraint;
  vertical: VConstraint;
}

// ── Conversion Plan (output of analysis) ────────

export interface AutoChildPlan {
  snapshot: ChildSnapshot;
  sizing: SizingPair;
}

export interface AbsoluteChildPlan {
  snapshot: ChildSnapshot;
  constraints: ConstraintPair;
}

export interface ConversionPlan {
  direction: Direction;
  padding: { top: number; right: number; bottom: number; left: number };
  itemSpacing: number;
  primaryAlign: PrimaryAlign;
  counterAlign: CounterAlign;
  containerSizing: SizingPair;
  autoChildren: AutoChildPlan[];        // ordered by position
  absoluteChildren: AbsoluteChildPlan[];
}

// ── Result ──────────────────────────────────────

export interface VerificationError {
  nodeId: string;
  name: string;
  expected: Bounds;
  actual: Bounds;
  deltaX: number;
  deltaY: number;
  deltaW: number;
  deltaH: number;
}

export interface ConversionResult {
  success: boolean;
  plan: ConversionPlan;
  errors: VerificationError[];
}
