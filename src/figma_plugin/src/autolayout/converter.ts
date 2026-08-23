// ─────────────────────────────────────────────────
// autolayout/converter.ts
//
// Standalone non-autolayout → autolayout converter.
// No imports from existing project code.
// Only depends on Figma Plugin API globals + ./types.
// ─────────────────────────────────────────────────

import type {
  Bounds,
  ChildSnapshot,
  ContainerSnapshot,
  ClassifiedChild,
  Direction,
  PrimaryAlign,
  CounterAlign,
  SizingMode,
  SizingPair,
  HConstraint,
  VConstraint,
  ConstraintPair,
  AutoChildPlan,
  AbsoluteChildPlan,
  ConversionPlan,
  ConversionResult,
  VerificationError,
} from "./types";

// ═════════════════════════════════════════════════
// Phase 0 – Snapshot
// ═════════════════════════════════════════════════

function snapshotChild(node: SceneNode, index: number): ChildSnapshot {
  const b: Bounds = { x: node.x, y: node.y, w: node.width, h: node.height };

  const isAutoResizeText =
    node.type === "TEXT" &&
    (node as TextNode).textAutoResize !== "NONE";

  const isContainer =
    (node.type === "FRAME" ||
      node.type === "COMPONENT" ||
      node.type === "INSTANCE") &&
    "children" in node &&
    (node as FrameNode).children.length > 0;

  return {
    nodeId: node.id,
    name: node.name,
    index,
    bounds: b,
    nodeType: node.type,
    isAutoResizeText,
    isContainer,
  };
}

function snapshotContainer(frame: FrameNode | ComponentNode | InstanceNode): ContainerSnapshot {
  const children: ChildSnapshot[] = [];
  for (let i = 0; i < frame.children.length; i++) {
    children.push(snapshotChild(frame.children[i], i));
  }
  return {
    nodeId: frame.id,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    children,
  };
}

// ═════════════════════════════════════════════════
// Phase 1 – Overlap detection
// ═════════════════════════════════════════════════

const EPS = 0.5; // half-pixel tolerance for overlap detection

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.w - EPS &&
    b.x < a.x + a.w - EPS &&
    a.y < b.y + b.h - EPS &&
    b.y < a.y + a.h - EPS
  );
}

/** Build overlap adjacency: overlapMap[i] = set of indices that i overlaps */
function buildOverlapMap(children: ChildSnapshot[]): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (let i = 0; i < children.length; i++) {
    map.set(i, new Set());
  }
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      if (boundsOverlap(children[i].bounds, children[j].bounds)) {
        map.get(i)!.add(j);
        map.get(j)!.add(i);
      }
    }
  }
  return map;
}

// ═════════════════════════════════════════════════
// Phase 2 – Direction detection + classification
// ═════════════════════════════════════════════════

interface DirectionCandidate {
  direction: Direction;
  autoIndices: number[];
  absoluteIndices: number[];
  gaps: number[];
  sortedAutoSnapshots: ChildSnapshot[];
}

/**
 * Try a direction: greedily build longest non-overlapping sequence
 * sorted by primary-axis position. Higher z-order children (later index)
 * are preferred for ABSOLUTE when conflicts arise.
 */
