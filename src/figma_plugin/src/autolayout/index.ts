// ─────────────────────────────────────────────────
// autolayout/index.ts  –  public re-exports
// ─────────────────────────────────────────────────

export {
  convertToAutoLayout,
  analyzeForAutoLayout,
  convertWithRetry,
} from "./converter";

export type {
  Bounds,
  ChildSnapshot,
  ContainerSnapshot,
  ConversionPlan,
  ConversionResult,
  VerificationError,
  AutoChildPlan,
  AbsoluteChildPlan,
  ConstraintPair,
  SizingPair,
  Direction,
  SizingMode,
  HConstraint,
  VConstraint,
} from "./types";