function tryDirection(
  children: ChildSnapshot[],
  overlapMap: Map<number, Set<number>>,
  direction: Direction,
): DirectionCandidate {
  const primary = direction === "HORIZONTAL" ? "x" : "y";
  const primarySize = direction === "HORIZONTAL" ? "w" : "h";

  // Sort by primary-axis position (stable sort preserves z-order for ties)
  const sorted = [...children].sort(
    (a, b) => a.bounds[primary] - b.bounds[primary],
  );

  const autoSet = new Set<number>();   // indices into original children[]
  const absoluteSet = new Set<number>();

  // Greedy: iterate sorted by position, add to AUTO if no overlap with existing AUTO members
  for (const child of sorted) {
    const idx = child.index;
    let overlapsWithAuto = false;
    for (const autoIdx of autoSet) {
      if (overlapMap.get(idx)!.has(autoIdx)) {
        overlapsWithAuto = true;
        break;
      }
    }
    if (!overlapsWithAuto) {
      autoSet.add(idx);
    } else {
      absoluteSet.add(idx);
    }
  }

  // Re-sort AUTO children by primary axis
  const sortedAuto = sorted.filter((c) => autoSet.has(c.index));

  // Check sequential non-overlap along primary axis
  // (greedy might have picked children that aren't sequentially non-overlapping)
  const finalAuto: ChildSnapshot[] = [];
  for (const child of sortedAuto) {
    if (finalAuto.length === 0) {
      finalAuto.push(child);
      continue;
    }
    const prev = finalAuto[finalAuto.length - 1];
    const gap =
      child.bounds[primary] - (prev.bounds[primary] + prev.bounds[primarySize]);
    if (gap < -EPS) {
      // overlapping along primary axis → demote to ABSOLUTE
      absoluteSet.add(child.index);
      autoSet.delete(child.index);
    } else {
      finalAuto.push(child);
    }
  }

  // Compute gaps
  const gaps: number[] = [];
  for (let i = 0; i < finalAuto.length - 1; i++) {
    const curr = finalAuto[i];
    const next = finalAuto[i + 1];
    gaps.push(
      next.bounds[primary] - (curr.bounds[primary] + curr.bounds[primarySize]),
    );
  }

  return {
    direction,
    autoIndices: finalAuto.map((c) => c.index),
    absoluteIndices: [...absoluteSet],
    gaps,
    sortedAutoSnapshots: finalAuto,
  };
}

// ═════════════════════════════════════════════════
// Phase 3 – Gap uniformity + re-classification
// ═════════════════════════════════════════════════

/**
 * Enforce uniform gap. If gaps differ, remove outlier children
 * from AUTO until all remaining gaps are identical.
 */
function enforceUniformGap(candidate: DirectionCandidate): DirectionCandidate {
  const { direction, gaps, sortedAutoSnapshots } = candidate;
  if (gaps.length <= 1) return candidate;

  const primary = direction === "HORIZONTAL" ? "x" : "y";
  const primarySize = direction === "HORIZONTAL" ? "w" : "h";

  // Find dominant gap (mode)
  const gapCounts = new Map<number, number>();
  for (const g of gaps) {
    const rounded = Math.round(g * 100) / 100; // avoid float noise
    gapCounts.set(rounded, (gapCounts.get(rounded) ?? 0) + 1);
  }
  let dominantGap = 0;
  let maxCount = 0;
  for (const [g, count] of gapCounts) {
    if (count > maxCount) {
      dominantGap = g;
      maxCount = count;
    }
  }

  // Iteratively remove children that create non-dominant gaps
  let auto = [...sortedAutoSnapshots];
  let absIndices = new Set(candidate.absoluteIndices);

  let changed = true;
  while (changed && auto.length > 1) {
    changed = false;
    const currentGaps: number[] = [];
    for (let i = 0; i < auto.length - 1; i++) {
      const curr = auto[i];
      const next = auto[i + 1];
      currentGaps.push(
        next.bounds[primary] -
          (curr.bounds[primary] + curr.bounds[primarySize]),
      );
    }

    // Check all gaps match dominant
    for (let i = currentGaps.length - 1; i >= 0; i--) {
      const rounded = Math.round(currentGaps[i] * 100) / 100;
      if (Math.abs(rounded - dominantGap) > 0.01) {
        // Remove the child AFTER this gap (higher z-order more likely decorative)
        const removed = auto[i + 1];
        absIndices.add(removed.index);
        auto.splice(i + 1, 1);
        changed = true;
        break; // restart gap check
      }
    }
  }

  // Recompute gaps
  const finalGaps: number[] = [];
  for (let i = 0; i < auto.length - 1; i++) {
    finalGaps.push(
      auto[i + 1].bounds[primary] -
        (auto[i].bounds[primary] + auto[i].bounds[primarySize]),
    );
  }

  return {
    direction,
    autoIndices: auto.map((c) => c.index),
    absoluteIndices: [...absIndices],
    gaps: finalGaps,
    sortedAutoSnapshots: auto,
  };
}

// ═════════════════════════════════════════════════
// Phase 4+5 – Padding & Alignment
// ═════════════════════════════════════════════════

interface PaddingAndAlign {
  padding: { top: number; right: number; bottom: number; left: number };
  primaryAlign: PrimaryAlign;
  counterAlign: CounterAlign;
}

function computePaddingAndAlign(
  container: ContainerSnapshot,
  candidate: DirectionCandidate,
): PaddingAndAlign {
  const auto = candidate.sortedAutoSnapshots;
  const dir = candidate.direction;

  if (auto.length === 0) {
    return {
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      primaryAlign: "MIN",
      counterAlign: "MIN",
    };
  }

  let paddingLeft: number,
    paddingRight: number,
    paddingTop: number,
    paddingBottom: number;
  let primaryAlign: PrimaryAlign = "MIN";
  let counterAlign: CounterAlign = "MIN";

  if (dir === "HORIZONTAL") {
    // ── Primary axis (horizontal) ────────────
    paddingLeft = auto[0].bounds.x;
    paddingRight =
      container.width -
      (auto[auto.length - 1].bounds.x + auto[auto.length - 1].bounds.w);

    // Primary alignment heuristic
    if (auto.length >= 2) {
      const diff = Math.abs(paddingLeft - paddingRight);
      if (diff < 1) {
        primaryAlign = "CENTER";
      } else if (paddingLeft <= paddingRight) {
        primaryAlign = "MIN";
      } else {
        primaryAlign = "MAX";
      }
    }

    // ── Counter axis (vertical) ──────────────
    const tops = auto.map((c) => c.bounds.y);
    const bottoms = auto.map((c) => c.bounds.y + c.bounds.h);
    const centers = auto.map((c) => c.bounds.y + c.bounds.h / 2);

    const allTopsEqual = tops.every((t) => Math.abs(t - tops[0]) < EPS);
    const allBottomsEqual = bottoms.every(
      (b) => Math.abs(b - bottoms[0]) < EPS,
    );
    const allCentersEqual = centers.every(
      (c) => Math.abs(c - centers[0]) < EPS,
    );

    if (allTopsEqual && allBottomsEqual) {
      // All same height, same position → check which alignment
      paddingTop = tops[0];
      paddingBottom = container.height - bottoms[0];
      if (Math.abs(paddingTop - paddingBottom) < 1) {
        counterAlign = "CENTER";
      } else if (paddingTop <= paddingBottom) {
        counterAlign = "MIN";
      } else {
        counterAlign = "MAX";
      }
    } else if (allTopsEqual) {
      counterAlign = "MIN";
      paddingTop = tops[0];
      paddingBottom = container.height - Math.max(...bottoms);
    } else if (allBottomsEqual) {
      counterAlign = "MAX";
      paddingTop = container.height - Math.max(...tops.map((_, i) => bottoms[i]));
      paddingBottom = container.height - bottoms[0];
    } else if (allCentersEqual) {
      counterAlign = "CENTER";
      const maxH = Math.max(...auto.map((c) => c.bounds.h));
      paddingTop = centers[0] - maxH / 2;
      paddingBottom = container.height - (centers[0] + maxH / 2);
    } else {
      // Fallback: use MIN with min top
      counterAlign = "MIN";
      paddingTop = Math.min(...tops);
      paddingBottom = container.height - Math.max(...bottoms);
    }
  } else {
    // ── VERTICAL ─────────────────────────────
    paddingTop = auto[0].bounds.y;
    paddingBottom =
      container.height -
      (auto[auto.length - 1].bounds.y + auto[auto.length - 1].bounds.h);

    if (auto.length >= 2) {
      const diff = Math.abs(paddingTop - paddingBottom);
      if (diff < 1) {
        primaryAlign = "CENTER";
      } else if (paddingTop <= paddingBottom) {
        primaryAlign = "MIN";
      } else {
        primaryAlign = "MAX";
      }
    }

    // Counter axis (horizontal)
    const lefts = auto.map((c) => c.bounds.x);
    const rights = auto.map((c) => c.bounds.x + c.bounds.w);
    const centers = auto.map((c) => c.bounds.x + c.bounds.w / 2);

    const allLeftsEqual = lefts.every((l) => Math.abs(l - lefts[0]) < EPS);
    const allRightsEqual = rights.every(
      (r) => Math.abs(r - rights[0]) < EPS,
    );
    const allCentersEqual = centers.every(
      (c) => Math.abs(c - centers[0]) < EPS,
    );

    if (allLeftsEqual && allRightsEqual) {
      paddingLeft = lefts[0];
      paddingRight = container.width - rights[0];
      if (Math.abs(paddingLeft - paddingRight) < 1) {
        counterAlign = "CENTER";
      } else if (paddingLeft <= paddingRight) {
        counterAlign = "MIN";
      } else {
        counterAlign = "MAX";
      }
    } else if (allLeftsEqual) {
      counterAlign = "MIN";
      paddingLeft = lefts[0];
      paddingRight = container.width - Math.max(...rights);
    } else if (allRightsEqual) {
      counterAlign = "MAX";
      paddingLeft = container.width - Math.max(...rights);
      paddingRight = container.width - rights[0];
    } else if (allCentersEqual) {
      counterAlign = "CENTER";
      const maxW = Math.max(...auto.map((c) => c.bounds.w));
      paddingLeft = centers[0] - maxW / 2;
      paddingRight = container.width - (centers[0] + maxW / 2);
    } else {
      counterAlign = "MIN";
      paddingLeft = Math.min(...lefts);
      paddingRight = container.width - Math.max(...rights);
    }
  }

  // Clamp negative paddings to 0 (child extending beyond parent)
  paddingTop = Math.max(0, paddingTop);
  paddingRight = Math.max(0, paddingRight);
  paddingBottom = Math.max(0, paddingBottom);
  paddingLeft = Math.max(0, paddingLeft);

  return {
    padding: {
      top: Math.round(paddingTop * 100) / 100,
      right: Math.round(paddingRight * 100) / 100,
      bottom: Math.round(paddingBottom * 100) / 100,
      left: Math.round(paddingLeft * 100) / 100,
    },
    primaryAlign,
    counterAlign,
  };
}

// ═════════════════════════════════════════════════
// Phase 6 – Sizing modes
// ═════════════════════════════════════════════════

function computeContainerSizing(
  container: ContainerSnapshot,
  candidate: DirectionCandidate,
  padding: PaddingAndAlign["padding"],
  itemSpacing: number,
): SizingPair {
  const auto = candidate.sortedAutoSnapshots;
  const dir = candidate.direction;

  // Primary axis: HUG if container size == content + padding + gaps
  let primaryContentSize: number;
  if (dir === "HORIZONTAL") {
    primaryContentSize =
      auto.reduce((sum, c) => sum + c.bounds.w, 0) +
      itemSpacing * Math.max(0, auto.length - 1) +
      padding.left +
      padding.right;
    const counterContentSize =
      Math.max(...auto.map((c) => c.bounds.h), 0) +
      padding.top +
      padding.bottom;

    return {
      horizontal:
        Math.abs(container.width - primaryContentSize) < 1 ? "HUG" : "FIXED",
      vertical:
        Math.abs(container.height - counterContentSize) < 1 ? "HUG" : "FIXED",
    };
  } else {
    primaryContentSize =
      auto.reduce((sum, c) => sum + c.bounds.h, 0) +
      itemSpacing * Math.max(0, auto.length - 1) +
      padding.top +
      padding.bottom;
    const counterContentSize =
      Math.max(...auto.map((c) => c.bounds.w), 0) +
      padding.left +
      padding.right;

    return {
      horizontal:
        Math.abs(container.width - counterContentSize) < 1 ? "HUG" : "FIXED",
      vertical:
        Math.abs(container.height - primaryContentSize) < 1 ? "HUG" : "FIXED",
    };
  }
}

function computeChildSizing(
  child: ChildSnapshot,
  container: ContainerSnapshot,
  direction: Direction,
  padding: PaddingAndAlign["padding"],
  autoChildren: ChildSnapshot[],
): SizingPair {
  const availCrossW = container.width - padding.left - padding.right;
  const availCrossH = container.height - padding.top - padding.bottom;

  if (direction === "HORIZONTAL") {
    // Cross axis = vertical
    const vMode: SizingMode =
      Math.abs(child.bounds.h - availCrossH) < 1 ? "FILL" : "FIXED";

    // Primary axis = horizontal
    // FILL: all AUTO children same width & fill available space
    const allSameW = autoChildren.every(
      (c) => Math.abs(c.bounds.w - child.bounds.w) < 1,
    );
    const hMode: SizingMode =
      allSameW && autoChildren.length > 1 ? "FILL" : "FIXED";

    return { horizontal: hMode, vertical: vMode };
  } else {
    // Cross axis = horizontal
    const hMode: SizingMode =
      Math.abs(child.bounds.w - availCrossW) < 1 ? "FILL" : "FIXED";

    const allSameH = autoChildren.every(
      (c) => Math.abs(c.bounds.h - child.bounds.h) < 1,
    );
    const vMode: SizingMode =
      allSameH && autoChildren.length > 1 ? "FILL" : "FIXED";

    return { horizontal: hMode, vertical: vMode };
  }
}

// ═════════════════════════════════════════════════
// Phase 7 – Constraints for ABSOLUTE children
// ═════════════════════════════════════════════════

function computeConstraints(
  child: ChildSnapshot,
  container: ContainerSnapshot,
): ConstraintPair {
  const b = child.bounds;
  const pw = container.width;
  const ph = container.height;

  const leftDist = b.x;
  const rightDist = pw - (b.x + b.w);
  const topDist = b.y;
  const bottomDist = ph - (b.y + b.h);

  // ── Horizontal ────────────────────────────
  let horizontal: HConstraint;
  const hCenter = Math.abs(b.x + b.w / 2 - pw / 2);

  if (
    leftDist >= 0 &&
    rightDist >= 0 &&
    Math.abs(leftDist - rightDist) < Math.max(pw * 0.05, 2)
  ) {
    // Both edges roughly equidistant → check STRETCH vs CENTER
    if (b.w / pw > 0.8) {
      horizontal = "STRETCH";
    } else {
      horizontal = "CENTER";
    }
  } else if (hCenter < Math.max(pw * 0.05, 2)) {
    horizontal = "CENTER";
  } else if (leftDist <= rightDist) {
    horizontal = "MIN";
  } else {
    horizontal = "MAX";
  }

  // ── Vertical ──────────────────────────────
  let vertical: VConstraint;
  const vCenter = Math.abs(b.y + b.h / 2 - ph / 2);

  if (
    topDist >= 0 &&
    bottomDist >= 0 &&
    Math.abs(topDist - bottomDist) < Math.max(ph * 0.05, 2)
  ) {
    if (b.h / ph > 0.8) {
      vertical = "STRETCH";
    } else {
      vertical = "CENTER";
    }
  } else if (vCenter < Math.max(ph * 0.05, 2)) {
    vertical = "CENTER";
  } else if (topDist <= bottomDist) {
    vertical = "MIN";
  } else {
    vertical = "MAX";
  }

  return { horizontal, vertical };
}

// ═════════════════════════════════════════════════
// Plan builder  (Phases 0-7 combined)
// ═════════════════════════════════════════════════

function buildPlan(container: ContainerSnapshot): ConversionPlan {
  const { children } = container;

  // Edge case: 0 or 1 children
  if (children.length === 0) {
    return {
      direction: "VERTICAL",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      itemSpacing: 0,
      primaryAlign: "MIN",
      counterAlign: "MIN",
      containerSizing: { horizontal: "FIXED", vertical: "FIXED" },
      autoChildren: [],
      absoluteChildren: [],
    };
  }

  const overlapMap = buildOverlapMap(children);

  // Try both directions
  let hCandidate = tryDirection(children, overlapMap, "HORIZONTAL");
  let vCandidate = tryDirection(children, overlapMap, "VERTICAL");

  // Enforce uniform gap
  hCandidate = enforceUniformGap(hCandidate);
  vCandidate = enforceUniformGap(vCandidate);

  // Pick direction with more AUTO children
  let best: DirectionCandidate;
  if (hCandidate.autoIndices.length > vCandidate.autoIndices.length) {
    best = hCandidate;
  } else if (vCandidate.autoIndices.length > hCandidate.autoIndices.length) {
    best = vCandidate;
  } else {
    // Tie: prefer VERTICAL (more common in slide layouts)
    best = vCandidate;
  }

  // Item spacing
  const itemSpacing =
    best.gaps.length > 0 ? Math.round(best.gaps[0] * 100) / 100 : 0;

  // Padding & alignment
  const { padding, primaryAlign, counterAlign } = computePaddingAndAlign(
    container,
    best,
  );

  // Container sizing
  const containerSizing = computeContainerSizing(
    container,
    best,
    padding,
    itemSpacing,
  );

  // Child sizing (AUTO children)
  const autoChildren: AutoChildPlan[] = best.sortedAutoSnapshots.map((snap) => ({
    snapshot: snap,
    sizing: computeChildSizing(
      snap,
      container,
      best.direction,
      padding,
      best.sortedAutoSnapshots,
    ),
  }));

  // Constraints (ABSOLUTE children)
  const absoluteChildren: AbsoluteChildPlan[] = best.absoluteIndices.map(
    (idx) => {
      const snap = children[idx];
      return {
        snapshot: snap,
        constraints: computeConstraints(snap, container),
      };
    },
  );

  return {
    direction: best.direction,
    padding,
    itemSpacing,
    primaryAlign,
    counterAlign,
    containerSizing,
    autoChildren,
    absoluteChildren,
  };
}

// ═════════════════════════════════════════════════
// Phase 8 – Apply plan to Figma nodes
// ═════════════════════════════════════════════════

function applyPlan(
  frame: FrameNode | ComponentNode | InstanceNode,
  plan: ConversionPlan,
  originalSnapshots: Map<string, Bounds>,
): void {
  // 8-1. Set layout mode
  frame.layoutMode = plan.direction;

  // 8-2. Padding
  frame.paddingTop = plan.padding.top;
  frame.paddingRight = plan.padding.right;
  frame.paddingBottom = plan.padding.bottom;
  frame.paddingLeft = plan.padding.left;

  // 8-3. Item spacing
  frame.itemSpacing = plan.itemSpacing;

  // 8-4. Alignment
  frame.primaryAxisAlignItems = plan.primaryAlign;
  frame.counterAxisAlignItems = plan.counterAlign;

  // 8-5. Container sizing
  frame.layoutSizingHorizontal = plan.containerSizing.horizontal;
  frame.layoutSizingVertical = plan.containerSizing.vertical;

  // 8-6. Reorder children to match AUTO-first order
  //       AUTO children in their sorted order, then ABSOLUTE children
  const autoIds = new Set(plan.autoChildren.map((c) => c.snapshot.nodeId));
  const nodeById = new Map<string, SceneNode>();
  for (const child of frame.children) {
    nodeById.set(child.id, child);
  }

  // Reorder: AUTO children first (in positional order), then ABSOLUTE (original z-order)
  let insertIndex = 0;
  for (const autoPlan of plan.autoChildren) {
    const node = nodeById.get(autoPlan.snapshot.nodeId);
    if (node) {
      frame.insertChild(insertIndex, node);
      insertIndex++;
    }
  }
  // ABSOLUTE children after (preserve original z-order)
  const sortedAbsolute = [...plan.absoluteChildren].sort(
    (a, b) => a.snapshot.index - b.snapshot.index,
  );
  for (const absPlan of sortedAbsolute) {
    const node = nodeById.get(absPlan.snapshot.nodeId);
    if (node) {
      frame.insertChild(insertIndex, node);
      insertIndex++;
    }
  }

  // 8-7. Set AUTO children properties
  for (const autoPlan of plan.autoChildren) {
    const node = nodeById.get(autoPlan.snapshot.nodeId);
    if (!node) continue;

    if ("layoutPositioning" in node) {
      (node as any).layoutPositioning = "AUTO";
    }

    // Sizing (FILL must be set after node is in autolayout parent)
    if ("layoutSizingHorizontal" in node) {
      (node as any).layoutSizingHorizontal = autoPlan.sizing.horizontal;
    }
    if ("layoutSizingVertical" in node) {
      (node as any).layoutSizingVertical = autoPlan.sizing.vertical;
    }
  }

  // 8-8. Set ABSOLUTE children properties
  for (const absPlan of plan.absoluteChildren) {
    const node = nodeById.get(absPlan.snapshot.nodeId);
    if (!node) continue;

    if ("layoutPositioning" in node) {
      (node as any).layoutPositioning = "ABSOLUTE";
    }

    // Restore original position (absolute children need explicit x/y)
    const orig = originalSnapshots.get(absPlan.snapshot.nodeId);
    if (orig) {
      node.x = orig.x;
      node.y = orig.y;
      node.resize(orig.w, orig.h);
    }

    // Constraints
    if ("constraints" in node) {
      (node as any).constraints = {
        horizontal: absPlan.constraints.horizontal,
        vertical: absPlan.constraints.vertical,
      };
    }
  }
}

// ═════════════════════════════════════════════════
// Phase 9 – Verification
// ═════════════════════════════════════════════════

function verify(
  frame: FrameNode | ComponentNode | InstanceNode,
  originalSnapshots: Map<string, Bounds>,
): VerificationError[] {
  const errors: VerificationError[] = [];

  for (const child of frame.children) {
    const orig = originalSnapshots.get(child.id);
    if (!orig) continue;

    const actual: Bounds = {
      x: child.x,
      y: child.y,
      w: child.width,
      h: child.height,
    };

    const dx = Math.abs(actual.x - orig.x);
    const dy = Math.abs(actual.y - orig.y);
    const dw = Math.abs(actual.w - orig.w);
    const dh = Math.abs(actual.h - orig.h);

    if (dx > 0.5 || dy > 0.5 || dw > 0.5 || dh > 0.5) {
      errors.push({
        nodeId: child.id,
        name: child.name,
        expected: orig,
        actual,
        deltaX: dx,
        deltaY: dy,
        deltaW: dw,
        deltaH: dh,
      });
    }
  }

  return errors;
}

// ═════════════════════════════════════════════════
// Rollback
// ═════════════════════════════════════════════════

function rollback(
  frame: FrameNode | ComponentNode | InstanceNode,
  originalSnapshots: Map<string, Bounds>,
  originalChildOrder: string[],
): void {
  frame.layoutMode = "NONE";

  // Restore child order
  const nodeById = new Map<string, SceneNode>();
  for (const child of frame.children) {
    nodeById.set(child.id, child);
  }
  for (let i = 0; i < originalChildOrder.length; i++) {
    const node = nodeById.get(originalChildOrder[i]);
    if (node) {
      frame.insertChild(i, node);
    }
  }

  // Restore positions
  for (const child of frame.children) {
    const orig = originalSnapshots.get(child.id);
    if (orig) {
      child.x = orig.x;
      child.y = orig.y;
      child.resize(orig.w, orig.h);
    }
  }
}

// ═════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════

/**
 * Convert a non-autolayout container to autolayout.
 *
 * @param frame  The target frame (must have layoutMode === "NONE")
 * @returns      ConversionResult with plan, success flag, and any errors
 */
export function convertToAutoLayout(
  frame: FrameNode | ComponentNode | InstanceNode,
): ConversionResult {
  // Validate input
  if (frame.layoutMode !== "NONE") {
    return {
      success: false,
      plan: buildPlan({ nodeId: frame.id, name: frame.name, width: frame.width, height: frame.height, children: [] }),
      errors: [
        {
          nodeId: frame.id,
          name: frame.name,
          expected: { x: 0, y: 0, w: 0, h: 0 },
          actual: { x: 0, y: 0, w: 0, h: 0 },
          deltaX: 0,
          deltaY: 0,
          deltaW: 0,
          deltaH: 0,
        },
      ],
    };
  }

  // Phase 0: Snapshot
  const containerSnap = snapshotContainer(frame);
  const originalSnapshots = new Map<string, Bounds>();
  const originalChildOrder: string[] = [];
  for (const child of frame.children) {
    originalSnapshots.set(child.id, {
      x: child.x,
      y: child.y,
      w: child.width,
      h: child.height,
    });
    originalChildOrder.push(child.id);
  }

  // Phases 1-7: Build plan
  const plan = buildPlan(containerSnap);

  // Phase 8: Apply
  applyPlan(frame, plan, originalSnapshots);

  // Phase 9: Verify
  const errors = verify(frame, originalSnapshots);

  if (errors.length > 0) {
    // Rollback on any pixel deviation
    rollback(frame, originalSnapshots, originalChildOrder);
    return { success: false, plan, errors };
  }

  return { success: true, plan, errors: [] };
}

/**
 * Dry-run: only compute the plan without applying changes.
 */
export function analyzeForAutoLayout(
  frame: FrameNode | ComponentNode | InstanceNode,
): ConversionPlan {
  const containerSnap = snapshotContainer(frame);
  return buildPlan(containerSnap);
}

/**
 * Convert with retry: if first attempt fails, try forcing all
 * error-causing children to ABSOLUTE and retry.
 */
export function convertWithRetry(
  frame: FrameNode | ComponentNode | InstanceNode,
): ConversionResult {
  const first = convertToAutoLayout(frame);
  if (first.success) return first;

  // Force failed children to ABSOLUTE in the plan
  const failedIds = new Set(first.errors.map((e) => e.nodeId));
  const containerSnap = snapshotContainer(frame);
  const plan = buildPlan(containerSnap);

  // Move failed AUTO children to ABSOLUTE
  const movedToAbsolute: AbsoluteChildPlan[] = [];
  const remainingAuto: AutoChildPlan[] = [];

  for (const ac of plan.autoChildren) {
    if (failedIds.has(ac.snapshot.nodeId)) {
      movedToAbsolute.push({
        snapshot: ac.snapshot,
        constraints: computeConstraints(ac.snapshot, containerSnap),
      });
    } else {
      remainingAuto.push(ac);
    }
  }

  const retryPlan: ConversionPlan = {
    ...plan,
    autoChildren: remainingAuto,
    absoluteChildren: [...plan.absoluteChildren, ...movedToAbsolute],
  };

  // Recalculate gap for remaining AUTO children
  // (reuse existing gap if still valid)

  // Snapshot originals
  const originalSnapshots = new Map<string, Bounds>();
  const originalChildOrder: string[] = [];
  for (const child of frame.children) {
    originalSnapshots.set(child.id, {
      x: child.x,
      y: child.y,
      w: child.width,
      h: child.height,
    });
    originalChildOrder.push(child.id);
  }

  applyPlan(frame, retryPlan, originalSnapshots);
  const errors = verify(frame, originalSnapshots);

  if (errors.length > 0) {
    rollback(frame, originalSnapshots, originalChildOrder);
    return { success: false, plan: retryPlan, errors };
  }

  return { success: true, plan: retryPlan, errors: [] };
}
