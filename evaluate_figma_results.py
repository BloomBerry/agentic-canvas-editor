"""
Figma Slide Benchmark Evaluator
================================
Extracts Instruction Following Score and Visual Quality Score
for each case in evaluation_pairs_figma_generated.json by comparing
ground truth data with inference results from results/figma_slide/.

Uses the same LLM-as-judge approach as PPTArena (src/llm/judge.py).
"""

import json
import os
import re
import sys
import time
import base64
import io
import argparse
import csv
import math
from pathlib import Path
from datetime import datetime
from typing import Optional, List

try:
    import numpy as np
    from PIL import Image as PILImage
    _HAS_IMAGE_METRICS = True
except ImportError:
    _HAS_IMAGE_METRICS = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
EVAL_PAIRS_PATH = PROJECT_ROOT / "figma_bench_eval.json"
DATA_DIR = PROJECT_ROOT / "data"
RESULTS_DIR = PROJECT_ROOT / "results" / "figma_slide"
OUTPUT_DIR = PROJECT_ROOT / "evaluation_output"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_evaluation_pairs(path: Path | None = None) -> dict:
    # Resolve at call time so --eval-file overrides applied after module
    # import are honoured (default-argument values are bound at def time).
    if path is None:
        path = EVAL_PAIRS_PATH
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Support both list and dict formats
    if isinstance(data, list):
        return {item.get("name", f"case_{i}"): item for i, item in enumerate(data)}
    return data


def image_to_base64(image_path: str | Path) -> Optional[str]:
    """Convert an image file to a base64-encoded string."""
    try:
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        print(f"  [WARN] Failed to read image {image_path}: {e}")
        return None


def _normalize_name(s: str) -> str:
    """Strip non-alphanumerics so 'Foo&Bar' and 'Foo-Bar' match."""
    return re.sub(r"[^A-Za-z0-9]", "", s).lower()


def find_result_dirs(original_name: str) -> list[Path]:
    """Find all result directories whose name starts with `original_name + "-"`,
    using normalized comparison so dirs that diverged on a few special
    characters (e.g. `&` rewritten to `-` during generation) still match.
    """
    if not RESULTS_DIR.exists():
        return []
    target_norm = _normalize_name(original_name + "-")
    matches = []
    for d in os.listdir(RESULTS_DIR):
        full = RESULTS_DIR / d
        if not os.path.isdir(full):
            continue
        # Strict prefix match first (back-compat)
        if d.startswith(original_name + "-"):
            matches.append(full)
            continue
        # Fuzzy: normalize both sides, accept if dir name normalized starts
        # with the target normalized prefix.
        if _normalize_name(d).startswith(target_norm):
            matches.append(full)
    seen = set()
    out = []
    for p in sorted(matches):
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def load_json_file(path: Path) -> Optional[dict]:
    """Safely load a JSON file, returning None on failure."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"  [WARN] Failed to load JSON {path}: {e}")
        return None


def load_slide_images_b64(frames_dir: Path) -> list[str]:
    """Load all slide images from a frames directory as base64 strings."""
    if not frames_dir.exists():
        return []
    images = []
    for img_path in sorted(frames_dir.glob("slide_*.png")):
        b64 = image_to_base64(img_path)
        if b64:
            images.append(b64)
    return images


def load_snapshot_images_b64(snapshot_dir: Path, case_prefix: str, turn: Optional[int] = None) -> list[str]:
    """Load slide images from a result's snapshots dir.

    Args:
        turn: If given, load images from that specific snapshot turn (e.g. 0 for
            initial state, before any agent modifications). If None (default),
            load the latest snapshot turn — i.e., the agent's final output.
    """
    if not snapshot_dir.exists():
        return []

    # Find snapshot files
    snapshot_files = sorted(snapshot_dir.glob(f"{case_prefix}-snapshot-*-slide-*.png"))
    if not snapshot_files:
        snapshot_files = sorted(snapshot_dir.glob("*-snapshot-*-slide-*.png"))

    if not snapshot_files:
        return []

    snapshot_nums = set()
    for f in snapshot_files:
        match = re.search(r"-snapshot-(\d+)-slide-", f.name)
        if match:
            snapshot_nums.add(int(match.group(1)))

    if not snapshot_nums:
        return []

    target_snapshot = turn if (turn is not None and turn in snapshot_nums) else max(snapshot_nums)
    target_files = sorted([
        f for f in snapshot_files
        if f"-snapshot-{target_snapshot}-slide-" in f.name
    ])

    images = []
    for img_path in target_files:
        b64 = image_to_base64(img_path)
        if b64:
            images.append(b64)
    return images


def _extract_transitions_from_snap_full(snap_full_path: Path) -> list:
    """[TEMP positional version while surveying 53 cases — to be swapped to
    id-keyed dict once fresh inference data is available.]
    Read a plugin's full snapshot JSON and extract slide-transition metadata
    from toolResults as an ordered list (positional mapping to slides)."""
    try:
        d = json.loads(snap_full_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    out: list = []
    for tr in d.get("toolResults", []) or []:
        if not isinstance(tr, dict): continue
        sc = tr.get("structuredContent") or {}
        for r in sc.get("results", []) or []:
            if not isinstance(r, dict): continue
            inner = r.get("result") or {}
            t = inner.get("transition")
            if isinstance(t, dict):
                out.append(t)
    return out


def _inject_transitions_into_doc(doc_json: dict, transitions: list) -> None:
    """Attach transitions positionally to slides found in doc_json."""
    if not transitions or not isinstance(doc_json, dict):
        return
    slides = _extract_slides(doc_json)
    for i, t in enumerate(transitions):
        if i < len(slides):
            slides[i]["_transition"] = t


def load_snapshot_structure_json(snapshot_dir: Path, case_prefix: str, turn: Optional[int] = None) -> Optional[dict]:
    """Load a snapshot structure JSON from a result's snapshots dir.

    Args:
        snapshot_dir: Path to the snapshots directory.
        case_prefix: Prefix for matching snapshot files.
        turn: If specified, load a specific turn (e.g. turn=0 for initial state).
              If None, load the latest (highest turn number).
    """
    if not snapshot_dir.exists():
        return None

    structure_files = sorted(snapshot_dir.glob(f"{case_prefix}-snapshot-*-structure.json"))
    if not structure_files:
        structure_files = sorted(snapshot_dir.glob("*-snapshot-*-structure.json"))

    if not structure_files:
        return None

    # Parse turn numbers from filenames
    snapshot_nums = {}
    for f in structure_files:
        match = re.search(r"-snapshot-(\d+)-structure\.json$", f.name)
        if match:
            snapshot_nums[int(match.group(1))] = f

    if not snapshot_nums:
        return None

    if turn is not None:
        # Load specific turn
        if turn in snapshot_nums:
            return load_json_file(snapshot_nums[turn])
        return None

    # Load latest (highest turn number)
    latest = snapshot_nums[max(snapshot_nums.keys())]
    return load_json_file(latest)


# ---------------------------------------------------------------------------
# Image metrics (adapted from PPTArena's image_utils.py)
# ---------------------------------------------------------------------------

def _pil_from_b64(image_b64: str):
    """Decode base64 to PIL.Image with safety guards."""
    if not _HAS_IMAGE_METRICS:
        return None
    try:
        if not image_b64:
            return None
        raw = base64.b64decode(image_b64)
        return PILImage.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        return None


def _resize_for_metric(img, max_side: int = 512):
    """Downscale while preserving aspect ratio to keep metrics fast and stable."""
    w, h = img.size
    if max(w, h) <= max_side:
        return img
    if w >= h:
        new_w = max_side
        new_h = int(h * (max_side / float(w)))
    else:
        new_h = max_side
        new_w = int(w * (max_side / float(h)))
    return img.resize((new_w, new_h), PILImage.BILINEAR)


def _to_gray_np(img):
    return np.asarray(img.convert("L"), dtype=np.float32) / 255.0


def _compute_ssim(a, b) -> float:
    """Simple SSIM implementation (windowless approximation) for speed."""
    C1 = 0.01 ** 2
    C2 = 0.03 ** 2
    mu_a = float(a.mean())
    mu_b = float(b.mean())
    sigma_a2 = float(a.var())
    sigma_b2 = float(b.var())
    sigma_ab = float(((a - mu_a) * (b - mu_b)).mean())
    num = (2 * mu_a * mu_b + C1) * (2 * sigma_ab + C2)
    den = (mu_a ** 2 + mu_b ** 2 + C1) * (sigma_a2 + sigma_b2 + C2)
    if den == 0:
        return 0.0
    return max(0.0, min(1.0, float(num / den)))


def _dct_8x8_hash(img) -> int:
    """Compute a simple pHash-like 64-bit hash using DCT on a small grayscale image."""
    try:
        size = 32
        gray = _to_gray_np(img.resize((size, size), PILImage.BILINEAR))
        N = size
        dct = np.zeros((N, N), dtype=np.float32)
        for u in range(N):
            for v in range(N):
                cu = math.sqrt(1 / N) if u == 0 else math.sqrt(2 / N)
                cv = math.sqrt(1 / N) if v == 0 else math.sqrt(2 / N)
                s = 0.0
                for x in range(N):
                    for y in range(N):
                        s += gray[x, y] * math.cos(((2 * x + 1) * u * math.pi) / (2 * N)) * math.cos(((2 * y + 1) * v * math.pi) / (2 * N))
                dct[u, v] = cu * cv * s
        low = dct[:8, :8]
        ac = low.flatten()[1:]
        med = float(np.median(ac)) if ac.size else 0.0
        bits = (low > med).astype(np.uint8).flatten()
        h = 0
        for bit in bits[:64]:
            h = (h << 1) | int(bit)
        return int(h)
    except Exception:
        return 0


def _hamming_distance64(a: int, b: int) -> int:
    x = (a ^ b) & ((1 << 64) - 1)
    cnt = 0
    while x:
        x &= x - 1
        cnt += 1
    return cnt


# ---------------------------------------------------------------------------
# Diff utilities (adapted from PPTArena's ppt_processor.py)
# ---------------------------------------------------------------------------

# Type equivalences (different representations of the same thing)
_TYPE_EQUIVALENTS = {
    'SHAPE_WITH_TEXT': 'FRAME',
}

# Style sub-properties to compare (maps to PPTArena's run-level typography)
# NOTE: Excludes properties the Figma Plugin cannot reliably capture:
#   - 'italic' (boolean): Plugin never returns this; fontStyle captures italic status
#   - 'textAlignVertical': Plugin always returns "TOP" regardless of actual value
_STYLE_PROPS = [
    'fontFamily',           # font name
    'fontSize',             # font size (pt)
    'fontWeight',           # bold (700) vs regular (400)
    'fontStyle',            # "Bold", "Regular", "Italic", "Bold Italic"
    'textAlignHorizontal',  # text alignment
    'letterSpacing',        # letter spacing
    'lineHeightPx',         # line height
    'textCase',             # text case
    'textDecoration',       # underline etc.
]

# Position/size properties from absoluteBoundingBox
_POSITION_PROPS = ['x', 'y', 'width', 'height']


def _get_bbox(node: Optional[dict]) -> dict:
    """Return {x, y, width, height} for a Figma node, prefering
    absoluteBoundingBox (REST API schema) and falling back to
    size + relativeTransform (Plugin schema).

    Plugin-exported nodes carry absoluteBoundingBox with all-None values
    (the field is reserved on the node but never populated). Without this
    fallback the diff silently skips every position/size comparison when
    both GT and Pred come from the plugin, causing position-change edits
    to score perfectly even when nothing moved.
    """
    if not node:
        return {}
    bb = node.get("absoluteBoundingBox") or {}
    if bb.get("x") is not None or bb.get("y") is not None:
        return {
            "x": bb.get("x"),
            "y": bb.get("y"),
            "width": bb.get("width"),
            "height": bb.get("height"),
        }
    size = node.get("size") or {}
    xform = node.get("relativeTransform")
    out: dict = {}
    if size:
        out["width"] = size.get("x")
        out["height"] = size.get("y")
    if (xform and isinstance(xform, list) and len(xform) >= 2
            and len(xform[0]) >= 3 and len(xform[1]) >= 3):
        out["x"] = xform[0][2]
        out["y"] = xform[1][2]
    return out

# Default values for style properties where None is equivalent to a specific value.
# GT (Figma API) often omits these, while Pred (Figma Plugin) sets them to explicit defaults.
_STYLE_DEFAULTS = {
    'textCase': 'ORIGINAL',         # None == "ORIGINAL" (no transformation)
    'textDecoration': 'NONE',       # None == "NONE" (no decoration)
    'textAlignHorizontal': 'LEFT',  # None == "LEFT"
}


def _normalize_rotation_to_degrees(val) -> float:
    """Normalize rotation to degrees [0, 360).
    Figma API may return radians, Plugin may return degrees."""
    if val is None:
        return 0.0
    v = float(val)
    # Heuristic: if abs(val) <= 2*pi (~6.28), it's likely radians
    if abs(v) <= 2 * math.pi + 0.01 and abs(v) > 0.001:
        v = math.degrees(v)
    # Normalize to [0, 360)
    return v % 360


def _normalize_value(val):
    """Normalize values for comparison (handle floats, None, etc.)
    Adapted from PPTArena's diff_pptx_json."""
    if val is None:
        return None
    if isinstance(val, float):
        # Round to 4 dp, not 2. Rounding to 2 dp before the ±1% tolerance check
        # AMPLIFIES tiny diffs on 0–1 color channels: e.g. 0.838 vs 0.835 (0.36%)
        # rounds to 0.84 vs 0.83 (1.19%), wrongly exceeding the 1% threshold and
        # flagging an invisible color change. 4 dp preserves color precision while
        # staying harmless for large values (positions, sizes).
        return round(val, 4)
    if isinstance(val, (list, tuple)):
        return [_normalize_value(v) for v in val]
    if isinstance(val, dict):
        return {k: _normalize_value(v) for k, v in val.items()}
    return val


def _values_match(val1, val2, tolerance=0.01):
    """Check if two values match, with tolerance for floats (1% tolerance).
    Adapted from PPTArena's diff_pptx_json."""
    val1 = _normalize_value(val1)
    val2 = _normalize_value(val2)

    if val1 == val2:
        return True

    # Handle float comparisons with tolerance
    if isinstance(val1, (int, float)) and isinstance(val2, (int, float)):
        if val1 == val2:
            return True
        # Absolute floor first: a <0.01 absolute gap is always a match. This is
        # essential for 0–1 color channels — relative tolerance is meaningless near
        # zero (0.0196 vs 0.0204 is 3.9% relative but visually identical, 0.2/255).
        # 0.01 ≈ 2.55/255, sub-perceptible, and negligible for large values too.
        if abs(val1 - val2) < 0.01:
            return True
        if val1 == 0 or val2 == 0:
            return abs(val1 - val2) < 0.01
        return abs(val1 - val2) / max(abs(val1), abs(val2)) < tolerance

    # Handle string comparisons with type normalization
    if isinstance(val1, str) and isinstance(val2, str):
        v1 = _TYPE_EQUIVALENTS.get(val1, val1)
        v2 = _TYPE_EQUIVALENTS.get(val2, val2)
        return v1 == v2

    return False


def _color_channel_match(a, b, abs_tol: float = 0.01) -> bool:
    """Match two 0–1 color channel values by ABSOLUTE difference.

    Relative tolerance is wrong for color: with diff/max, black (≈0) is
    hypersensitive (any drift is a huge % of a tiny denominator) while white
    (≈1) is undersensitive (a large absolute drift is a small %). The same
    absolute channel difference should read the same regardless of brightness,
    so colors use a flat absolute tolerance. 0.01 ≈ 2.55/255, sub-perceptible,
    and matches PPTArena's ±2/255 hex tolerance.
    """
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= abs_tol


def _normalize_characters(val):
    """Normalize characters field to handle '' vs None vs 'None' differences."""
    if val is None or val == 'None' or val == '':
        return ''
    return str(val).strip()


def _align_slides_by_id(init_slides: list, pred_slides: list):
    """Slide alignment by stable source id (sourceId-preserved by the plugin).

    For figma's pipeline, the plugin's import-export preserves source ids
    end-to-end, so slides keep their id across an agent edit. Pred slides
    whose id matches an init slide → pair them (positional shifts are
    automatically handled). Pred slides with a brand-new id → ADDED. Init
    slides whose id is absent from pred → REMOVED.

    This is content-free (no cross-slide-consolidation false matches that
    a Jaccard-on-text approach would suffer) and order-preserving (we keep
    the pred-side ordering as the source of truth for slide_num).
    """
    init_id_to_idx = {s.get("id"): j for j, s in enumerate(init_slides) if s.get("id")}
    consumed_init: set = set()
    pairs: list = []
    for i, ps in enumerate(pred_slides):
        sid = ps.get("id")
        j = init_id_to_idx.get(sid)
        if j is not None and j not in consumed_init:
            # Insert any init slides that were skipped (= removed by agent)
            for k in range(len(init_slides)):
                if k in consumed_init or k == j:
                    continue
                if k < j and init_slides[k].get("id") not in (p.get("id") for p in pred_slides):
                    pairs.append((k, None))
                    consumed_init.add(k)
            pairs.append((j, i))
            consumed_init.add(j)
        else:
            pairs.append((None, i))  # agent-added slide
    # Trailing init slides that never matched any pred id → removed
    for k in range(len(init_slides)):
        if k not in consumed_init:
            pairs.append((k, None))
    return pairs


def _summarize_text_style(style: dict) -> str:
    """Compact one-line summary of a styleOverrideTable entry — only emits the
    fields the IF judge cares about (font weight/style, color, decoration).
    Full dicts would flood the diff text with noise."""
    if not isinstance(style, dict):
        return str(style)[:80]
    parts: list = []
    fs = style.get("fontStyle")
    if fs: parts.append(f"fontStyle={fs}")
    fw = style.get("fontWeight")
    if fw is not None: parts.append(f"fontWeight={fw}")
    fills = style.get("fills") or []
    if fills:
        for f in fills[:1]:
            c = f.get("color") or {}
            if c:
                parts.append(f"color=rgba({round(c.get('r',0),3)},{round(c.get('g',0),3)},{round(c.get('b',0),3)},{round(c.get('a',1),3)})")
    td = style.get("textDecoration")
    if td and td != "NONE": parts.append(f"textDecoration={td}")
    return ", ".join(parts) or str(style)[:80]


def _diff_character_ranges(gt_idx: list, pred_idx: list, chars: str) -> list:
    """Compress per-character index arrays into 'styled range -> "Word"' lines
    showing which character spans changed style index. Surfaces e.g.
    `[29-50]="Focuses the coordination M&E"` so the judge can see exactly
    which words were highlighted."""
    out: list = []
    n = max(len(gt_idx), len(pred_idx))
    i = 0
    while i < n:
        gv = gt_idx[i] if i < len(gt_idx) else 0
        pv = pred_idx[i] if i < len(pred_idx) else 0
        if gv == pv:
            i += 1; continue
        # find run end
        j = i
        while j < n:
            gj = gt_idx[j] if j < len(gt_idx) else 0
            pj = pred_idx[j] if j < len(pred_idx) else 0
            if gj == pj or (pj != pv) or (gj != gv):
                break
            j += 1
        snippet = (chars[i:j] if i < len(chars) else "")[:60].replace("\n", " ")
        out.append(f"[{i}-{j-1}] style {gv}->{pv} \"{snippet}\"")
        i = j
    return out


def _consolidate_bbox_entries(differences: list) -> list:
    """Merge per-axis boundingBox/position diffs (x, y, width, height) for
    the same shape into one entry. Reduces 4 entries per moved+resized
    shape to 1, saving token budget without losing data.

    Output entry: property_path ends in `.bbox` (figma) or is `position`
    (html); ground_truth_value/prediction_value list only the changed
    axes (`x=128, y=330` → `x=610, y=320`). Untouched axes are omitted."""
    _AXIS_FROM_PATH = {}
    groups: dict = {}
    other: list = []
    for d in differences:
        if d.get("change_type") != "modified":
            other.append(d)
            continue
        pp = d.get("property_path", "") or ""
        prefix = None
        axis = None
        if ".boundingBox." in pp:
            pref, ax = pp.rsplit(".boundingBox.", 1)
            if ax in ("x", "y", "width", "height"):
                prefix = pref + ".bbox"
                axis = ax
        elif pp == "position.x" or pp == "position.y" or pp == "position.w" or pp == "position.h":
            prefix = "position"
            axis = pp[len("position."):]
        if not prefix:
            other.append(d)
            continue
        # Discriminate same-named siblings (Case 92: 6 '_Human Avatar Image'
        # nodes share name and parent path) by including the initial value
        # on the *other* axis if already grouped — that's effectively a
        # per-instance fingerprint. Use the gt value of this axis too so
        # entries from different shapes never collapse into one group.
        key = (
            d.get("slide_number"), d.get("shape_name"), prefix,
            # tie-break: distinct gt anchors per shape instance
            f"{axis}={d.get('ground_truth_value')}",
        )
        # If we already saw this exact axis for this key (same shape, same
        # gt), it's a true dup → skip. Otherwise enter as a new group.
        # We actually want grouping by (slide, name, prefix) plus a "sibling
        # bucket" derived from anchor values. Build that bucket lazily:
        anchor_key = (d.get("slide_number"), d.get("shape_name"), prefix)
        bucket = groups.setdefault(anchor_key, [])
        # Find a sub-group whose existing axes' gt values would form a
        # consistent shape (same starting bbox if all known). Heuristic:
        # match by missing the current axis OR sharing the same gt for any
        # axis already present. Simpler: each entry that doesn't share its
        # axis with any existing sub-group's entry creates a new sub-group.
        placed = False
        for sub in bucket:
            if axis not in sub:
                sub[axis] = d
                placed = True
                break
        if not placed:
            bucket.append({axis: d})

    merged: list = []
    AXIS_ORDER = ("x", "y", "width", "w", "height", "h")
    for (slide, shape, prefix), sub_groups in groups.items():
        for axes in sub_groups:
            if len(axes) == 1:
                merged.append(next(iter(axes.values())))
                continue
            ordered = [(ax, axes[ax]) for ax in AXIS_ORDER if ax in axes]
            gt = ", ".join(f"{ax}={e.get('ground_truth_value')}" for ax, e in ordered)
            pv = ", ".join(f"{ax}={e.get('prediction_value')}" for ax, e in ordered)
            # When width/height changed, this is a RESIZE event (not just a
            # move). Tag explicitly so the judge can distinguish "container
            # scaled larger" from "container slightly shifted" — Case 73:
            # the chart parent went from 1284x799 → 1452x850 (+13% wide,
            # +6% tall) but all 60+ child shape positions only shifted by
            # 10px, making it read as "labels just shifted slightly" instead
            # of "chart was scaled up to fix legibility".
            # RESIZE tag — emit on any width/height change so the judge can
            # distinguish "container scaled" from "container shifted" without
            # threshold gating (Case 73 motivation: chart parent resize was
            # buried among 60+ child position shifts).
            try:
                resize_pct = []
                for ax in ("width", "w", "height", "h"):
                    if ax in axes:
                        e = axes[ax]
                        gv = float(e.get("ground_truth_value") or 0)
                        pvf = float(e.get("prediction_value") or 0)
                        if gv > 0 and pvf != gv:
                            delta = (pvf - gv) / gv * 100
                            resize_pct.append(f"{ax}: {delta:+.0f}%")
                if resize_pct:
                    pv = pv + f"  [RESIZED {', '.join(resize_pct)}]"
            except Exception:
                pass
            merged.append({
                "slide_number": slide,
                "shape_name": shape,
                "property_path": prefix,
                "change_type": "modified",
                "ground_truth_value": gt,
                "prediction_value": pv,
            })
    return other + merged


def _collapse_reparented_pairs(differences: list, init_doc: dict, pred_doc: dict) -> list:
    """Detect cross-parent node moves and collapse remove+add pairs into
    `parent.moved` entries.

    Walks both trees to build id→(parent_name, node) maps. For ids in both
    sides with different parents, finds matching remove+add diff entries and
    replaces the pair with one move entry showing old parent → new parent +
    new x/y. Without this, an agent that reparents 12 nodes (e.g. lifts
    KPI tiles out of a chart wrapper into the slide root) produces 24
    deceptive remove+add entries that the IF judge reads as "deleted 12
    things and created 12 new things"."""
    if not isinstance(init_doc, dict) or not isinstance(pred_doc, dict):
        return differences

    def _build_id_map(doc: dict) -> dict:
        out: dict = {}
        def w(n, parent_name):
            if not isinstance(n, dict):
                return
            nid = n.get("id")
            if nid:
                bb = n.get("absoluteBoundingBox") or {}
                out[nid] = {
                    "name": n.get("name", ""),
                    "type": n.get("type", ""),
                    "parent": parent_name,
                    "x": bb.get("x"),
                    "y": bb.get("y"),
                }
            for c in n.get("children") or []:
                w(c, n.get("name", "") or parent_name)
        w(doc.get("document", doc), "")
        return out

    init_ids = _build_id_map(init_doc)
    pred_ids = _build_id_map(pred_doc)
    common = set(init_ids) & set(pred_ids)
    moved = {nid: (init_ids[nid], pred_ids[nid]) for nid in common
             if init_ids[nid]["parent"] != pred_ids[nid]["parent"]}
    if not moved:
        return differences

    # Build (slide_number, shape_name, type) → list of removed/added indices
    # so we can pair them. We can't key by id directly (diff entries don't
    # carry id), but (name, type, slide) is unique enough in practice when
    # combined with the parent_path mismatch precondition.
    moved_keys = {(info_i["name"], info_i["type"]) for info_i, _ in moved.values()}

    by_key: dict = {}
    for i, d in enumerate(differences):
        ct = d.get("change_type")
        if ct not in ("removed", "added"):
            continue
        name = d.get("shape_name") or ""
        val = str(d.get("ground_truth_value") or d.get("prediction_value") or "")
        m = re.search(r"\(type:\s*(\w+)", val)
        ntype = m.group(1) if m else ""
        if (name, ntype) not in moved_keys:
            continue
        by_key.setdefault((d.get("slide_number"), name, ntype), {"removed": [], "added": []})[ct].append(i)

    collapsed: set = set()
    new_entries: list = []
    # Build name→id reverse map (only for moved ids) to pull new x/y.
    name_type_to_pred = {(info_p["name"], info_p["type"]): info_p
                         for _, info_p in moved.values()}
    for (slide_num, name, ntype), lists in by_key.items():
        if not lists["removed"] or not lists["added"]:
            continue
        pred_info = name_type_to_pred.get((name, ntype), {})
        for r_idx, a_idx in zip(lists["removed"], lists["added"]):
            r_diff = differences[r_idx]
            a_diff = differences[a_idx]
            r_path = r_diff.get("property_path", "")
            a_path = a_diff.get("property_path", "")
            r_parent = r_path.rsplit(".children", 1)[0]
            a_parent = a_path.rsplit(".children", 1)[0]
            collapsed.add(r_idx)
            collapsed.add(a_idx)
            xy = ""
            if pred_info.get("x") is not None:
                xy = f"; new x,y=({round(pred_info['x'],1)}, {round(pred_info['y'],1)})"
            new_entries.append({
                "slide_number": slide_num,
                "shape_name": name,
                "property_path": f"{a_parent}.moved_to",
                "change_type": "modified",
                "ground_truth_value": f"was inside '{r_parent}'",
                "prediction_value": f"now inside '{a_parent}' (type: {ntype}){xy}",
            })
    if not collapsed:
        return differences
    return [d for i, d in enumerate(differences) if i not in collapsed] + new_entries


def _compose_slides_grid(images: list, tile_w: int = 768, label_h: int = 28) -> str:
    """Compose a list of (slide_num, b64_png) into one grid PNG (base64).
    Each tile is resized to tile_w wide (aspect preserved) and labeled
    'Slide N'. Saves one image-input slot when multiple edited slides
    need to be attached to the IF judge. Returns the single image's b64
    unchanged when len(images) <= 1."""
    if not images:
        return ""
    if len(images) == 1:
        return images[0][1]
    import base64, io, math
    from PIL import Image, ImageDraw, ImageFont

    tiles: list = []
    for num, b64 in images:
        try:
            img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
            scale = tile_w / img.width
            img = img.resize((tile_w, int(img.height * scale)), Image.LANCZOS)
            tiles.append((num, img))
        except Exception:
            continue
    if not tiles:
        return ""

    cols = math.ceil(math.sqrt(len(tiles)))
    rows = math.ceil(len(tiles) / cols)
    cell_h = max(im.height for _, im in tiles) + label_h
    canvas = Image.new("RGB", (cols * tile_w, rows * cell_h), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for idx, (num, img) in enumerate(tiles):
        x = (idx % cols) * tile_w
        y = (idx // cols) * cell_h
        draw.rectangle([x, y, x + tile_w, y + label_h], fill=(40, 40, 60))
        draw.text((x + 8, y + 6), f"Slide {num}", fill=(255, 255, 255), font=font)
        canvas.paste(img, (x, y + label_h))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _summarize_visual_nature(node: dict) -> str:
    """Return a tag like ' [IMAGE]' or ' [contains 3×VECTOR]' that describes
    what a FRAME/RECTANGLE actually depicts. A FRAME whose fill is an IMAGE
    IS a picture (Case 62: Frame 3 holds the photo); a FRAME containing only
    VECTORs is an SVG icon (Case 56). Without this tag, a z-order change on
    a picture-bearing FRAME reads as 'moved an unrelated frame'."""
    if not isinstance(node, dict):
        return ""
    for f in node.get("fills") or []:
        if f.get("type") == "IMAGE" and f.get("visible", True) is not False:
            return " [IMAGE fill]"
    counts: dict = {}
    def w(n):
        if not isinstance(n, dict): return
        for c in n.get("children") or []:
            t = c.get("type")
            if t in ("VECTOR", "IMAGE"):
                counts[t] = counts.get(t, 0) + 1
            w(c)
    w(node)
    if counts:
        return " [contains " + ", ".join(f"{n}×{t}" for t, n in sorted(counts.items(), key=lambda x: -x[1])) + "]"
    return ""


def _summarize_descendant_types(node: dict) -> str:
    """Compact ' contains: 3×VECTOR, 1×TEXT' summary of a node's descendants.
    Without this, an added FRAME wrapping SVG paths reads as just '(type: FRAME)',
    losing the picture-content signal needed for IF judging and visual-gating.
    Returns empty string when the node has no children."""
    counts: dict = {}
    def w(n):
        if not isinstance(n, dict): return
        for c in n.get("children") or []:
            t = c.get("type")
            if t:
                counts[t] = counts.get(t, 0) + 1
            w(c)
    w(node)
    if not counts:
        return ""
    return " contains: " + ", ".join(f"{n}×{t}" for t, n in sorted(counts.items(), key=lambda x: -x[1]))


def _diff_has_visual_content_changes(diffs: list) -> bool:
    """True iff the diff includes picture-content edits OR a structural
    layout change that needs visual verification.

    Image/vector edits get the gate so the judge can verify picture content.
    Cross-parent moves (`*.moved_to`) and large sibling reorders
    (`children.reorder`) also trigger because the textual diff alone reads
    as ambiguous shape relocation/shuffle — the rendered image reveals
    whether the new layout matches the instruction's intent (Case 73:
    "KPI tiles above the chart").
    """
    _VISUAL_TOKENS = ("IMAGE", "VECTOR", "SVG", "imageRef", "imageHash", "fill_image")
    for d in diffs or []:
        for k in ("shape_name", "property_path", "ground_truth_value", "prediction_value"):
            v = str(d.get(k) or "")
            for tok in _VISUAL_TOKENS:
                if tok in v or tok.upper() in v.upper():
                    return True
        pp = d.get("property_path", "")
        if pp.endswith(".moved_to") or pp.endswith(".children.reorder"):
            return True
        # Any bbox/position change → attach pred image. Position edits
        # benefit from visual verification regardless of count (Case 63:
        # spatial constraints needs to see the rendered layout + the
        # constraints text shown on the slide itself).
        if (pp.endswith(".bbox") or pp.endswith(".boundingBox.x")
                or pp.endswith(".boundingBox.y") or pp.endswith(".boundingBox.width")
                or pp.endswith(".boundingBox.height")):
            return True
    return False


def _gather_text_content(node: dict) -> str:
    """Concatenate all `characters` from a node and its descendants in DOM
    order. Used to surface what an added/removed child actually says so the
    judge can verify content (e.g. that a freshly-added 'date-footer' TEXT
    contains 'February 9, 2026')."""
    parts: list = []
    def w(n):
        if not isinstance(n, dict):
            return
        chars = (n.get("characters") or "").strip()
        if chars:
            parts.append(chars)
        for c in n.get("children", []) or []:
            w(c)
    w(node)
    return " | ".join(parts)


def _collect_slide_summary(slide_node: dict) -> dict:
    """Walk a slide subtree and gather a compact summary of its visible
    content so a slide-added / slide-removed diff entry can describe WHAT
    is in the new (or lost) slide rather than just "extra slide". Lets the
    judge see e.g. "Thank you" text on a newly added Thank-You slide."""
    out: dict = {"shapes": 0, "texts": [], "shape_types": []}
    def w(n: dict):
        if not isinstance(n, dict):
            return
        t = n.get("type") or ""
        if t and t not in ("DOCUMENT", "CANVAS"):
            out["shapes"] += 1
            out["shape_types"].append(t)
        chars = (n.get("characters") or "").strip()
        if chars:
            out["texts"].append(chars)
        for c in n.get("children", []) or []:
            w(c)
    for c in slide_node.get("children", []) or []:
        w(c)
    return out


_NON_TEXT_VISUAL_TYPES = (
    "RECTANGLE", "ELLIPSE", "VECTOR", "LINE",
    "POLYGON", "STAR", "REGULAR_POLYGON",
)


def _fill_blurb(node: dict) -> str:
    """Compact ' fill=rgba(...)' / ' fill=IMAGE' summary for a node's primary
    visible fill. Without this, an added RECTANGLE in a new slide reads as
    just '(type: RECTANGLE)' — the judge can't tell apart the pink timeline
    segment from the navy header. Returns '' when no usable fill exists."""
    for f in node.get("fills") or []:
        if f.get("visible") is False:
            continue
        t = f.get("type") or ""
        if t == "IMAGE":
            return " fill=IMAGE"
        if t == "SOLID":
            c = f.get("color") or {}
            r = int(round((c.get("r") or 0) * 255))
            g = int(round((c.get("g") or 0) * 255))
            b = int(round((c.get("b") or 0) * 255))
            a = c.get("a")
            if a is None:
                a = f.get("opacity", 1)
            return f" fill=rgba({r},{g},{b},{round(a, 2)})"
        if t and t.startswith("GRADIENT"):
            return f" fill={t}"
    return ""


def _collect_added_slide_shapes(slide_node: dict, max_count: int = 30) -> tuple:
    """Enumerate non-text visual shapes inside an added/removed slide so the
    diff can describe each one (name, type, bbox, fill, visual nature)
    instead of collapsing them into a single "25 shapes" count. FRAMEs are
    treated as containers and recursed into; an exception is made for
    IMAGE-bearing FRAMEs (those ARE pictures, e.g. Case 62's photo frame).

    Returns (descriptors[:max_count], total_visual_count) so the caller can
    emit a "+N more (truncated)" marker when the slide is dense."""
    shapes: list = []
    total = 0

    def w(n: dict):
        nonlocal total
        if not isinstance(n, dict):
            return
        t = n.get("type") or ""
        is_visual = False
        if t in _NON_TEXT_VISUAL_TYPES:
            is_visual = True
        elif t == "FRAME":
            for f in n.get("fills") or []:
                if f.get("type") == "IMAGE" and f.get("visible", True) is not False:
                    is_visual = True
                    break
        if is_visual and n.get("visible") is not False:
            total += 1
            if len(shapes) < max_count:
                bb = _get_bbox(n)
                bb_str = (
                    f" at xy=({round(bb.get('x'), 1)},{round(bb.get('y'), 1)})"
                    f" wh=({round(bb.get('width'), 1)},{round(bb.get('height'), 1)})"
                    if bb and bb.get('x') is not None else ""
                )
                visual_tag = _summarize_visual_nature(n)
                contains = _summarize_descendant_types(n) if t == "FRAME" else ""
                fill = _fill_blurb(n)
                cr = n.get("cornerRadius")
                cr_str = f" cornerRadius={cr}" if isinstance(cr, (int, float)) and cr else ""
                shapes.append({
                    "name": n.get("name") or "?",
                    "type": t,
                    "blurb": f"(type: {t}{visual_tag}){bb_str}{fill}{cr_str}{contains}",
                })
        for c in n.get("children") or []:
            w(c)

    for c in slide_node.get("children", []) or []:
        w(c)
    return shapes, total


def _emit_added_slide(pred_slide: dict, slide_num: int, differences: list) -> None:
    s = _collect_slide_summary(pred_slide)
    all_texts = s["texts"]
    shown = all_texts[:20]
    suffix = f" ... +{len(all_texts) - 20} more" if len(all_texts) > 20 else ""
    texts = (" | ".join(shown) + suffix) if shown else "(no text)"
    differences.append({
        "slide_number": slide_num,
        "shape_name": f"Slide {slide_num}",
        "property_path": f"slide_{slide_num}",
        "change_type": "added",
        "ground_truth_value": None,
        "prediction_value": f"new slide added with {s['shapes']} shapes; texts: {texts}",
    })
    for t in all_texts[:20]:
        differences.append({
            "slide_number": slide_num,
            "shape_name": f"Slide {slide_num}",
            "property_path": f"slide_{slide_num}.text",
            "change_type": "added",
            "ground_truth_value": None,
            "prediction_value": t,
        })
    # Per-shape entries for visual elements (rectangles, vectors, ellipses,
    # image-bearing frames, lines). Without this, a templated slide and a
    # carefully-built editable slide both register as "N shapes" — the
    # judge has no way to tell whether the agent placed the requested
    # timeline bars/strings/markers (Case 90).
    shapes, total_visual = _collect_added_slide_shapes(pred_slide)
    for sh in shapes:
        differences.append({
            "slide_number": slide_num,
            "shape_name": sh["name"],
            "property_path": f"slide_{slide_num}.shape",
            "change_type": "added",
            "ground_truth_value": None,
            "prediction_value": f"shape '{sh['name']}' {sh['blurb']}",
        })
    if total_visual > len(shapes):
        differences.append({
            "slide_number": slide_num,
            "shape_name": f"Slide {slide_num}",
            "property_path": f"slide_{slide_num}.shape",
            "change_type": "added",
            "ground_truth_value": None,
            "prediction_value": f"... +{total_visual - len(shapes)} more visual shapes (truncated)",
        })


def _emit_removed_slide(init_slide: dict, slide_num: int, differences: list) -> None:
    s = _collect_slide_summary(init_slide)
    all_texts = s["texts"]
    shown = all_texts[:20]
    suffix = f" ... +{len(all_texts) - 20} more" if len(all_texts) > 20 else ""
    texts = (" | ".join(shown) + suffix) if shown else "(no text)"
    differences.append({
        "slide_number": slide_num,
        "shape_name": f"Slide {slide_num}",
        "property_path": f"slide_{slide_num}",
        "change_type": "removed",
        "ground_truth_value": f"slide existed in initial with {s['shapes']} shapes; texts: {texts}",
        "prediction_value": None,
    })
    shapes, total_visual = _collect_added_slide_shapes(init_slide)
    for sh in shapes:
        differences.append({
            "slide_number": slide_num,
            "shape_name": sh["name"],
            "property_path": f"slide_{slide_num}.shape",
            "change_type": "removed",
            "ground_truth_value": f"shape '{sh['name']}' {sh['blurb']}",
            "prediction_value": None,
        })
    if total_visual > len(shapes):
        differences.append({
            "slide_number": slide_num,
            "shape_name": f"Slide {slide_num}",
            "property_path": f"slide_{slide_num}.shape",
            "change_type": "removed",
            "ground_truth_value": f"... +{total_visual - len(shapes)} more visual shapes (truncated)",
            "prediction_value": None,
        })


def _normalize_slide_bbox_inplace(slide_node: dict) -> None:
    """Mutate a slide subtree so every node carries a slide-relative
    absoluteBoundingBox (top-left of the slide = (0,0)).

    Two coordinate-system mismatches motivated this pass:

    1. REST-API slides are placed side-by-side on one canvas (slide N at
       x≈(1920+gap)*(N-1)) while the Plugin re-normalizes each slide to its
       own canvas with origin (0,0). Comparing absolute coords reads as
       "every element moved by N*1920" — N×30 false bbox edits per slide
       (Case 98: slide 2's status table looks edited when untouched).

    2. Plugin-exported children carry NO absoluteBoundingBox — only a
       `relativeTransform` whose translation is **parent-relative**, not
       slide-absolute. _get_bbox would return that local x/y as if it were
       absolute, so a deeply-nested 'At Risk' text reads x=14 (its offset
       within the cell) on PRED but x=732 on INIT (its slide-relative
       position). Every nested element diffs as a "moved" entry.

    This pass walks the tree once, accumulating parent translations to
    derive each node's slide-relative origin, and writes that into the
    node's absoluteBoundingBox so downstream comparisons see one consistent
    reference frame on both sides.

    Idempotent on already-normalized trees."""
    if not isinstance(slide_node, dict):
        return
    bb = slide_node.get("absoluteBoundingBox") or {}
    slide_ox = bb.get("x") or 0
    slide_oy = bb.get("y") or 0

    def w(n: dict, parent_ax: float, parent_ay: float):
        if not isinstance(n, dict):
            return
        b = n.get("absoluteBoundingBox")
        own_ax = None
        own_ay = None
        if isinstance(b, dict) and b.get("x") is not None:
            # REST-API node: subtract slide origin to get slide-relative.
            own_ax = b["x"] - slide_ox
            own_ay = (b.get("y") or 0) - slide_oy
            b["x"] = own_ax
            b["y"] = own_ay
        else:
            # Plugin node: derive from relativeTransform (parent-relative
            # translation) + parent's slide-absolute position.
            xform = n.get("relativeTransform")
            size = n.get("size") or {}
            local_x = local_y = 0
            if (xform and isinstance(xform, list) and len(xform) >= 2
                    and len(xform[0]) >= 3 and len(xform[1]) >= 3):
                local_x = xform[0][2] or 0
                local_y = xform[1][2] or 0
            own_ax = parent_ax + local_x
            own_ay = parent_ay + local_y
            # Write back so _get_bbox returns slide-absolute on subsequent
            # access, matching the REST side.
            n["absoluteBoundingBox"] = {
                "x": own_ax,
                "y": own_ay,
                "width": size.get("x"),
                "height": size.get("y"),
            }
        for c in n.get("children") or []:
            w(c, own_ax, own_ay)

    # Slide root: position 0,0 in its own frame after normalization. Children
    # accumulate from there.
    if isinstance(bb, dict) and bb.get("x") is not None:
        bb["x"] = 0
        bb["y"] = 0
    for c in slide_node.get("children") or []:
        w(c, 0, 0)


def diff_figma_json(ground_truth_json: dict, prediction_json: dict, initial_json: Optional[dict] = None) -> dict:
    """
    Compare two Figma document JSONs using PPTArena-style structured diff.
    Returns structured diff with normalization, float tolerance, and proper formatting.

    Compares the same property categories as PPTArena's pptx_to_json:
    - Text content (characters)
    - Typography (fontFamily, fontSize, fontWeight, fontStyle, italic, alignment,
                   letterSpacing, lineHeight, textCase, textDecoration)
    - Position/Size (absoluteBoundingBox: x, y, width, height)
    - Rotation, Opacity, Visibility
    - Fills (type, color RGBA)
    - Strokes
    - Effects
    - Children structure (missing/extra nodes)
    """
    differences = []

    gt_slides = _extract_slides(ground_truth_json)
    pred_slides = _extract_slides(prediction_json)
    init_slides = _extract_slides(initial_json) if initial_json else []

    gt_count = len(gt_slides)
    pred_count = len(pred_slides)

    if gt_count != pred_count:
        differences.append({
            "slide_number": 0,
            "shape_name": "presentation",
            "property_path": "slide_count",
            "change_type": "modified",
            "ground_truth_value": gt_count,
            "prediction_value": pred_count,
        })

    # ID-based slide alignment (sourceId-preserved by the plugin). Pred
    # slides whose id matches init → paired; pred slides with a new id →
    # added; init slides whose id is absent from pred → removed. Robust to
    # cross-slide content consolidation because we never use text similarity.
    # Removed entries use init-side position; paired/added entries use
    # pred-side position. The slide_count delta + "Init Slide N (removed)"
    # label together communicate any renumbering — no explicit mapping
    # entry needed (Case 67).
    alignment = _align_slides_by_id(gt_slides, pred_slides)

    # Detect slide reordering: an id-paired slide whose position changed
    # between init and pred. id-based alignment by itself HIDES reorders
    # from the diff (the slide content matches → no diff entries) — we'd
    # otherwise lose the entire "reorder slides" edit (Case 28).
    moves = []
    for gt_idx, pred_idx in alignment:
        if gt_idx is None or pred_idx is None:
            continue
        if gt_idx != pred_idx:
            s = gt_slides[gt_idx]
            # Title-like first text for human-readable label
            label = ""
            def _w(n):
                nonlocal label
                if label or not isinstance(n, dict): return
                c = (n.get("characters") or "").strip()
                if c: label = c[:40]; return
                for ch in n.get("children") or []: _w(ch)
            _w(s)
            moves.append((gt_idx + 1, pred_idx + 1, label))
    if moves:
        summary = ", ".join(f"slide {a} ('{lab}'->{b})" if lab else f"slide {a}->{b}"
                            for a, b, lab in moves[:8])
        differences.append({
            "slide_number": 0,
            "shape_name": "presentation",
            "property_path": "slide_reorder",
            "change_type": "modified",
            "ground_truth_value": f"{len(moves)} slide(s) reordered",
            "prediction_value": summary + (" ..." if len(moves) > 8 else ""),
        })

    import copy as _copy
    for gt_idx, pred_idx in alignment:
        slide_num = ((pred_idx + 1) if pred_idx is not None
                     else (gt_idx + 1) if gt_idx is not None
                     else 0)
        gt_slide = gt_slides[gt_idx] if gt_idx is not None else None
        pred_slide = pred_slides[pred_idx] if pred_idx is not None else None
        init_slide = (init_slides[gt_idx] if (gt_idx is not None and gt_idx < len(init_slides)) else None)

        if gt_slide is None:
            _emit_added_slide(pred_slide, slide_num, differences)
            continue
        if pred_slide is None:
            _emit_removed_slide(gt_slide, slide_num, differences)
            continue

        # Pre-normalize each slide tree so both sides use slide-local
        # coordinates. Deep-copied to avoid mutating the caller's input.
        gt_slide = _copy.deepcopy(gt_slide)
        pred_slide = _copy.deepcopy(pred_slide)
        init_slide = _copy.deepcopy(init_slide) if init_slide else None
        _normalize_slide_bbox_inplace(gt_slide)
        _normalize_slide_bbox_inplace(pred_slide)
        if init_slide:
            _normalize_slide_bbox_inplace(init_slide)

        _diff_nodes_structured(
            gt_slide, pred_slide, init_slide,
            path=f"slide_{slide_num}",
            slide_num=slide_num,
            differences=differences,
            is_slide_frame=True,
        )

    # Cross-parent move detection: when the agent moves a node into a
    # different parent FRAME, our per-parent matcher emits "remove from old
    # parent" + "add to new parent" instead of a single "moved" entry. The
    # plugin preserves the source id across the move (same node, new parent),
    # so we can detect the pair and collapse to a `parent.moved` entry that
    # the judge can interpret as a relocation rather than a delete+create
    # (Case 73: 4 KPI boxes × 3 children = 12 remove+add pairs collapse to
    # 12 moved entries showing 'Revenue Chart → slide root').
    differences = _collapse_reparented_pairs(differences, ground_truth_json, prediction_json)

    # Consolidate bbox axes: merge per-axis x/y/width/height diffs for the
    # same shape into one `bbox` entry. A shape that moves and resizes emits
    # 4 separate entries by default; merging halves+ the entry count without
    # losing information, and reads more naturally in the judge prompt.
    differences = _consolidate_bbox_entries(differences)

    # Dedup: multi-strategy matching + nested wrapper FRAMEs sometimes produce
    # identical entries multiple times (Case 71: each cell font change emitted
    # 4x, filling the 200-entry cap before slide 4 even ran). Key by
    # (slide, shape, path, change_type, gt_val, pred_val) so identical
    # property edits collapse to one entry but legitimate "same shape, same
    # property changed twice" stays separate.
    #
    # When the SAME edit applies to N same-named siblings (Case 92: 6 avatars
    # all get cornerRadius 8→75), naive dedup hides that breadth and the
    # judge reads "diff only explicitly rounds one avatar". Track the
    # collision count and annotate the surviving entry with
    # "(applied to N N-named siblings)" so the judge knows it's a bulk
    # uniform change, not an isolated edit.
    seen: dict = {}
    deduped: list = []
    for d in differences:
        key = (
            d.get("slide_number"),
            d.get("shape_name"),
            d.get("property_path"),
            d.get("change_type"),
            str(d.get("ground_truth_value")),
            str(d.get("prediction_value")),
        )
        if key in seen:
            seen[key] += 1
            continue
        seen[key] = 1
        deduped.append(d)
    for d in deduped:
        key = (
            d.get("slide_number"),
            d.get("shape_name"),
            d.get("property_path"),
            d.get("change_type"),
            str(d.get("ground_truth_value")),
            str(d.get("prediction_value")),
        )
        n = seen.get(key, 1)
        if n > 1:
            d["applied_to_siblings"] = n

    # Similarity score (same formula as PPTArena)
    total_properties = len(deduped) + 100
    similarity_score = max(0.0, min(1.0, 1.0 - (len(deduped) / total_properties)))

    return {
        "has_differences": len(deduped) > 0,
        "similarity_score": similarity_score,
        "total_differences": len(deduped),
        "differences": deduped[:200],  # cap for LLM context
    }


def _extract_slides(doc_json: dict) -> list[dict]:
    """Extract slide frames from a Figma document JSON."""
    slides = []
    document = doc_json.get("document", doc_json)
    children = document.get("children", [])

    for page in children:
        if page.get("type") in ("CANVAS", "PAGE"):
            for child in page.get("children", []):
                if child.get("type") == "SECTION":
                    for frame in child.get("children", []):
                        if frame.get("type") == "FRAME":
                            slides.append(frame)
                elif child.get("type") == "FRAME":
                    slides.append(child)
    return slides


def _match_children(gt_children: list, pred_children: list, init_children: list):
    """Multi-strategy matching of children between GT and Pred.

    Figma API (GT) names nodes by text content ("Company name.", "By"),
    while Plugin (Pred/Initial) uses generic names ("Caption", "Subheader").
    Also handles duplicate names (multiple "Subheader" nodes).

    Strategy:
    1. Exact name match (unique names only)
    2. Characters (text content) match for unmatched nodes
    3. Type + position order match for remaining unmatched nodes

    Returns list of (gt_idx, pred_idx, init_child) tuples.
    gt_idx=None means extra in pred, pred_idx=None means missing from pred.
    """
    matched_gt = set()
    matched_pred = set()
    pairs = []  # (gt_idx, pred_idx)

    # --- Strategy 0: Match by stable node id (sourceId-preserved) ---
    # Under the current INIT-vs-PRED diff design, init and pred come from the
    # SAME figma session: pred is just init after the agent's tool calls, and
    # the plugin preserves source ids end-to-end via setPluginData('sourceId').
    # So nodes that survived the agent's edit keep the same id on both sides;
    # nodes the agent created get brand-new ids only present in pred; nodes
    # the agent deleted only appear in init. ID matching is deterministic and
    # avoids name/text/spatial heuristics from accidentally pairing unrelated
    # wrapper FRAMEs (e.g. an init 'Bar Chart' wrapper with a pred 'Donut
    # Chart' wrapper at the same slide area — they share NO id, so they
    # naturally fall through to Strategy 1/2/3 only when names happen to
    # match — and end up as removed/added if no later strategy pairs them).
    #
    # The earlier GT-vs-PRED concern (different Figma files, independent id
    # namespaces, numerical id collisions like GT '1:39' ≠ pred '1:39') no
    # longer applies because we diff INIT vs PRED (same source).
    gt_id_to_idx: dict = {}
    for i, c in enumerate(gt_children):
        cid = c.get("id")
        if cid:
            gt_id_to_idx.setdefault(cid, i)
    pred_id_to_idx: dict = {}
    for i, c in enumerate(pred_children):
        cid = c.get("id")
        if cid:
            pred_id_to_idx.setdefault(cid, i)
    for cid, gi in gt_id_to_idx.items():
        pi = pred_id_to_idx.get(cid)
        if pi is not None and gi not in matched_gt and pi not in matched_pred:
            pairs.append((gi, pi))
            matched_gt.add(gi)
            matched_pred.add(pi)

    # Build lookup helpers
    init_by_name = {}
    for c in init_children:
        n = c.get("name")
        if n not in init_by_name:
            init_by_name[n] = []
        init_by_name[n].append(c)

    # --- Strategy 1: Exact name match (only for names unique in both sides) ---
    from collections import Counter
    gt_name_counts = Counter(c.get("name") for c in gt_children)
    pred_name_counts = Counter(c.get("name") for c in pred_children)

    gt_name_to_idx = {}
    for i, c in enumerate(gt_children):
        n = c.get("name")
        if gt_name_counts[n] == 1:
            gt_name_to_idx[n] = i

    pred_name_to_idx = {}
    for i, c in enumerate(pred_children):
        n = c.get("name")
        if pred_name_counts[n] == 1:
            pred_name_to_idx[n] = i

    for name in set(gt_name_to_idx.keys()) & set(pred_name_to_idx.keys()):
        gi = gt_name_to_idx[name]
        pi = pred_name_to_idx[name]
        # Skip if Strategy 0 (id) already matched either side — without this
        # check Strategy 1 re-adds (gi, pi) that Strategy 0 already paired,
        # producing duplicate pairs that compound exponentially through
        # nested wrappers (Case 71: 16× per leaf at depth 4).
        if gi in matched_gt or pi in matched_pred:
            continue
        pairs.append((gi, pi))
        matched_gt.add(gi)
        matched_pred.add(pi)

    # --- Strategy 2: Match by characters content for unmatched TEXT nodes ---
    unmatched_gt = [i for i in range(len(gt_children)) if i not in matched_gt]
    unmatched_pred = [i for i in range(len(pred_children)) if i not in matched_pred]

    # Build characters lookup for unmatched pred children
    pred_chars_map = {}  # chars -> [pred_idx, ...]
    for pi in unmatched_pred:
        chars = _normalize_characters(pred_children[pi].get("characters"))
        if chars:
            if chars not in pred_chars_map:
                pred_chars_map[chars] = []
            pred_chars_map[chars].append(pi)

    newly_matched_gt = set()
    newly_matched_pred = set()
    for gi in unmatched_gt:
        chars = _normalize_characters(gt_children[gi].get("characters"))
        if chars and chars in pred_chars_map:
            candidates = [pi for pi in pred_chars_map[chars] if pi not in newly_matched_pred]
            if candidates:
                pi = candidates[0]
                pairs.append((gi, pi))
                newly_matched_gt.add(gi)
                newly_matched_pred.add(pi)

    matched_gt |= newly_matched_gt
    matched_pred |= newly_matched_pred

    # --- Strategy 3: Match by type + spatial-nearest position (was DOM list-order zip) ---
    # Greedy nearest-position pairing within each type group, gated by a max
    # distance threshold so genuine "delete X, add Y at same area" replacements
    # still surface as missing/extra rather than being merged into a modify.
    unmatched_gt = [i for i in range(len(gt_children)) if i not in matched_gt]
    unmatched_pred = [i for i in range(len(pred_children)) if i not in matched_pred]

    # Group by type (with TYPE_EQUIVALENTS so SHAPE_WITH_TEXT≡FRAME etc.)
    gt_by_type: dict = {}
    for gi in unmatched_gt:
        t = gt_children[gi].get("type", "")
        t = _TYPE_EQUIVALENTS.get(t, t)
        gt_by_type.setdefault(t, []).append(gi)

    pred_by_type: dict = {}
    for pi in unmatched_pred:
        t = pred_children[pi].get("type", "")
        t = _TYPE_EQUIVALENTS.get(t, t)
        pred_by_type.setdefault(t, []).append(pi)

    def _xy(node):
        bb = _get_bbox(node) or {}
        x, y = bb.get("x"), bb.get("y")
        if x is None and y is None:
            return None
        return (x or 0.0, y or 0.0)

    _SPATIAL_MAX_DIST = 300.0  # Manhattan px; further pairs stay missing/extra

    def _name_word_jaccard(a: str, b: str) -> float:
        """Word-set Jaccard of two shape names. Lets us reject obviously
        distinct wrapper FRAMEs (e.g. 'Bar Chart' vs 'Donut Chart') from
        the spatial-nearest pairing even when they share an area on the
        slide. Without this, a chart-replacement edit produces dozens of
        bogus "modified" diffs on the inner bars vs slices."""
        if not a or not b: return 0.0
        if a == b: return 1.0
        aw = {w for w in a.lower().split() if w}
        bw = {w for w in b.lower().split() if w}
        if not aw or not bw: return 0.0
        return len(aw & bw) / len(aw | bw)

    def _is_wrapper(node: dict) -> bool:
        return bool(node.get("children"))

    for t in set(gt_by_type.keys()) & set(pred_by_type.keys()):
        gt_indices = list(gt_by_type[t])
        pred_indices = list(pred_by_type[t])
        gt_pos = {gi: _xy(gt_children[gi]) for gi in gt_indices}
        pred_pos = {pi: _xy(pred_children[pi]) for pi in pred_indices}
        # If positions are missing on either side (e.g., page-level nodes
        # with no bbox/transform), fall back to DOM-order zip pairing.
        spatial_ok = (all(v is not None for v in gt_pos.values())
                      and all(v is not None for v in pred_pos.values()))
        if spatial_ok:
            pred_used = set()
            for gi in gt_indices:
                gx, gy = gt_pos[gi]
                best_pi, best_d = None, float("inf")
                for pi in pred_indices:
                    if pi in pred_used:
                        continue
                    px, py = pred_pos[pi]
                    d = abs(px - gx) + abs(py - gy)
                    if d < best_d:
                        best_d, best_pi = d, pi
                if best_pi is not None and best_d <= _SPATIAL_MAX_DIST:
                    # Wrapper FRAMEs (have children) often live in similar
                    # slide regions even when they represent different things
                    # (e.g. an old bar chart vs a new donut chart placed in
                    # the same chart area). Require some name overlap before
                    # spatially pairing such wrappers — otherwise leave them
                    # as removed/added so the diff reports the replacement
                    # honestly. Leaf shapes (no children) still pair by
                    # spatial alone since their identity is mostly position.
                    g_node = gt_children[gi]
                    p_node = pred_children[best_pi]
                    if _is_wrapper(g_node) or _is_wrapper(p_node):
                        if _name_word_jaccard(g_node.get("name",""),
                                              p_node.get("name","")) < 0.5:
                            continue
                    pairs.append((gi, best_pi))
                    matched_gt.add(gi)
                    matched_pred.add(best_pi)
                    pred_used.add(best_pi)
        else:
            for gi, pi in zip(gt_indices, pred_indices):
                pairs.append((gi, pi))
                matched_gt.add(gi)
                matched_pred.add(pi)

    # --- Build final result with init_child lookup ---
    result = []
    for gi, pi in pairs:
        # Find init_child: try matching by pred name first (pred comes from init),
        # then by gt name
        pred_name = pred_children[pi].get("name")
        gt_name = gt_children[gi].get("name")
        init_child = None
        if pred_name in init_by_name and init_by_name[pred_name]:
            init_child = init_by_name[pred_name].pop(0)
        elif gt_name in init_by_name and init_by_name[gt_name]:
            init_child = init_by_name[gt_name].pop(0)
        result.append((gi, pi, init_child))

    # Unmatched GT children (missing in pred)
    for gi in range(len(gt_children)):
        if gi not in matched_gt:
            result.append((gi, None, None))

    # Unmatched Pred children (extra in pred)
    for pi in range(len(pred_children)):
        if pi not in matched_pred:
            result.append((None, pi, None))

    return result


def _diff_nodes_structured(
    gt_node: dict, pred_node: dict, init_node: Optional[dict],
    path: str, slide_num: int, differences: list,
    is_slide_frame: bool = False,
):
    """Recursively diff two Figma nodes with PPTArena-style normalization and tolerance.

    Compares:
    - type (with SHAPE_WITH_TEXT ≡ FRAME normalization)
    - characters (text content, with empty/None normalization)
    - visible, opacity, rotation
    - style properties (font, alignment, spacing)
    - absoluteBoundingBox (position/size with tolerance; x/y skipped for slide frames)
    - fills (color RGBA with tolerance)
    - strokes
    - children structure (name-matched recursive comparison)
    """
    shape_name = gt_node.get('name', '?')
    # When the node is a non-TEXT container (FRAME / RECTANGLE / ELLIPSE),
    # append its descendant text snippet to the shape_name so the judge can
    # tell which semantic entity a generic name like 'Step 1' represents
    # (Case 98: 'Step 1' container holds 'Mars Sample Return' text; without
    # this, judge can't link slide-2 'at risk' projects to slide-3 timeline
    # color changes).
    _gt_type_raw = gt_node.get('type', '')
    if _gt_type_raw in ('FRAME', 'RECTANGLE', 'ELLIPSE', 'GROUP'):
        _container_text = _gather_text_content(gt_node)
        if _container_text:
            shape_name = f"{shape_name} (text: {_container_text[:80]})"
    elif _gt_type_raw == 'TEXT':
        # For TEXT nodes, the node `name` is just a layer label (often
        # generic like 'Label', 'Text', 'H2') — append the actual characters
        # so the judge knows what the text says (Case 79: 'Label' TEXT
        # contains 'Segment A' which IS the pie legend; without the text
        # the judge dismisses it as a "generic Label").
        _chars = (gt_node.get('characters') or '').strip()
        if _chars and _chars.lower() != shape_name.lower():
            shape_name = f"{shape_name} (text: {_chars[:80]})"

    # --- Compare type (with normalization) ---
    gt_type = gt_node.get('type', '')
    pred_type = pred_node.get('type', '')
    gt_type_norm = _TYPE_EQUIVALENTS.get(gt_type, gt_type)
    pred_type_norm = _TYPE_EQUIVALENTS.get(pred_type, pred_type)
    if gt_type_norm != pred_type_norm:
        init_type = init_node.get('type', '') if init_node else None
        init_type_norm = _TYPE_EQUIVALENTS.get(init_type, init_type) if init_type is not None else None
        if not (init_node is not None and init_type_norm == gt_type_norm):
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.type",
                "change_type": "modified",
                "ground_truth_value": gt_type,
                "prediction_value": pred_type,
            })

    # --- Compare characters (text content) with normalization ---
    gt_chars = _normalize_characters(gt_node.get('characters'))
    pred_chars = _normalize_characters(pred_node.get('characters'))
    if gt_chars != pred_chars:
        init_chars = _normalize_characters(init_node.get('characters')) if init_node else None
        differences.append({
            "slide_number": slide_num,
            "shape_name": shape_name,
            "property_path": f"{path}.characters",
            "change_type": "modified",
            "ground_truth_value": gt_chars if gt_chars else "(empty)",
            "prediction_value": pred_chars if pred_chars else "(empty)",
            "initial_value": init_chars,
        })

    # --- Compare per-character style overrides on TEXT nodes ---
    # Figma applies word-level highlighting (e.g. teal+bold for key phrases)
    # via `characterStyleOverrides` (index array) + `styleOverrideTable`
    # (style dict per index). Without surfacing these, an agent's actual
    # in-place highlighting reads as "Body.fills.count 1→0 = text deleted"
    # because the overall fill is removed when per-char overrides take over.
    if gt_type == "TEXT" and pred_type == "TEXT":
        gt_table = gt_node.get('styleOverrideTable') or {}
        pred_table = pred_node.get('styleOverrideTable') or {}
        # Compare style entries by key
        added_keys = sorted(set(pred_table.keys()) - set(gt_table.keys()))
        removed_keys = sorted(set(gt_table.keys()) - set(pred_table.keys()))
        modified_keys = [k for k in (set(gt_table.keys()) & set(pred_table.keys()))
                         if gt_table.get(k) != pred_table.get(k)]
        for k in added_keys:
            ps = pred_table[k]
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.styleOverrideTable[{k}]",
                "change_type": "added",
                "ground_truth_value": None,
                "prediction_value": _summarize_text_style(ps),
            })
        for k in removed_keys:
            gs = gt_table[k]
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.styleOverrideTable[{k}]",
                "change_type": "removed",
                "ground_truth_value": _summarize_text_style(gs),
                "prediction_value": None,
            })
        for k in modified_keys:
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.styleOverrideTable[{k}]",
                "change_type": "modified",
                "ground_truth_value": _summarize_text_style(gt_table[k]),
                "prediction_value": _summarize_text_style(pred_table[k]),
            })

        # Compare the per-character index array — surface which character
        # ranges got the new style applied (e.g. which words went teal+bold).
        gt_idx = gt_node.get('characterStyleOverrides') or []
        pred_idx = pred_node.get('characterStyleOverrides') or []
        if gt_idx != pred_idx:
            chars_str = pred_node.get('characters') or ''
            # Build ranges where pred_idx differs from gt_idx (or gt was 0)
            ranges = _diff_character_ranges(gt_idx, pred_idx, chars_str)
            if ranges:
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.characterStyleOverrides",
                    "change_type": "modified",
                    "ground_truth_value": f"{len(gt_idx)} chars styled",
                    "prediction_value": "styled ranges: " + " | ".join(ranges[:8]),
                })

        # --- Compare per-line bullet/list markers (lineTypes) + indentation
        # levels (lineIndentations). Bullets are stored separately from
        # character-style overrides; without this comparator, an agent that
        # removes UNORDERED markers entirely and just adds tab-character
        # indentation reads as "no list-structure change" — Case 58 IF=5
        # despite the bullet symbols being gone.
        gt_lt = gt_node.get('lineTypes') or []
        pred_lt = pred_node.get('lineTypes') or []
        if gt_lt != pred_lt:
            def _summarize_line_types(lt):
                if not lt: return "(none — plain text)"
                from collections import Counter
                cnt = Counter(lt)
                parts = [f"{n}×{t}" for t, n in cnt.most_common()]
                return f"{len(lt)} lines: " + ", ".join(parts)
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.lineTypes",
                "change_type": "modified",
                "ground_truth_value": _summarize_line_types(gt_lt),
                "prediction_value": _summarize_line_types(pred_lt),
            })
        gt_li = gt_node.get('lineIndentations') or []
        pred_li = pred_node.get('lineIndentations') or []
        if gt_li != pred_li:
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.lineIndentations",
                "change_type": "modified",
                "ground_truth_value": str(gt_li) if gt_li else "(none)",
                "prediction_value": str(pred_li) if pred_li else "(none)",
            })

    # --- Compare slide transitions (synthetic field set by
    # _inject_transitions_into_doc; the plugin strips this from
    # snapshot-*-structure.json so we re-inject from snapshot-*.json) ---
    gt_tr = gt_node.get('_transition')
    pred_tr = pred_node.get('_transition')
    if gt_tr or pred_tr:
        if gt_tr != pred_tr:
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}._transition",
                "change_type": "modified",
                "ground_truth_value": gt_tr,
                "prediction_value": pred_tr,
            })

    # --- Compare semantic properties (visible, opacity) ---
    for prop in ['visible', 'opacity']:
        gt_val = gt_node.get(prop)
        pred_val = pred_node.get(prop)
        if gt_val is None and pred_val is None:
            continue
        if gt_val is None or pred_val is None:
            continue
        if not _values_match(gt_val, pred_val):
            # Skip if init == gt (property unchanged by instruction → schema noise)
            init_val = init_node.get(prop) if init_node else None
            if init_node is not None and init_val is not None and _values_match(init_val, gt_val):
                continue
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.{prop}",
                "change_type": "modified",
                "ground_truth_value": gt_val,
                "prediction_value": pred_val,
                "initial_value": init_val,
            })

    # --- Compare rotation (handle radians vs degrees) ---
    gt_rot = gt_node.get('rotation')
    pred_rot = pred_node.get('rotation')
    if gt_rot is not None and pred_rot is not None:
        # Normalize both to degrees [0, 360)
        gt_deg = _normalize_rotation_to_degrees(gt_rot)
        pred_deg = _normalize_rotation_to_degrees(pred_rot)
        if not _values_match(gt_deg, pred_deg):
            # Skip if init == gt (property unchanged by instruction → schema noise)
            init_deg = (round(_normalize_rotation_to_degrees(init_node.get('rotation', 0)), 2)
                        if init_node else None)
            if init_node is not None and init_deg is not None and _values_match(init_deg, gt_deg):
                pass  # Schema mismatch, not a real change
            else:
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.rotation",
                    "change_type": "modified",
                    "ground_truth_value": round(gt_deg, 2),
                    "prediction_value": round(pred_deg, 2),
                    "initial_value": init_deg,
                })

    # --- Compare style properties (typography) ---
    gt_style = gt_node.get("style", {})
    pred_style = pred_node.get("style", {})
    init_style = init_node.get("style", {}) if init_node else {}
    # Also check top-level for properties that may be outside style in some JSON formats
    for prop in _STYLE_PROPS:
        gt_val = gt_style.get(prop) if gt_style.get(prop) is not None else gt_node.get(prop)
        pred_val = pred_style.get(prop) if pred_style.get(prop) is not None else pred_node.get(prop)
        init_val = (init_style.get(prop) if init_style.get(prop) is not None else
                    init_node.get(prop) if init_node else None)

        # Apply default value normalization:
        # GT (Figma API) often omits defaults, Pred (Plugin) sets them explicitly
        if prop in _STYLE_DEFAULTS:
            if gt_val is None:
                gt_val = _STYLE_DEFAULTS[prop]
            if pred_val is None:
                pred_val = _STYLE_DEFAULTS[prop]
            if init_val is None:
                init_val = _STYLE_DEFAULTS[prop]

        # Skip if both missing
        if gt_val is None and pred_val is None:
            continue
        # Skip if only one side is missing (likely schema difference, not a real change)
        if gt_val is not None and pred_val is None:
            continue
        if gt_val is None and pred_val is not None:
            continue
        if not _values_match(gt_val, pred_val):
            # Skip if init == gt (property unchanged by instruction → schema noise)
            if init_node is not None and init_val is not None and _values_match(init_val, gt_val):
                continue
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.style.{prop}",
                "change_type": "modified",
                "ground_truth_value": gt_val,
                "prediction_value": pred_val,
                "initial_value": init_val,
            })

    # --- Compare position/size (REST absoluteBoundingBox or Plugin size+relativeTransform) ---
    # Skip x/y for slide-level frames: canvas position is layout, not semantic
    compare_pos_props = ['width', 'height'] if is_slide_frame else _POSITION_PROPS
    gt_bbox = _get_bbox(gt_node)
    pred_bbox = _get_bbox(pred_node)
    init_bbox = _get_bbox(init_node)
    for prop in compare_pos_props:
        gt_val = gt_bbox.get(prop)
        pred_val = pred_bbox.get(prop)
        if gt_val is None and pred_val is None:
            continue
        if gt_val is None or pred_val is None:
            continue
        # Unified ±1% relative tolerance (matches PPTArena)
        if not _values_match(gt_val, pred_val):
            # Skip if init == gt (property unchanged by instruction → schema noise)
            init_val = init_bbox.get(prop)
            if (init_node is not None and init_val is not None
                    and _values_match(init_val, gt_val)):
                continue
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.boundingBox.{prop}",
                "change_type": "modified",
                "ground_truth_value": round(gt_val, 2) if isinstance(gt_val, float) else gt_val,
                "prediction_value": round(pred_val, 2) if isinstance(pred_val, float) else pred_val,
                "initial_value": init_val,
            })

    # --- Compare autolayout properties (Figma FRAME container layout) ---
    # Without these, an agent's "wrap children in an auto-layout frame" edit
    # is invisible (Case 60: agent set a new 'Teams' FRAME with
    # layoutMode=HORIZONTAL but the diff said nothing about layout).
    for prop in ("layoutMode", "primaryAxisAlignItems", "counterAxisAlignItems",
                 "itemSpacing", "paddingLeft", "paddingRight",
                 "paddingTop", "paddingBottom"):
        gt_val = gt_node.get(prop)
        pred_val = pred_node.get(prop)
        # Treat None as default ("NONE" for mode, 0 for spacing/padding)
        def _norm_layout(p, v):
            if v is not None: return v
            if p in ("layoutMode",): return "NONE"
            if p in ("primaryAxisAlignItems", "counterAxisAlignItems"): return "MIN"
            return 0
        gv = _norm_layout(prop, gt_val)
        pv = _norm_layout(prop, pred_val)
        if gv == pv:
            continue
        if isinstance(gv, (int, float)) and isinstance(pv, (int, float)) and _values_match(gv, pv):
            continue
        init_val = init_node.get(prop) if init_node else None
        iv = _norm_layout(prop, init_val) if init_node is not None else None
        if init_node is not None and iv == gv:
            continue
        differences.append({
            "slide_number": slide_num,
            "shape_name": shape_name,
            "property_path": f"{path}.{prop}",
            "change_type": "modified",
            "ground_truth_value": gv,
            "prediction_value": pv,
        })

    # --- Compare fills (color RGBA with tolerance) ---
    # Previously skipped fills/strokes for VECTOR nodes — that was a GT-vs-PRED
    # workaround for Plugin↔REST schema drift (stroke→fill swaps). Under the
    # current INIT-vs-PRED design both sides are from the same plugin, so the
    # skip is no longer needed and was MASKING real edits (Case 45: agent
    # recolored 316×522 VECTOR background shapes for Growth/Opportunity/
    # Decrease boxes — the diff missed all of those). Compare fills uniformly.
    _is_vector = False

    gt_fills = [f for f in gt_node.get("fills", [])
                if f.get("visible", True) is not False]
    pred_fills = [f for f in pred_node.get("fills", [])
                  if f.get("visible", True) is not False]
    init_fills = ([f for f in init_node.get("fills", [])
                   if f.get("visible", True) is not False]
                  if init_node else [])
    # Suppress overall TEXT fill-count diff when per-character style overrides
    # exist on the pred node. Agent removes the container fill and replaces it
    # with per-char styled spans (highlighting). Without this guard, the diff
    # surfaces `fills.count: 1->0` which the judge misreads as "text deleted".
    _text_has_overrides = (
        (gt_type_norm == 'TEXT' or pred_type_norm == 'TEXT')
        and bool(pred_node.get('characterStyleOverrides') or [])
    )
    if not _is_vector and not _text_has_overrides:
        if len(gt_fills) != len(pred_fills):
            # Skip if init fill count == gt fill count (schema noise)
            if not (init_node is not None and len(init_fills) == len(gt_fills)):
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.fills.count",
                    "change_type": "modified",
                    "ground_truth_value": len(gt_fills),
                    "prediction_value": len(pred_fills),
                })
        else:
            for j, (gf, pf) in enumerate(zip(gt_fills, pred_fills)):
                inf = init_fills[j] if j < len(init_fills) else {}
                # Compare fill type
                gt_ftype = gf.get("type")
                pred_ftype = pf.get("type")
                if gt_ftype != pred_ftype and gt_ftype is not None and pred_ftype is not None:
                    init_ftype = inf.get("type") if inf else None
                    if not (init_node is not None and init_ftype == gt_ftype):
                        differences.append({
                            "slide_number": slide_num,
                            "shape_name": shape_name,
                            "property_path": f"{path}.fills[{j}].type",
                            "change_type": "modified",
                            "ground_truth_value": gt_ftype,
                            "prediction_value": pred_ftype,
                        })
                # Compare fill color — emit ONE entry per fill (combined rgba),
                # not per channel. A box recolor used to produce 3 entries
                # (r, g, b) which inflated the diff and split the change
                # across rows; consolidating to one rgba string is clearer
                # for the judge AND saves tokens.
                gt_color = gf.get("color", {})
                pred_color = pf.get("color", {})
                init_color = inf.get("color", {}) if inf else {}
                if gt_color and pred_color:
                    diff_chans = []
                    for ch in ["r", "g", "b", "a"]:
                        gv = gt_color.get(ch)
                        pv = pred_color.get(ch)
                        if gv is not None and pv is not None and not _color_channel_match(gv, pv):
                            iv = init_color.get(ch)
                            # Skip if init color == gt color (unchanged → schema noise)
                            if init_node is not None and iv is not None and _color_channel_match(iv, gv):
                                continue
                            diff_chans.append(ch)
                    if diff_chans:
                        def _fmt(c):
                            return (f"rgba({round(c.get('r',0),3)}, {round(c.get('g',0),3)}, "
                                    f"{round(c.get('b',0),3)}, {round(c.get('a',1),3)})")
                        differences.append({
                            "slide_number": slide_num,
                            "shape_name": shape_name,
                            "property_path": f"{path}.fills[{j}].color",
                            "change_type": "modified",
                            "ground_truth_value": _fmt(gt_color),
                            "prediction_value": _fmt(pred_color),
                            "initial_value": _fmt(init_color) if init_color else None,
                        })

    # --- Compare strokes ---
    # When a stroke is added/removed/modified, surface its color + weight too
    # — without these the judge sees "strokes.count: 0 → 1" and cannot tell
    # whether the border is thin/thick or dark/light (Case 82).
    gt_strokes = gt_node.get("strokes", [])
    pred_strokes = pred_node.get("strokes", [])
    init_strokes = init_node.get("strokes", []) if init_node else []
    gt_sw = gt_node.get("strokeWeight")
    pred_sw = pred_node.get("strokeWeight")
    init_sw = init_node.get("strokeWeight") if init_node else None

    def _stroke_summary(strokes: list, sw) -> str:
        if not strokes:
            return "none"
        first = strokes[0]
        c = first.get("color") or {}
        color_str = (f"rgba({round(c.get('r',0),3)},{round(c.get('g',0),3)},"
                     f"{round(c.get('b',0),3)},{round(c.get('a',1),3)})") if c else "?"
        return f"{len(strokes)}× {color_str} weight={sw}"

    if not _is_vector and len(gt_strokes) != len(pred_strokes):
        if gt_strokes or pred_strokes:  # Skip if both empty
            # Skip if init stroke count == gt stroke count (schema noise)
            if not (init_node is not None and len(init_strokes) == len(gt_strokes)):
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.strokes",
                    "change_type": "modified",
                    "ground_truth_value": _stroke_summary(gt_strokes, gt_sw),
                    "prediction_value": _stroke_summary(pred_strokes, pred_sw),
                })
    elif not _is_vector and gt_strokes and pred_strokes:
        # Same count, compare color of first stroke + weight
        gf = gt_strokes[0]
        pf = pred_strokes[0]
        gc = gf.get("color") or {}
        pc = pf.get("color") or {}
        color_differs = any(
            (gc.get(ch) is not None and pc.get(ch) is not None
             and not _color_channel_match(gc.get(ch), pc.get(ch)))
            for ch in ("r", "g", "b", "a")
        )
        weight_differs = (gt_sw is not None and pred_sw is not None
                          and not _values_match(gt_sw, pred_sw))
        if color_differs or weight_differs:
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.strokes",
                "change_type": "modified",
                "ground_truth_value": _stroke_summary(gt_strokes, gt_sw),
                "prediction_value": _stroke_summary(pred_strokes, pred_sw),
            })

    # --- Compare effects (shadows, blur, etc.) ---
    gt_effects = gt_node.get("effects", [])
    pred_effects = pred_node.get("effects", [])
    init_effects = init_node.get("effects", []) if init_node else []
    if len(gt_effects) != len(pred_effects):
        if gt_effects or pred_effects:
            # Skip if init effect count == gt effect count (schema noise)
            if not (init_node is not None and len(init_effects) == len(gt_effects)):
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.effects.count",
                    "change_type": "modified",
                    "ground_truth_value": len(gt_effects),
                    "prediction_value": len(pred_effects),
                })

    # --- Compare cornerRadius (shape rounding) ---
    # An avatar/icon being made circular shows as RECTANGLE.cornerRadius going
    # from a small value to half the side length. Without this comparison the
    # diff missed the agent's edit entirely (Case 92).
    gt_cr = gt_node.get("cornerRadius")
    pred_cr = pred_node.get("cornerRadius")
    init_cr = init_node.get("cornerRadius") if init_node else None
    if gt_cr is not None and pred_cr is not None and not _values_match(gt_cr, pred_cr):
        if not (init_node is not None and init_cr is not None and _values_match(init_cr, gt_cr)):
            differences.append({
                "slide_number": slide_num,
                "shape_name": shape_name,
                "property_path": f"{path}.cornerRadius",
                "change_type": "modified",
                "ground_truth_value": round(gt_cr, 2) if isinstance(gt_cr, float) else gt_cr,
                "prediction_value": round(pred_cr, 2) if isinstance(pred_cr, float) else pred_cr,
            })
    # Also check per-corner radii in case agent set different values per corner
    gt_rcr = gt_node.get("rectangleCornerRadii")
    pred_rcr = pred_node.get("rectangleCornerRadii")
    if (isinstance(gt_rcr, list) and isinstance(pred_rcr, list)
            and gt_rcr != pred_rcr):
        # Only emit when uniform cornerRadius didn't already cover it
        if gt_cr is None or pred_cr is None or not _values_match(gt_cr, pred_cr):
            init_rcr = init_node.get("rectangleCornerRadii") if init_node else None
            if not (init_node is not None and init_rcr == gt_rcr):
                differences.append({
                    "slide_number": slide_num,
                    "shape_name": shape_name,
                    "property_path": f"{path}.rectangleCornerRadii",
                    "change_type": "modified",
                    "ground_truth_value": gt_rcr,
                    "prediction_value": pred_rcr,
                })

    # --- Recurse into children (multi-strategy matching) ---
    # Figma API (GT) and Figma Plugin (Pred) use different naming conventions:
    # - API names nodes by text content ("Company name.", "By", etc.)
    # - Plugin uses generic component names ("Caption", "Subheader", etc.)
    # Also handles duplicate names (multiple "Subheader" nodes).
    gt_children = gt_node.get("children", [])
    pred_children = pred_node.get("children", [])
    init_children = init_node.get("children", []) if init_node else []

    matched_pairs = _match_children(gt_children, pred_children, init_children)

    # --- Detect z-order (sibling reordering) ---
    # Figma's `children` array order IS the z-order (first child = bottom layer,
    # last = top). When matched pairs preserve identity but change indices,
    # the agent reordered siblings. Emit one diff per moved child so the judge
    # sees "Frame 3 moved from layer 1 → 2". Include the child's text content
    # so the judge knows WHICH semantic row moved (critical for table-sort
    # cases like Case 61 — without text, "Row 0 moved" is meaningless).
    moved = []
    for gt_idx, pred_idx, _ in matched_pairs:
        if gt_idx is None or pred_idx is None:
            continue
        if gt_idx != pred_idx:
            child = gt_children[gt_idx]
            txt = _gather_text_content(child)[:120]
            # Identify FRAMEs/RECTANGLEs whose fill is an IMAGE — those nodes
            # ARE pictures, not "empty frames". Without this tag, a z-order
            # change on a picture-bearing FRAME reads as "moved an unrelated
            # frame" (Case 62).
            visual_tag = _summarize_visual_nature(child)
            moved.append((child.get("name", "?"), child.get("type", "?"), gt_idx, pred_idx, txt, visual_tag))
    if len(moved) >= 3:
        # Surface a single REORDER summary line on top of per-child entries,
        # so a table-sort doesn't read as N independent layer shuffles.
        summary = ", ".join(f"{n}{v}@{gi}->{pi}" for n, _, gi, pi, _, v in moved[:8])
        differences.append({
            "slide_number": slide_num,
            "shape_name": path.split('.')[-1] or "?",
            "property_path": f"{path}.children.reorder",
            "change_type": "modified",
            "ground_truth_value": f"{len(moved)} siblings reordered",
            "prediction_value": summary + (" ..." if len(moved) > 8 else ""),
        })
    for name, ctype, gi, pi, txt, vtag in moved:
        text_blurb = f' text="{txt}"' if txt else ""
        differences.append({
            "slide_number": slide_num,
            "shape_name": name,
            "property_path": f"{path}.zOrder",
            "change_type": "modified",
            "ground_truth_value": f"layer index {gi} (type: {ctype}{vtag}){text_blurb}",
            "prediction_value": f"layer index {pi}",
        })

    for gt_idx, pred_idx, init_child in matched_pairs:
        if gt_idx is not None and pred_idx is not None:
            gt_child = gt_children[gt_idx]
            pred_child = pred_children[pred_idx]
            child_name = gt_child.get("name", "?")
            _diff_nodes_structured(
                gt_child, pred_child, init_child,
                path=f"{path}.{child_name}",
                slide_num=slide_num,
                differences=differences,
            )
        elif gt_idx is not None:
            gt_child = gt_children[gt_idx]
            child_name = gt_child.get("name", "?")
            child_type = gt_child.get("type", "?")
            # Surface the deleted node's actual text content (recursively
            # gathered) so the judge can verify what was lost — without this,
            # the diff just says "child 'X' removed" with no content hint.
            child_texts = _gather_text_content(gt_child)
            text_blurb = f" text=\"{child_texts[:200]}\"" if child_texts else ""
            contains_blurb = _summarize_descendant_types(gt_child)
            visual_tag = _summarize_visual_nature(gt_child)
            bb = _get_bbox(gt_child)
            bbox_blurb = (
                f" at xy=({round(bb.get('x'),1)},{round(bb.get('y'),1)})"
                f" wh=({round(bb.get('width'),1)},{round(bb.get('height'),1)})"
                if bb and bb.get('x') is not None else ""
            )
            init_match = next(
                (ic for ic in init_children
                 if ic.get("name") == child_name and ic.get("type") == child_type),
                None,
            )
            differences.append({
                "slide_number": slide_num,
                "shape_name": child_name,
                "property_path": f"{path}.children",
                "change_type": "removed",
                "ground_truth_value": f"child '{child_name}' (type: {child_type}{visual_tag}){bbox_blurb}{contains_blurb}{text_blurb}",
                "prediction_value": None,
                "initial_value": (
                    f"child '{child_name}' (type: {child_type}{visual_tag}){bbox_blurb}{contains_blurb}{text_blurb}"
                    if init_match is not None else None
                ),
            })
        elif pred_idx is not None:
            pred_child = pred_children[pred_idx]
            child_name = pred_child.get("name", "?")
            child_type = pred_child.get("type", "?")
            # Surface the added node's actual text content so the judge can
            # verify the inserted content (e.g. that a 'date-footer' TEXT
            # contains 'February 9, 2026', or that a slide-number-footer
            # contains the actual page number).
            child_texts = _gather_text_content(pred_child)
            text_blurb = f" text=\"{child_texts[:200]}\"" if child_texts else ""
            contains_blurb = _summarize_descendant_types(pred_child)
            visual_tag = _summarize_visual_nature(pred_child)
            bb = _get_bbox(pred_child)
            bbox_blurb = (
                f" at xy=({round(bb.get('x'),1)},{round(bb.get('y'),1)})"
                f" wh=({round(bb.get('width'),1)},{round(bb.get('height'),1)})"
                if bb and bb.get('x') is not None else ""
            )
            init_match = next(
                (ic for ic in init_children
                 if ic.get("name") == child_name and ic.get("type") == child_type),
                None,
            )
            differences.append({
                "slide_number": slide_num,
                "shape_name": child_name,
                "property_path": f"{path}.children",
                "change_type": "added",
                "ground_truth_value": None,
                "prediction_value": f"child '{child_name}' (type: {child_type}{visual_tag}){bbox_blurb}{contains_blurb}{text_blurb}",
                "initial_value": (
                    f"child '{child_name}' (type: {child_type}{visual_tag}){bbox_blurb}{contains_blurb}{text_blurb}"
                    if init_match is not None else None
                ),
            })


_SNAPSHOT_NON_TEXT_TYPES = (
    "RECTANGLE", "ELLIPSE", "VECTOR", "LINE",
    "POLYGON", "STAR", "REGULAR_POLYGON",
)


def _format_init_snapshot(init_doc: dict, max_shapes_per_slide: int = 120,
                           max_text_chars: int = 200) -> str:
    """Compact per-slide content snapshot of the INITIAL state.

    The diff alone shows only DELTAS — so a slide the agent didn't touch
    looks identical to a slide the agent skipped, even when the instruction
    was "apply X to every slide". This snapshot lets the judge verify
    whether unchanged slides were ALREADY in the requested state (Case 22:
    slides 1/6/10/12 had no Title or were already CENTER-aligned, so the
    agent correctly left them alone — the diff has no entry for them and
    the judge previously misread that as "skipped").

    Walks each slide and collects shape descriptors, then applies a run-length
    dedup so chart bars / table cells / repeated decorative shapes don't blow
    the per-slide budget (Case 33: one chart-rich slide had 208+ elements
    truncated; with dedup the same data fits comfortably).
    """
    slides = _extract_slides(init_doc)
    if not slides:
        return ""

    def fill_descriptor(node):
        """Return (color_str, full_str) where color_str is what we show in
        the line and full_str is the dedup-key fingerprint. For GRADIENTs
        we now extract the actual stop colors so a 'is anything still purple?'
        check is possible (Case 33: chart bars are GRADIENT_LINEAR with
        purple stops; the old snapshot showed just 'GRADIENT_LINEAR' and the
        judge couldn't verify color completeness)."""
        for f in node.get("fills") or []:
            if f.get("visible") is False:
                continue
            t = f.get("type") or ""
            if t == "SOLID":
                c = f.get("color") or {}
                r = int(round((c.get("r") or 0) * 255))
                g = int(round((c.get("g") or 0) * 255))
                b = int(round((c.get("b") or 0) * 255))
                hexstr = f"#{r:02x}{g:02x}{b:02x}"
                return hexstr, hexstr
            if t == "IMAGE":
                return "IMAGE", "IMAGE"
            if t and t.startswith("GRADIENT"):
                stops = f.get("gradientStops") or []
                stop_hexes = []
                for s in stops:
                    c = s.get("color") or {}
                    r = int(round((c.get("r") or 0) * 255))
                    g = int(round((c.get("g") or 0) * 255))
                    b = int(round((c.get("b") or 0) * 255))
                    stop_hexes.append(f"#{r:02x}{g:02x}{b:02x}")
                if stop_hexes:
                    descr = f"{t}({'→'.join(stop_hexes)})"
                    return descr, descr
                return t, t
        return "", ""

    def collect_text(node, ox, oy):
        bb = _get_bbox(node) or {}
        x = (bb.get("x") or 0) - ox
        y = (bb.get("y") or 0) - oy
        w = bb.get("width") or 0
        h = bb.get("height") or 0
        if (w or 0) < 1 and (h or 0) < 1: return None
        if h < 1: return None
        chars = (node.get("characters") or "").strip()
        if not chars: return None
        if len(chars) > max_text_chars:
            chars = chars[:max_text_chars] + "..."
        st = node.get("style") or {}
        ff = st.get("fontFamily") or ""
        fw = st.get("fontWeight")
        fs = st.get("fontSize")
        align = st.get("textAlignHorizontal") or ""
        color, _ = fill_descriptor(node)
        weight = ""
        if isinstance(fw, (int, float)) and fw >= 600: weight = " bold"
        if st.get("italic"): weight += " italic"
        return {
            "kind": "TEXT", "x": x, "y": y, "w": w, "h": h, "chars": chars,
            "font": (ff + weight, int(fs) if fs else None),
            "align": align, "color": color,
        }

    def collect_visual(node, ox, oy):
        t = node.get("type") or ""
        is_visual = (t in _SNAPSHOT_NON_TEXT_TYPES)
        if not is_visual and t == "FRAME":
            # A FRAME with ANY visible fill (SOLID/GRADIENT/IMAGE) is a
            # visually-meaningful shape — chart bars, decorative blocks,
            # background panels. Treat as a visual leaf. Bare wrapper FRAMEs
            # with no fill keep being pure containers (recursed into, not
            # emitted) — those are layout/grouping nodes. (Case 33: chart
            # bars are FRAMEs with SOLID #331a8c purple; without this they
            # were invisible to the snapshot and the judge couldn't verify
            # color completeness.)
            for f in node.get("fills") or []:
                if f.get("visible", True) is False:
                    continue
                ft = f.get("type") or ""
                if ft in ("SOLID", "IMAGE") or ft.startswith("GRADIENT"):
                    is_visual = True; break
        if not is_visual: return None
        if node.get("visible") is False: return None
        bb = _get_bbox(node) or {}
        x = (bb.get("x") or 0) - ox
        y = (bb.get("y") or 0) - oy
        w = bb.get("width") or 0
        h = bb.get("height") or 0
        if (w or 0) < 1 and (h or 0) < 1 and t != "LINE": return None
        color, color_key = fill_descriptor(node)
        cr = node.get("cornerRadius")
        return {
            "kind": t, "x": x, "y": y, "w": w, "h": h,
            "color": color, "color_key": color_key,
            "cr": cr if isinstance(cr, (int, float)) and cr else None,
        }

    def fmt_shape(s):
        bb_str = f"@({round(s['x'],1)},{round(s['y'],1)}) {round(s['w'],1)}×{round(s['h'],1)}"
        if s["kind"] == "TEXT":
            ff, fs = s["font"]
            font_str = ""
            if ff or fs:
                font_str = f"  {ff} {fs}px".strip() if fs else f"  {ff}".strip()
                font_str = "  " + font_str if font_str.startswith(" ") else "  " + font_str
            align_str = f"  align={s['align']}" if s["align"] else ""
            color_str = f"  {s['color']}" if s["color"] else ""
            return f'TEXT "{s["chars"]}"  {bb_str}{font_str}{align_str}{color_str}'
        fill_str = f"  fill={s['color']}" if s["color"] else ""
        cr_str = f"  cornerRadius={s['cr']}" if s["cr"] else ""
        return f'{s["kind"]}  {bb_str}{fill_str}{cr_str}'

    def dedup_runs(shapes):
        """Collapse consecutive shapes that share (kind, w, h, color, cornerRadius
        +text+font for TEXT) into one entry with count + position range. Chart
        bars, table-cell tiles, and repeated divider rectangles compress
        heavily — Case 33's 200+-element slide drops to ~30 displayed lines
        while preserving the count and color signature the judge needs."""
        out = []
        i = 0
        while i < len(shapes):
            cur = shapes[i]
            run = [cur]
            j = i + 1
            def same(a, b):
                if a["kind"] != b["kind"]: return False
                if a["kind"] == "TEXT":
                    return (a["chars"] == b["chars"] and a["font"] == b["font"]
                            and a["align"] == b["align"] and a["color"] == b["color"]
                            and round(a["w"],1) == round(b["w"],1)
                            and round(a["h"],1) == round(b["h"],1))
                return (round(a["w"],1) == round(b["w"],1)
                        and round(a["h"],1) == round(b["h"],1)
                        and a["color_key"] == b["color_key"]
                        and a["cr"] == b["cr"])
            while j < len(shapes) and same(cur, shapes[j]):
                run.append(shapes[j]); j += 1
            if len(run) > 1:
                xs = [s["x"] for s in run]; ys = [s["y"] for s in run]
                xmin, xmax = min(xs), max(xs)
                ymin, ymax = min(ys), max(ys)
                line = fmt_shape(cur)
                # Replace single @(x,y) with @(xmin..xmax, ymin..ymax) and prefix
                # with count. Keeps fill/cornerRadius/font info verbatim.
                pos_orig = f"@({round(cur['x'],1)},{round(cur['y'],1)})"
                pos_range = (f"@(x:{round(xmin,1)}..{round(xmax,1)}, y:{round(ymin,1)}..{round(ymax,1)})"
                             if xmin != xmax or ymin != ymax
                             else pos_orig)
                line = line.replace(pos_orig, pos_range, 1)
                out.append(f"{len(run)}× {line}")
            else:
                out.append(fmt_shape(cur))
            i = j
        return out

    out_lines = ["", "INITIAL state snapshot (per slide — to verify unchanged slides; runs of identical shapes are collapsed with 'N×' prefix):",
                 "=" * 80]
    for i, slide in enumerate(slides, 1):
        bb_slide = slide.get("absoluteBoundingBox") or {}
        ox = bb_slide.get("x") or 0
        oy = bb_slide.get("y") or 0
        raw_shapes = []

        def walk(n):
            if not isinstance(n, dict): return
            if n.get("visible") is False: return
            t = n.get("type") or ""
            s = collect_text(n, ox, oy) if t == "TEXT" else collect_visual(n, ox, oy)
            if s: raw_shapes.append(s)
            if t in ("FRAME", "GROUP", "SECTION", "CANVAS", "INSTANCE"):
                for c in n.get("children") or []:
                    walk(c)

        for c in slide.get("children") or []:
            walk(c)

        deduped = dedup_runs(raw_shapes)
        total = len(raw_shapes)
        deduped_total = len(deduped)
        shown = deduped[:max_shapes_per_slide]
        out_lines.append(f"\nSlide {i}: {total} elements ({deduped_total} after dedup)")
        for ln in shown:
            out_lines.append(f"  {ln}")
        if deduped_total > len(shown):
            out_lines.append(f"  ... +{deduped_total - len(shown)} more deduped entries (truncated)")
    return "\n".join(out_lines)


def format_diff_for_judge(diff_result: dict, instruction: str) -> str:
    """Format a diff result for the LLM judge prompt.
    Diff is INITIAL vs PREDICTION (the agent's actual edits), so labels are
    framed from the agent's perspective: Added / Removed / Modified.
    Groups by slide/shape; includes similarity percentage."""
    if not diff_result.get("has_differences"):
        return "Agent made no detectable edits to the initial slide deck."

    differences = diff_result.get("differences", [])
    if not differences:
        return "No significant edits detected."

    # Property-suffix prefixes — when a path segment starts with one of these,
    # everything from that segment on is the property portion (not a node
    # name). Used by the hierarchical formatter below to separate the parent
    # node chain from the leaf property path.
    KNOWN_PROP_PREFIXES = {
        'fills', 'strokes', 'effects', 'style', 'characterStyleOverrides',
        'styleOverrideTable', 'boundingBox', 'bbox', 'cornerRadius',
        'rectangleCornerRadii', 'children', 'rotation', 'opacity', 'type',
        'visible', 'name', 'characters', 'layoutMode', 'primaryAxisAlignItems',
        'counterAxisAlignItems', 'itemSpacing', 'paddingLeft', 'paddingRight',
        'paddingTop', 'paddingBottom', '_transition', 'moved_to', 'shape',
        'text', 'count', 'slide_count', 'slide_reorder',
    }

    def _split_node_property(path: str):
        """Split a property_path into (node_chain, property_suffix).

        Node chain stops at the first segment that starts with a known property
        prefix (fills, style, boundingBox, ...). Everything from there on is
        the property the diff is reporting."""
        segments = path.split('.')
        for i, seg in enumerate(segments):
            base = seg.split('[')[0]
            if base in KNOWN_PROP_PREFIXES:
                return segments[:i], '.'.join(segments[i:])
        return segments, ''

    # Build a hierarchical tree: each node's children are sub-nodes from the
    # path; each node also carries the diffs whose target node IS this node.
    # Markdown-style indentation makes parent/child relationships visible —
    # essential for understanding that e.g. "Frame 176.fills[0].color" is
    # the CELL CONTAINER's background, not the text color of "Body 3"
    # nested inside it (Case 25: judge previously misread cell bg changes
    # as "text color edits").
    class TreeNode:
        __slots__ = ('name', 'children', 'diffs', 'order')
        def __init__(self, name, order):
            self.name = name
            self.children = {}
            self.diffs = []
            self.order = order  # insertion order for deterministic emit

    root = TreeNode('', -1)
    counter = [0]
    def get_or_create(parent: TreeNode, name: str) -> TreeNode:
        if name not in parent.children:
            counter[0] += 1
            parent.children[name] = TreeNode(name, counter[0])
        return parent.children[name]

    for diff in differences:
        path = diff.get("property_path", "")
        node_chain, prop = _split_node_property(path)
        cur = root
        for seg in node_chain:
            cur = get_or_create(cur, seg)
        cur.diffs.append((prop, diff))

    lines = [
        f"Agent Edits Summary: {diff_result['total_differences']} edits",
        f"Similarity to Initial: {diff_result['similarity_score']:.1%}",
        "",
    ]
    if instruction:
        lines.append(f"Instruction: {instruction}")
        lines.append("")
    lines.append("Detailed Edits (Initial → Prediction):")
    lines.append("=" * 80)

    def fmt_diff(prop: str, diff: dict, indent: str, node_label: str = "",
                 disambiguate: bool = False) -> list[str]:
        change_type = diff.get("change_type", "modified")
        init_val = diff.get("ground_truth_value")
        pred_val = diff.get("prediction_value")
        sibs = diff.get("applied_to_siblings", 1)
        sib_suffix = f"  [applied to {sibs} same-named siblings]" if sibs > 1 else ""
        # When the same tree node has diffs from multiple sibling instances
        # sharing the same name but different text content (Case 10 slide 12:
        # three Body nodes named "Body" carrying phone / email / website),
        # the node-level label only shows ONE annotation. Surface each diff's
        # own shape_name annotation inline so the judge can tell WHICH sibling
        # the edit is on. Otherwise email/website italic changes look like
        # noise duplicates of the phone Body's change.
        annot = ""
        if disambiguate:
            sn = diff.get("shape_name", "") or ""
            if node_label and sn.startswith(node_label) and len(sn) > len(node_label):
                annot = sn[len(node_label):]
        if change_type == "modified":
            return [
                f"{indent}• {prop}{annot}:{sib_suffix}",
                f"{indent}    Initial:    {init_val}",
                f"{indent}    Prediction: {pred_val}",
            ]
        if change_type == "added":
            return [f"{indent}+ added {prop}{annot}: {pred_val}{sib_suffix}"]
        if change_type == "removed":
            return [f"{indent}- removed {prop}{annot}: {init_val}{sib_suffix}"]
        return [f"{indent}? {prop}{annot}: {init_val} -> {pred_val}"]

    def emit(node: TreeNode, depth: int, node_label: str = ""):
        indent = "  " * depth
        sub_indent = "  " * (depth + 1)
        # Check whether this node's diffs span multiple sibling instances
        # (same node name, different text annotation). If so, disambiguate
        # each diff with its own shape_name annotation inline.
        distinct_sn = set()
        for _, d in node.diffs:
            distinct_sn.add(d.get('shape_name', '') or '')
        disambiguate = len(distinct_sn) > 1
        for _, (prop, diff) in enumerate(node.diffs):
            for ln in fmt_diff(prop, diff, sub_indent, node_label=node_label,
                               disambiguate=disambiguate):
                lines.append(ln)
        for child in sorted(node.children.values(), key=lambda n: n.order):
            if depth == 0 and child.name.startswith("slide_"):
                slide_num = child.name.split('_', 1)[1]
                lines.append(f"\nSlide {slide_num}:")
                emit(child, depth + 1, node_label="")
            else:
                # Collect distinct shape_name annotations among this child's
                # diffs. If only one, use as the node-level suffix. If many,
                # leave the node bare and let per-diff disambiguation handle it.
                child_annots = set()
                for _, d in child.diffs:
                    sn = d.get('shape_name', '') or ''
                    if sn.startswith(child.name) and len(sn) > len(child.name):
                        child_annots.add(sn[len(child.name):])
                if len(child_annots) == 1:
                    annot = next(iter(child_annots))
                    lines.append(f"{indent}- {child.name}{annot}")
                else:
                    lines.append(f"{indent}- {child.name}")
                emit(child, depth + 1, node_label=child.name)

    emit(root, 0)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM Judge (adapted from PPTArena's judge.py)
# ---------------------------------------------------------------------------

def _is_openai_model(model_id: str) -> bool:
    return any(tok in model_id.lower() for tok in ["gpt", "openai", "o1", "o3", "o4"])


def _extract_json_from_response(text: str) -> Optional[dict]:
    """Extract JSON from LLM response text."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    patterns = [
        r"```json\s*\n?(.*?)\n?```",
        r"```\s*\n?(.*?)\n?```",
        r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1) if "```" in pattern else match.group(0))
            except json.JSONDecodeError:
                continue
    return None


def judge_instruction_following(
    instruction: str,
    style_target: str,
    gt_json: dict,
    pred_json: dict,
    initial_json: Optional[dict],
    judge_model: str,
    api_key: str,
    pred_images_b64: Optional[list] = None,
) -> dict:
    """
    Judge instruction following by analyzing the agent's actual edits.

    The diff is computed INITIAL vs PREDICTION (not GT vs PRED) — both sides
    share the same id namespace via the plugin's sourceId preservation, so the
    diff faithfully represents "what the agent changed". The judge then scores
    whether those edits accomplish the Instruction. GT is judged visually by
    the separate visual-quality judge (image channel), not by JSON diff.

    Note: the `gt_json` and `style_target` args are retained for signature
    compatibility but are NOT included in the IF prompt — style_target is
    GT-derived ground-truth metadata and would leak target info into the judge.
    """
    # Compute diff between INITIAL state and PREDICTION = the agent's edits.
    # NOTE: we MUST pass initial_json=None here. diff_figma_json has an internal
    # "skip if init == gt (= schema noise)" filter (designed for GT-vs-PRED diff
    # where init is a different file from gt). When baseline IS the initial
    # state, that filter would suppress every real agent edit. Passing None
    # disables the filter.
    baseline = initial_json if initial_json is not None else gt_json
    diff_result = diff_figma_json(baseline, pred_json, initial_json=None)

    formatted_diff = format_diff_for_judge(diff_result, instruction)
    # Append per-slide INIT snapshot. The diff alone shows only deltas, so
    # a slide the agent didn't touch reads identically to a slide the agent
    # skipped — judges then misread "every slide" instructions as partially
    # applied (Case 22: slides 1/6/10/12 were already CENTER-aligned, so
    # the agent correctly left them alone). The snapshot lets the judge
    # verify whether unchanged slides were already in the requested state.
    snapshot = _format_init_snapshot(baseline)
    if snapshot:
        formatted_diff = formatted_diff + "\n" + snapshot

    rubric = """
HARSH SCORING POLICY (very strict):
- Choose the lower score when uncertain between adjacent scores.
- For translation/summarization or other text edits requiring reasoning, semantic similarity is more important than exact wording.

INSTRUCTION_FOLLOWING score (0-5):
- 5: Every requested object/change exists and is exactly correct; nothing requested is missing or misapplied; no extra edits beyond the instruction.
- 4: All requested changes exist and are mostly correct; only a tiny inaccuracy that does not affect meaning.
- 3: Most requested changes exist but at least one is incomplete, incorrect, or missing detail.
- 2: Only some requested changes exist; notable misses or incorrect applications.
- 1: Requested changes largely not performed or substantially incorrect.
- 0: Contradicts or ignores the instruction entirely.
"""

    system_prompt = f"""You are a strict judge of INSTRUCTION FOLLOWING for Figma slide editing tasks.

CRITICAL UNDERSTANDING:
- The "Instruction" is what the model/editor received (the user's request)
- You will receive a FOCUSED DIFF showing the AGENT'S ACTUAL EDITS — i.e., the
  difference between the INITIAL slide state and the PREDICTION the agent produced.
  (We do NOT include a diff against the ground truth here; GT is checked
  visually by a separate visual-quality judge.)
- Your job: Judge whether those edits accomplish the Instruction.
- "Removed" entries = elements that existed in the INITIAL state but the agent deleted.
- "Added" entries = elements the agent CREATED that did not exist in the INITIAL state.
- "Modified" entries = elements the agent kept but changed properties of.
- An EMPTY or near-empty diff almost always means the agent did NOT perform the
  instruction (low score), since the instruction would normally require concrete edits.

INITIAL STATE SNAPSHOT (per-slide content, included BELOW the diff):
- For "apply X to every slide" instructions, a slide with no diff entry can mean
  two very different things: (a) the agent skipped it, or (b) it was ALREADY in
  the requested state and needed no change. The snapshot lists each slide's
  TEXT content + alignment + font, and visual shapes — use it to distinguish.
- Example: instruction "center all titles". Slides with no diff but whose snapshot
  shows the Title already has align=CENTER are correctly left alone, NOT skipped.
  Slides with no Title element at all (cover / divider) are also not failures.
- Do NOT treat a missing diff entry as "agent failed on that slide" unless the
  snapshot confirms the slide actually needed editing.

FLEXIBILITY:
- Accept different valid approaches that fulfill the instruction
- Exact positions/sizes don't matter unless the Instruction explicitly requires them
- Very small measurement variations (±1%) are acceptable for fonts/sizes due to rounding
- Focus on semantic properties: text content, font names, colors, structural changes

STRUCTURED VISUALS (IMPORTANT):
- Figma Slides has NO native table / list / chart / SmartArt type. Such
  structures are built from FRAME containers arranged in a grid, with nested
  FRAMEs/RECTANGLEs as cells and TEXT nodes as cell content.
- When the Instruction targets a "table", "chart", "diagram", "list", etc.,
  edits to the constituent FRAMEs / RECTANGLEs / TEXTs ARE the relevant edits.
  Do NOT dismiss them as "unrelated frame/element changes" just because the
  diff doesn't say "table". A fill-color change on a FRAME nested inside the
  table's wrapper FRAME is a table cell color change.
- Layer names are arbitrary; the property path encodes the actual structure.
  Judge a node's role by its position in the path hierarchy and by whether
  the same edit is applied to its siblings — NOT by what its layer happens
  to be called.

REORDER / SORT OPERATIONS (IMPORTANT):
- A "sort table rows" or "reorder slides" instruction is implemented by
  swapping sibling indices (zOrder) and y/x positions on multiple shapes
  at once. The diff will show MANY zOrder + boundingBox.y entries on the
  same parent — this is ONE semantic operation, not many unrelated edits.
- A `children.reorder` summary entry on a parent (e.g. "5 siblings reordered:
  Row 0@1->4, Row 1@2->1, ...") IS the sort operation. Read it together
  with the per-row zOrder entries (which include each row's text content
  and a visual-nature tag like [IMAGE fill] for picture-bearing FRAMEs)
  to verify the resulting order matches the instruction (e.g. descending
  by score column, or picture on top of background rectangle).
- A FRAME tagged "[IMAGE fill]" IS a picture in Figma — moving it z-wise
  IS moving the picture, not moving an unrelated wrapper. A FRAME tagged
  "[contains N×VECTOR]" IS an icon/SVG.
- For a "bring X to front / send Y to back" stacking instruction,
  judge by the FINAL stacking relationship, not which specific shapes
  moved. Multiple z-order changes that achieve the same final stacking
  (e.g. raising X AND lowering Y) are equivalent — they are ONE
  implementation of the instructed relationship, NOT redundant edits.
  Do NOT call additional z-order changes "unnecessary" if they
  contribute to the instructed stacking.
- Do NOT score this as "only z-order changed" or "cyclic name/grade
  modification" — it is a meaningful structural edit.

PRED SLIDE IMAGES (when included):
- You will also receive RENDERED IMAGES of the prediction slides — the final
  visual result of the agent's edits.
- Use the images to judge content-relatedness the diff alone cannot show:
  whether an added IMAGE/VECTOR depicts what the instruction asked for
  (e.g. "add a baseball picture" → does the rendered image actually look like
  a baseball?), whether positioning matches the instruction's intent
  ("above the label"), and whether the visual outcome reads as the
  instruction described.
- The pred images are NOT a ground-truth target — never compare to a GT image
  or score on stylistic similarity. They exist purely to verify the SEMANTIC
  intent of the agent's edits.

{rubric}
Output a single JSON object with:
- instruction_following_score (0-5)
- instruction_following_reason (one sentence, specific evidence about whether the agent's edits accomplish the instruction)
"""

    prompt = f"""
--- USER INSTRUCTION (what the model received) ---
{instruction}

--- AGENT'S EDITS (INITIAL state → PREDICTION) ---
{formatted_diff}

CRITICAL JUDGMENT INSTRUCTIONS:
The diff above is the agent's ACTUAL edits to the slide deck (Added, Removed,
and Modified relative to the INITIAL state).
- Did the agent perform the changes the Instruction requires?
- Are the agent's edits scoped only to what the instruction asks (no unrelated
  edits beyond the instruction)?
- If the diff is empty or trivial while the instruction clearly requires changes
  → Low score (1 or 0).
- If the agent's edits implement the requested changes precisely → High score (4-5).
- If the instruction targets a structured visual (table, chart, list, diagram),
  remember that those are built from nested FRAMEs/RECTANGLEs/TEXTs — edits to
  those constituents ARE table/chart/list edits, not unrelated edits.

REMINDER: Judge if the agent's edits ACHIEVED THE SEMANTIC INTENT of the Instruction.
"""

    # Hybrid gating: only attach pred images when the diff touches visual
    # content (IMAGE/VECTOR/SVG/picture-fill additions or modifications).
    # Text-only edits don't need rendered pixels — judge can score them from
    # the diff. Saves tokens on every text edit, keeps verification power
    # for picture-content instructions (e.g. "add a baseball picture").
    if pred_images_b64 and _diff_has_visual_content_changes(diff_result.get("differences", [])):
        touched = sorted({d.get("slide_number") for d in diff_result.get("differences", [])
                          if isinstance(d.get("slide_number"), int) and d.get("slide_number") > 0})
        if touched:
            pred_images_b64 = [(i, pred_images_b64[i - 1])
                               for i in touched
                               if 0 < i <= len(pred_images_b64) and pred_images_b64[i - 1]]
        else:
            pred_images_b64 = [(1, pred_images_b64[0])] if pred_images_b64 else []
    else:
        pred_images_b64 = None

    return _call_llm_judge(
        system_prompt, prompt, judge_model, api_key, "instruction",
        pred_images_b64=pred_images_b64,
    )


def judge_visual_quality(
    instruction: str,
    style_target: str,
    gt_images_b64: list[str],
    pred_images_b64: list[str],
    judge_model: str,
    api_key: str,
) -> dict:
    """
    Judge visual quality by comparing slide images.
    Uses SSIM + pHash pre-filtering to flag differing slides (adapted from PPTArena),
    then sends only flagged slides to VLM in batches.
    Returns dict with visual_quality_score and visual_quality_reason.
    """
    if not gt_images_b64 or not pred_images_b64:
        return {
            "visual_quality_score": 0,
            "visual_quality_reason": "No slide images available for comparison.",
        }

    rubric = """
SCORING POLICY:
- Judge whether the agent ACCOMPLISHED the Instruction's visual goals. GT is
  ONE valid reference, not a pixel target — equivalent layouts achieving the
  same intent are acceptable.
- For NON-requested content, only penalize changes that break readability,
  visual coherence, or alter the slide's semantic meaning. Minor positional
  drift, padding tweaks, or sub-pixel alignment differences from GT are NOT
  failures and should NOT drop the score.

VISUAL_Quality score (0-5):
- 5: Instruction goals achieved; deck is coherent and readable; any
  non-requested visual differences (small position shifts, slight padding)
  do not affect interpretation or meaning.
- 4: Goals achieved; minor secondary visual differences from GT that a
  viewer would not flag as wrong (slight font size, sub-pixel layout drift).
- 3: Goals partially achieved OR one element on non-requested content is
  clearly misaligned/restyled but does not break the slide's purpose.
- 2: Goals visibly missed in places OR multiple non-requested visual
  problems that distract from the content.
- 1: Major layout breakage (overlap, off-canvas, broken structure) while
  still legible.
- 0: Severely broken, unreadable, OR the instruction is visibly contradicted.
"""

    system_prompt = f"""You are a judge of VISUAL/CONTENT QUALITY and PRESERVATION for Figma slide editing tasks.

CRITICAL UNDERSTANDING:
- The "Instruction" is what the model/editor received
- The "Style Target" is YOUR evaluation rubric - the model DID NOT see this
- Ground Truth is ONE valid example - accept other valid visual approaches
- Focus on SEMANTIC correctness: Are the visual elements correct? No overlap? Readable?
- Exact positions/sizes don't matter unless the Instruction explicitly requires them
- Compare Ground Truth and Prediction slide images directly slide-by-slide.

RENDERING-ENGINE ARTIFACTS — DO NOT PENALIZE (CRITICAL):
- The original slide source is Figma. Each pipeline renders through a different
  engine (figma plugin / Chromium HTML / LibreOffice PPTX). Cross-engine
  conversion can break text rendering (unsupported font fallback, different
  line-wrap algorithm, slight measurement differences) and these issues often
  appear in BOTH the Ground Truth render AND the Prediction render of the same
  pipeline — they are NOT the agent's fault.
- The rule: any layout breakage (line wrap, text overflow, label truncation,
  overlap, garbled glyphs) that is ALREADY VISIBLE in the GROUND TRUTH image
  must NOT count against the Prediction. Penalize only when the Prediction
  exhibits an issue that the Ground Truth does NOT exhibit.
- Concrete examples that should NOT lower the score:
    * Footnote line overlaps a bullet on slide N, but the GT also shows that
      overlap on slide N → ignore (rendering engine artifact, present in GT).
    * Bar labels are truncated on slides 8–9 in BOTH GT and Prediction → ignore.
    * A non-English character renders as a fallback font in both GT and
      Prediction → ignore (font availability, not an agent edit).
- If you cannot tell whether GT also has the issue, look closely at the same
  region in the GT image before scoring it down.

FLEXIBILITY:
- Different layouts achieving the same goal are acceptable
- Small position variations are fine if elements are clear and non-overlapping
- Theme colors may vary slightly as long as they're harmonious

{rubric}
Output a single JSON object with:
- visual_quality_score (0-5)
- visual_quality_reason (one sentence, specific evidence about visual differences)
"""

    olen = len(gt_images_b64)
    mlen = len(pred_images_b64)
    total_slides = min(olen, mlen) if min(olen, mlen) > 0 else max(olen, mlen)
    use_openai = _is_openai_model(judge_model)

    # --- SSIM/pHash pre-filtering (adapted from PPTArena) ---
    SSIM_THRESHOLD = float(os.environ.get("VISUAL_SSIM_THRESH", "0.9995" if use_openai else "0.995"))
    PHASH_DIST_THRESHOLD = int(os.environ.get("VISUAL_PHASH_THRESH", "2"))

    differing_indices: List[int] = []
    if _HAS_IMAGE_METRICS and total_slides > 0:
        max_index = min(olen, mlen)
        for idx in range(max_index):
            gt_img = _pil_from_b64(gt_images_b64[idx]) if idx < olen else None
            pred_img = _pil_from_b64(pred_images_b64[idx]) if idx < mlen else None
            if gt_img is None or pred_img is None:
                differing_indices.append(idx)
                print(f"  [VisualJudge] Slide {idx+1}: missing image -> flagged for VLM")
                continue
            a = _resize_for_metric(gt_img)
            b = _resize_for_metric(pred_img)
            if a.size != b.size:
                b = b.resize(a.size, PILImage.BILINEAR)
            ssim = _compute_ssim(_to_gray_np(a), _to_gray_np(b))
            ph_a = _dct_8x8_hash(a)
            ph_b = _dct_8x8_hash(b)
            hdist = _hamming_distance64(ph_a, ph_b)
            if ssim < SSIM_THRESHOLD or hdist > PHASH_DIST_THRESHOLD:
                differing_indices.append(idx)
                print(f"  [VisualJudge] Slide {idx+1}: SSIM={ssim:.4f}, pHashDist={hdist} -> flagged")
            else:
                print(f"  [VisualJudge] Slide {idx+1}: SSIM={ssim:.4f}, pHashDist={hdist} -> likely identical")

        if not differing_indices:
            # Inspired by PPTArena (judge.py:479-481), but WITHOUT its 5-slide
            # sampling cap: our benchmark decks can have 15+ slides, and a cap
            # would let a localized regression on a later slide go unverified.
            # Send every slide through the VLM when the pre-filter flags none.
            differing_indices = list(range(max_index))
            print(f"  [VisualJudge] No slides flagged (SSIM≥{SSIM_THRESHOLD}, pHash≤{PHASH_DIST_THRESHOLD}); sending all {max_index} slide(s) to VLM for verification")
        else:
            print(f"  [VisualJudge] Flagged slides for VLM: {[i+1 for i in differing_indices]}")
    else:
        # No image metrics available — send all slides (capped)
        differing_indices = list(range(min(10, total_slides)))

    # --- Batch processing (max 5 slides per batch, adapted from PPTArena) ---
    chunk_size = 5
    batches = [differing_indices[i:i + chunk_size] for i in range(0, len(differing_indices), chunk_size)]
    # Merge small trailing batch
    if len(batches) >= 2 and len(batches[-1]) < 3:
        batches[-2].extend(batches[-1])
        batches = batches[:-1]
    print(f"  [VisualJudge] Created {len(batches)} batch(es): {[[j+1 for j in b] for b in batches]}")

    batch_scores: List[float] = []
    batch_reasons: List[str] = []

    for batch in batches:
        batch_slide_str = ', '.join(str(i + 1) for i in batch)
        prompt_text = f"""
--- User Instruction ---
{instruction}

--- Style Target (judge rubric, unseen by the model under evaluation) ---
{style_target if style_target else "Not provided."}

You are given two labeled image sequences for slides: {batch_slide_str}
- Ground Truth: the correct target deck to match (slides available: {min(len(batch), olen)})
- Prediction: the candidate deck produced by the system (slides available: {min(len(batch), mlen)})

CRITICAL: Ground Truth is ONE valid example, not the only correct answer.
Judge if Prediction achieves the SEMANTIC INTENT shown by Ground Truth.
Focus on: correctness, no overlap, readability, theme consistency.
Small position/size variations are acceptable if elements are clear.

DO NOT penalize layout breakage (line wrap, text overflow, label truncation,
overlap, font fallback) that is ALSO visible in the GROUND TRUTH image — those
are rendering-engine artifacts shared by both sides, not agent errors. Only
penalize when the Prediction exhibits an issue that the Ground Truth does not.

Judge visual quality by comparing PREDICTION to GROUND TRUTH.

Return only:
- visual_quality_score (0-5)
- visual_quality_reason (one sentence, specific evidence about visual differences)
"""
        result = _call_vlm_judge_batch(
            system_prompt, prompt_text,
            gt_images_b64, pred_images_b64,
            batch, judge_model, api_key,
        )
        vscore = result.get("visual_quality_score", 0)
        vreason = result.get("visual_quality_reason", "")
        batch_scores.append(vscore)
        batch_reasons.append(vreason)
        print(f"  [VisualJudge] Batch slides {[i+1 for i in batch]} -> score={vscore}")

    # Final score = min across batches (strictest evaluation, same as PPTArena)
    if batch_scores:
        min_score = round(min(batch_scores), 2)
        reason_text = " | ".join([r for r in batch_reasons if r][:3])
        print(f"  [VisualJudge] Final visual score (min of batches) = {min_score}")
        return {"visual_quality_score": min_score, "visual_quality_reason": reason_text}

    return {"visual_quality_score": 0, "visual_quality_reason": "No batches evaluated"}


# ---- gpt-5 judge usage / cost tracking ----
# gpt-5 Responses API pricing (USD per 1M tokens). Reasoning tokens are billed
# as output. Adjust if pricing changes.
_USD_PER_1M_INPUT = 1.25
_USD_PER_1M_OUTPUT = 10.0
_USAGE_TOTALS = {"calls": 0, "input": 0, "output": 0, "reasoning": 0, "cost": 0.0}


def _track_usage(response, mode: str) -> None:
    """Accumulate + print token usage/cost for one OpenAI Responses API call."""
    try:
        u = getattr(response, "usage", None)
        if u is None:
            return
        inp = getattr(u, "input_tokens", 0) or 0
        out = getattr(u, "output_tokens", 0) or 0
        det = getattr(u, "output_tokens_details", None)
        reasoning = (getattr(det, "reasoning_tokens", 0) or 0) if det else 0
        cost = inp / 1e6 * _USD_PER_1M_INPUT + out / 1e6 * _USD_PER_1M_OUTPUT
        _USAGE_TOTALS["calls"] += 1
        _USAGE_TOTALS["input"] += inp
        _USAGE_TOTALS["output"] += out
        _USAGE_TOTALS["reasoning"] += reasoning
        _USAGE_TOTALS["cost"] += cost
        print(f"  [usage:{mode}] in={inp} out={out} (reasoning={reasoning}) "
              f"call=${cost:.4f} running=${_USAGE_TOTALS['cost']:.3f}")
    except Exception as e:
        print(f"  [usage] tracking failed: {e}")


def print_usage_summary() -> None:
    t = _USAGE_TOTALS
    print(f"\n{'='*60}")
    print(f"[USAGE SUMMARY] gpt-5 judge: calls={t['calls']} "
          f"input={t['input']:,} output={t['output']:,} (reasoning={t['reasoning']:,})")
    print(f"[USAGE SUMMARY] EST COST = ${t['cost']:.2f} "
          f"(in @${_USD_PER_1M_INPUT}/1M, out @${_USD_PER_1M_OUTPUT}/1M)")
    print(f"{'='*60}")


def _call_llm_judge(
    system_prompt: str,
    user_prompt: str,
    model: str,
    api_key: str,
    mode: str,
    pred_images_b64: Optional[list] = None,
) -> dict:
    """Call LLM for instruction-following judging. When pred_images_b64 is
    provided, attach them as a visual channel so the judge can verify added
    images/SVGs depict the instructed content (e.g. "added picture looks like
    a baseball")."""
    use_openai = _is_openai_model(model)
    # Normalize pred_images_b64 into a list of (slide_num, b64). Callers may
    # pass either the raw image list (auto-numbered) or pre-filtered
    # (slide_num, img) tuples (e.g. only slides referenced in the diff).
    raw = pred_images_b64 or []
    imgs: list = []
    for i, item in enumerate(raw):
        if isinstance(item, tuple) and len(item) == 2:
            num, b = item
            if b:
                imgs.append((num, b))
        elif item:
            imgs.append((i + 1, item))

    # When multiple edited slides need attaching, compose them into a single
    # labeled grid PNG. One image slot vs N, easier for the judge to compare,
    # and labels (Slide N) preserve the per-slide mapping.
    grid_b64 = ""
    nums_str = ""
    if len(imgs) >= 2:
        grid_b64 = _compose_slides_grid(imgs)
        nums_str = ", ".join(f"Slide {n}" for n, _ in imgs)

    try:
        if use_openai:
            import openai
            client = openai.OpenAI(api_key=api_key)
            content = [{"type": "input_text", "text": user_prompt.strip()}]
            if grid_b64:
                content.append({"type": "input_text",
                                "text": f"--- RENDERED PRED SLIDES (single grid image; {len(imgs)} edited slides: {nums_str}; each tile is labeled with its slide number) ---"})
                content.append({"type": "input_image",
                                "image_url": f"data:image/png;base64,{grid_b64}"})
            elif imgs:
                num, img = imgs[0]
                content.append({"type": "input_text",
                                "text": f"--- RENDERED PRED SLIDE_{num} (the only slide edited by the agent) ---"})
                content.append({"type": "input_image",
                                "image_url": f"data:image/png;base64,{img}"})
            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": [{"type": "input_text", "text": system_prompt.strip()}]},
                    {"role": "user", "content": content},
                ],
            )
            response_text = response.output_text.strip()
            _track_usage(response, mode)
        else:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            gen_config = {"response_mime_type": "application/json", "top_p": 0, "top_k": 1, "candidate_count": 1}
            model_obj = genai.GenerativeModel(model_name=model, generation_config=gen_config)
            parts = [system_prompt, user_prompt]
            if grid_b64:
                parts.append(f"--- RENDERED PRED SLIDES (single grid image; {len(imgs)} edited slides: {nums_str}; each tile is labeled with its slide number) ---")
                parts.append({"inline_data": {"mime_type": "image/png", "data": grid_b64}})
            elif imgs:
                num, img = imgs[0]
                parts.append(f"--- RENDERED PRED SLIDE_{num} (the only slide edited by the agent) ---")
                parts.append({"inline_data": {"mime_type": "image/png", "data": img}})
            response = model_obj.generate_content(parts)
            response_text = response.text.strip()

        parsed = _extract_json_from_response(response_text)
        if not parsed:
            print(f"  [ERROR] Failed to parse JSON from {mode} judge response: {response_text[:300]}")
            return {"instruction_following_score": 0,
                    "instruction_following_reason": "JSON parse failed"}

        # Normalize keys — use 'is not None' to preserve score of 0
        score = parsed.get("instruction_following_score")
        if score is None:
            score = parsed.get("instruction_score")
        if score is None:
            score = parsed.get("score")

        reason = (parsed.get("instruction_following_reason")
                  or parsed.get("instruction_reason")
                  or parsed.get("reason")
                  or "")

        try:
            score = float(score) if score is not None else 0
        except (ValueError, TypeError):
            score = 0

        return {
            "instruction_following_score": score,
            "instruction_following_reason": reason,
        }
    except Exception as e:
        print(f"  [ERROR] LLM judge call failed ({mode}): {e}")
        return {
            "instruction_following_score": 0,
            "instruction_following_reason": f"Error: {e}",
        }


def _extract_visual_fields(parsed: dict) -> tuple:
    """Extract visual score and reason from parsed judge response, handling key variants."""
    vscore = parsed.get("visual_quality_score")
    if vscore is None:
        vscore = parsed.get("visual_preservation_score")
    if vscore is None:
        vscore = parsed.get("visual_score")
    if vscore is None:
        vscore = parsed.get("score")

    vreason = (parsed.get("visual_quality_reason")
               or parsed.get("visual_preservation_reason")
               or parsed.get("visual_reason")
               or parsed.get("reason")
               or "")

    try:
        vscore = float(vscore) if vscore is not None else 0.0
    except (ValueError, TypeError):
        vscore = 0.0

    return vscore, vreason


def _call_vlm_judge_batch(
    system_prompt: str,
    user_prompt: str,
    gt_images: list[str],
    pred_images: list[str],
    slide_indices: List[int],
    model: str,
    api_key: str,
) -> dict:
    """Call VLM for image-based judging on a batch of slide indices.
    Adapted from PPTArena's batch visual judging."""
    use_openai = _is_openai_model(model)

    try:
        if use_openai:
            import openai
            client = openai.OpenAI(api_key=api_key)

            content = [{"type": "input_text", "text": user_prompt.strip()}]
            for idx in slide_indices:
                if idx < len(gt_images) and gt_images[idx]:
                    content.append({"type": "input_text", "text": f"GROUND_TRUTH_SLIDE_{idx+1}"})
                    content.append({"type": "input_image", "image_url": f"data:image/png;base64,{gt_images[idx]}"})
            for idx in slide_indices:
                if idx < len(pred_images) and pred_images[idx]:
                    content.append({"type": "input_text", "text": f"PREDICTION_SLIDE_{idx+1}"})
                    content.append({"type": "input_image", "image_url": f"data:image/png;base64,{pred_images[idx]}"})

            response = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": [{"type": "input_text", "text": system_prompt.strip()}]},
                    {"role": "user", "content": content},
                ],
            )
            response_text = response.output_text.strip()
            _track_usage(response, "VQ")
        else:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            gen_config = {
                "response_mime_type": "application/json",
                "temperature": 0.1,
                "top_p": 0,
                "top_k": 1,
                "candidate_count": 1,
            }
            model_obj = genai.GenerativeModel(model_name=model, generation_config=gen_config)

            parts = [system_prompt, user_prompt]
            parts.append("--- GROUND TRUTH (Correct target deck) ---")
            for idx in slide_indices:
                if idx < len(gt_images) and gt_images[idx]:
                    parts.append(f"GROUND_TRUTH_SLIDE_{idx+1}")
                    parts.append({"inline_data": {"mime_type": "image/png", "data": gt_images[idx]}})
            parts.append("--- PREDICTION (Candidate deck to evaluate) ---")
            for idx in slide_indices:
                if idx < len(pred_images) and pred_images[idx]:
                    parts.append(f"PREDICTION_SLIDE_{idx+1}")
                    parts.append({"inline_data": {"mime_type": "image/png", "data": pred_images[idx]}})

            response = model_obj.generate_content(parts)
            response_text = response.text.strip()

        parsed = _extract_json_from_response(response_text)
        if not parsed:
            print(f"  [ERROR] Failed to parse JSON from visual judge response: {response_text[:300]}")
            return {"visual_quality_score": 0, "visual_quality_reason": "JSON parse failed"}

        vscore, vreason = _extract_visual_fields(parsed)
        return {"visual_quality_score": vscore, "visual_quality_reason": vreason}

    except Exception as e:
        print(f"  [ERROR] VLM judge call failed: {e}")
        return {"visual_quality_score": 0, "visual_quality_reason": f"Error: {e}"}


# ---------------------------------------------------------------------------
# Main evaluation pipeline
# ---------------------------------------------------------------------------

def evaluate_case(
    case_name: str,
    case_data: dict,
    result_dir: Path,
    judge_model: str,
    api_key: str,
    skip_visual: bool = False,
    pred_snapshot_turn: Optional[int] = None,
) -> dict:
    """Evaluate a single case by comparing ground truth with prediction result."""
    # Honour explicit relative paths from the bench JSON (e.g. data_total/Foo)
    # by resolving against the project root, not the hard-coded DATA_DIR.
    original_path_str = case_data.get("original") or ""
    gt_path_str = case_data.get("ground_truth") or ""
    original_name = original_path_str.split("/")[-1] if original_path_str else ""
    gt_name = gt_path_str.split("/")[-1]

    def _resolve(rel: str) -> Path | None:
        if not rel:
            return None
        return (PROJECT_ROOT / rel) if "/" in rel else (DATA_DIR / rel)

    original_dir = _resolve(original_path_str)
    gt_dir = _resolve(gt_path_str)
    result_prefix = result_dir.name

    print(f"\n{'='*60}")
    print(f"Evaluating: {case_name}")
    print(f"  Result dir: {result_dir.name}")
    print(f"  Original: {original_name}, Ground Truth: {gt_name}")

    # ---- Load JSON structures ----
    # Prefer Plugin-based initial JSON (turn 0 snapshot) for same-schema comparison
    # with prediction. Fall back to REST API full_document.json if unavailable.
    initial_json = load_snapshot_structure_json(
        result_dir / "snapshots", result_prefix, turn=0
    )
    if initial_json is not None:
        print(f"  Using Plugin initial JSON (turn 0 snapshot) for baseline")
    elif original_dir is not None:
        initial_json = load_json_file(original_dir / "full_document.json")
        if initial_json is not None:
            print(f"  Using REST API initial JSON (full_document.json) for baseline")

    # Prefer the baseline-imported JSON (same schema as Pred's snapshot JSON,
    # both produced by our import_json → plugin export pipeline). Fall back to
    # full_document.json (REST API export) only if the baseline isn't available.
    gt_json = None
    if gt_dir:
        baseline_gt = gt_dir / "full_document_baseline.json"
        if baseline_gt.exists():
            gt_json = load_json_file(baseline_gt)
            if gt_json is not None:
                print(f"  Using GT baseline JSON (full_document_baseline.json)")
        if gt_json is None:
            gt_json = load_json_file(gt_dir / "full_document.json")

    # Prediction JSON: first try the top-level json-structure file, then snapshot structure
    if pred_snapshot_turn is not None:
        # Force pred to use a specific snapshot turn (e.g., 0 = initial, agent did nothing)
        pred_json = load_snapshot_structure_json(result_dir / "snapshots", result_prefix, turn=pred_snapshot_turn)
        if pred_json is not None:
            print(f"  Using snapshot-{pred_snapshot_turn} as PRED JSON (forced via --pred-snapshot)")
    else:
        pred_json = load_json_file(result_dir / f"{result_prefix}-json-structure.json")
        if pred_json is None:
            pred_json = load_snapshot_structure_json(result_dir / "snapshots", result_prefix)

    # ---- Inject transitions stripped by the plugin's slim structure export ----
    # Slim "-structure.json" files do NOT include slide transitions, but the full
    # "-snapshot-N.json" files embed them inside toolResults. Re-attach as
    # `_transition` field on each slide node so diff_figma_json can see them.
    snaps_dir = result_dir / "snapshots"
    init_full = sorted(snaps_dir.glob(f"{result_prefix}-snapshot-0.json"))
    pred_full = sorted(snaps_dir.glob(f"{result_prefix}-snapshot-1.json"))
    if init_full and initial_json is not None:
        _inject_transitions_into_doc(initial_json, _extract_transitions_from_snap_full(init_full[0]))
    if pred_full and pred_json is not None:
        _inject_transitions_into_doc(pred_json, _extract_transitions_from_snap_full(pred_full[0]))

    if gt_json is None:
        print(f"  [SKIP] Ground truth JSON not found for {gt_name}")
        return {"error": "Ground truth JSON not found"}

    if pred_json is None:
        # No pred output (e.g. token-limit failure on a huge deck, or runtime
        # kill). Fall back to using INITIAL as PRED so the judge can score
        # "agent made no edits" honestly via the empty-diff rubric path. This
        # mirrors PPTArena run_evaluation's no-op fallback. Only zero out if
        # we also lack an initial baseline (truly nothing to judge).
        if initial_json is None:
            reason = "Both initial and prediction JSON missing — nothing to judge."
            print(f"  [ZERO] {reason}")
            return {
                "case_name": case_name,
                "result_dir": result_dir.name,
                "instruction_following_score": 0,
                "instruction_following_reason": reason,
                "visual_quality_score": 0,
                "visual_quality_reason": reason,
                "instruction_judge_time_s": 0,
                "visual_judge_time_s": 0,
            }
        marker_present = (result_dir / "_failed_generation").exists()
        print(f"  [NO-OP FALLBACK] pred JSON missing — using initial as pred (marker_present={marker_present})")
        pred_json = initial_json

    # ---- Instruction Following (JSON-based, with pred images for context) ----
    instruction = case_data["prompt"]
    style_target = case_data.get("style_target", "")

    # Load pred slide images up-front so the IF judge can see the agent's actual
    # rendered output. Critical for cases like "Add Pictures" where the diff
    # alone can't reveal whether added IMAGE/VECTOR nodes depict the
    # instructed content (e.g. baseball, airplane, basketball).
    pred_images_for_if = load_snapshot_images_b64(
        result_dir / "snapshots", result_prefix, turn=pred_snapshot_turn
    )
    # No-op fallback for images: if pred snapshots are missing (e.g. iter-1
    # failed before saving snapshots due to a token limit or runtime error),
    # use the ORIGINAL deck's frames as the visual representation of "agent
    # did nothing". Mirrors the pred_json → initial_json fallback above so
    # both IF (visual context) and VQ judges see a coherent no-edit baseline.
    if not pred_images_for_if and original_dir is not None:
        for sub in ("frames_baseline", "frames_html_baseline", "frames"):
            cand = original_dir / sub
            if cand.is_dir() and any(cand.glob("slide_*.png")):
                pred_images_for_if = load_slide_images_b64(cand)
                print(f"  [NO-OP FALLBACK] no pred snapshots — using origin {sub}/ as pred images ({len(pred_images_for_if)} slides)")
                break

    print(f"  Judging instruction following...")
    start = time.time()
    instr_result = judge_instruction_following(
        instruction=instruction,
        style_target=style_target,
        gt_json=gt_json,
        pred_json=pred_json,
        initial_json=initial_json,
        judge_model=judge_model,
        api_key=api_key,
        pred_images_b64=pred_images_for_if,
    )
    instr_time = round(time.time() - start, 2)
    print(f"  Instruction Following Score: {instr_result.get('instruction_following_score', 'N/A')} ({instr_time}s)")

    # ---- Visual Quality (Image-based) ----
    vis_result = {"visual_quality_score": "N/A", "visual_quality_reason": "Skipped"}
    vis_time = 0

    if not skip_visual:
        # Prefer frames_baseline/ (GT rendered through our Slides import +
        # export pipeline, scale=1, 1920×1080) over frames/ (original 2x
        # Design export). The baseline matches Pred's render path, so SSIM
        # only reflects agent-induced changes (not DPI/engine drift).
        if gt_dir:
            gt_baseline_dir = gt_dir / "frames_baseline"
            gt_orig_dir = gt_dir / "frames"
            if gt_baseline_dir.is_dir() and any(gt_baseline_dir.glob("slide_*.png")):
                print(f"  Using GT baseline (frames_baseline/) for visual comparison")
                gt_images = load_slide_images_b64(gt_baseline_dir)
            else:
                gt_images = load_slide_images_b64(gt_orig_dir)
        else:
            gt_images = []
        pred_images = pred_images_for_if

        if gt_images and pred_images:
            print(f"  Judging visual quality ({len(gt_images)} GT slides, {len(pred_images)} pred slides)...")
            start = time.time()
            vis_result = judge_visual_quality(
                instruction=instruction,
                style_target="",  # VQ runs without style_target to avoid penalizing
                                   # valid design alternatives (Case 24/25) where GT
                                   # is one of many acceptable layouts.
                gt_images_b64=gt_images,
                pred_images_b64=pred_images,
                judge_model=judge_model,
                api_key=api_key,
            )
            vis_time = round(time.time() - start, 2)
            print(f"  Visual Quality Score: {vis_result.get('visual_quality_score', 'N/A')} ({vis_time}s)")
        else:
            print(f"  [SKIP] Missing images: GT={len(gt_images)}, Pred={len(pred_images)}")
            vis_result = {"visual_quality_score": "N/A", "visual_quality_reason": "Missing images"}

    return {
        "case_name": case_name,
        "result_dir": result_dir.name,
        "instruction_following_score": instr_result.get("instruction_following_score", 0),
        "instruction_following_reason": instr_result.get("instruction_following_reason", ""),
        "visual_quality_score": vis_result.get("visual_quality_score", 0),
        "visual_quality_reason": vis_result.get("visual_quality_reason", ""),
        "instruction_judge_time_s": instr_time,
        "visual_judge_time_s": vis_time,
    }


def run_evaluation(
    judge_model: str = "gpt-5",
    api_key: Optional[str] = None,
    filter_cases: Optional[list[str]] = None,
    filter_suffix: Optional[str] = None,
    filter_exact_model: Optional[str] = None,
    skip_visual: bool = False,
    output_csv: Optional[str] = None,
    output_json: Optional[str] = None,
    resume_from: Optional[str] = None,
    pred_snapshot_turn: Optional[int] = None,
    parallel: int = 1,
):
    """Run full evaluation across all matched cases."""
    # Resolve API key
    if not api_key:
        api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: No API key provided. Set OPENAI_API_KEY or GEMINI_API_KEY environment variable, or use --api-key.")
        sys.exit(1)

    pairs = load_evaluation_pairs()
    print(f"Loaded {len(pairs)} evaluation pairs from {EVAL_PAIRS_PATH.name}")
    print(f"Judge model: {judge_model}")

    # ---- Resume support: pre-load already-scored (case_name, result_dir) pairs ----
    cached_results: dict[tuple[str, str], dict] = {}
    if resume_from:
        try:
            with open(resume_from, "r", encoding="utf-8") as f:
                prior = json.load(f)
            for r in prior:
                if r.get("judge_model") != judge_model:
                    continue  # only reuse rows judged by the same model
                if "instruction_following_score" not in r:
                    continue
                key = (r.get("case_name", ""), r.get("result_dir", ""))
                cached_results[key] = r
            print(f"[RESUME] Loaded {len(cached_results)} prior scores from {resume_from}")
        except FileNotFoundError:
            print(f"[RESUME] No prior file at {resume_from}; starting fresh")
        except Exception as e:
            print(f"[RESUME] Failed to load {resume_from}: {e}; starting fresh")

    results = []
    skipped = 0
    total_matched = 0
    reused = 0

    # Incremental save: write current results after each case so a mid-run
    # crash does not lose progress. The user can pass the same path as
    # --resume-from to continue.
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    incremental_path = output_json or str(
        OUTPUT_DIR / f"evaluation_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )

    import threading
    _write_lock = threading.Lock()

    def _flush_incremental():
        with _write_lock:
            try:
                with open(incremental_path, "w", encoding="utf-8") as f:
                    json.dump(results, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"  [WARN] Incremental save failed: {e}")

    # Phase 1: collect all (case_data, result_dir) tasks and reuse cached
    # rows immediately. This decouples case filtering from execution so we
    # can dispatch the remaining work to a thread pool when parallel > 1.
    tasks: list = []
    for case_key, case_data in pairs.items():
        original_path = case_data.get("original") or ""
        if original_path:
            original_name = original_path.split("/")[-1]
            result_dirs = find_result_dirs(original_name)
        else:
            safe = re.sub(r"[^A-Za-z0-9]+", "_", case_data.get("name", "")).strip("_")
            original_name = safe
            result_dirs = find_result_dirs(safe)

        if filter_exact_model:
            target_norm = _normalize_name(f"{original_name}-{filter_exact_model}")
            result_dirs = [d for d in result_dirs if _normalize_name(d.name) == target_norm]
        elif filter_suffix:
            result_dirs = [d for d in result_dirs if filter_suffix in d.name]

        if not result_dirs:
            skipped += 1
            continue

        if filter_cases and case_key not in filter_cases and case_data["name"] not in filter_cases:
            skipped += 1
            continue

        for result_dir in result_dirs:
            total_matched += 1
            cache_key = (case_data["name"], result_dir.name)
            cached = cached_results.get(cache_key)
            if cached is not None:
                reused += 1
                print(f"[REUSE] {case_data['name']} ({result_dir.name}) — IF={cached.get('instruction_following_score')} VQ={cached.get('visual_quality_score')}")
                results.append(cached)
                _flush_incremental()
                continue
            tasks.append((case_data, result_dir))

    def _run_one(case_data, result_dir) -> dict:
        try:
            result = evaluate_case(
                case_name=case_data["name"],
                case_data=case_data,
                result_dir=result_dir,
                judge_model=judge_model,
                api_key=api_key,
                skip_visual=skip_visual,
                pred_snapshot_turn=pred_snapshot_turn,
            )
            result["timestamp"] = datetime.now().isoformat()
            result["judge_model"] = judge_model
            result["category"] = case_data.get("category", [])
            result["edit_type"] = case_data.get("edit_type", "")
            return result
        except Exception as e:
            print(f"  [ERROR] Failed to evaluate {case_data['name']} ({result_dir.name}): {e}")
            return {
                "case_name": case_data["name"],
                "result_dir": result_dir.name,
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
                "judge_model": judge_model,
            }

    if parallel > 1 and tasks:
        # Parallel path: LLM-bound work fans out across `parallel` threads.
        # GIL-safe because the heavy lifting is in HTTP I/O; results.append
        # is atomic in CPython, _flush_incremental serializes via lock.
        # Each case still makes 2-3 sequential API calls inside (IF + VQ
        # batches), so effective speedup ≈ min(parallel, slowest_case_count).
        from concurrent.futures import ThreadPoolExecutor, as_completed
        print(f"[PARALLEL] Running {len(tasks)} cases with {parallel} workers")
        with ThreadPoolExecutor(max_workers=parallel) as ex:
            futures = {ex.submit(_run_one, cd, rd): (cd, rd) for cd, rd in tasks}
            for fut in as_completed(futures):
                r = fut.result()
                results.append(r)
                _flush_incremental()
    else:
        for case_data, result_dir in tasks:
            results.append(_run_one(case_data, result_dir))
            _flush_incremental()

    # ---- Summary ----
    print(f"\n{'='*60}")
    print(f"EVALUATION SUMMARY")
    print(f"{'='*60}")
    print(f"Total pairs: {len(pairs)}")
    print(f"Matched & evaluated: {total_matched}")
    print(f"  - reused from cache: {reused}")
    print(f"  - newly judged: {total_matched - reused}")
    print(f"Skipped (no results): {skipped}")

    scored_results = [r for r in results if "error" not in r and isinstance(r.get("instruction_following_score"), (int, float))]
    if scored_results:
        avg_instr = sum(r["instruction_following_score"] for r in scored_results) / len(scored_results)
        vis_scored = [r for r in scored_results if isinstance(r.get("visual_quality_score"), (int, float))]
        avg_vis = sum(r["visual_quality_score"] for r in vis_scored) / len(vis_scored) if vis_scored else 0

        print(f"\nInstruction Following: avg={avg_instr:.2f}/5 (n={len(scored_results)})")
        print(f"Visual Quality: avg={avg_vis:.2f}/5 (n={len(vis_scored)})")

        # Per-case breakdown
        print(f"\n{'Case':<55} {'IF':>5} {'VQ':>5} {'Result Dir'}")
        print("-" * 100)
        for r in sorted(scored_results, key=lambda x: x.get("case_name", "")):
            if_score = r.get("instruction_following_score", "N/A")
            vq_score = r.get("visual_quality_score", "N/A")
            if isinstance(if_score, float):
                if_score = f"{if_score:.1f}"
            if isinstance(vq_score, float):
                vq_score = f"{vq_score:.1f}"
            print(f"{r['case_name']:<55} {if_score:>5} {vq_score:>5} {r.get('result_dir', '')}")

    # ---- Save outputs ----
    # Final-flush JSON (overwrites the incremental file at the same path).
    output_json = incremental_path
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nResults saved to: {output_json}")

    if output_csv is None:
        output_csv = str(OUTPUT_DIR / f"evaluation_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")
    fieldnames = [
        "timestamp", "case_name", "result_dir", "judge_model", "category", "edit_type",
        "instruction_following_score", "visual_quality_score",
        "instruction_following_reason", "visual_quality_reason",
        "instruction_judge_time_s", "visual_judge_time_s", "error",
    ]
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in results:
            row = dict(r)
            if isinstance(row.get("category"), list):
                row["category"] = ", ".join(row["category"])
            writer.writerow(row)
    print(f"CSV saved to: {output_csv}")

    print_usage_summary()
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Evaluate Figma Slide Benchmark results")
    parser.add_argument("--judge-model", default="gpt-5.5", help="Model to use for judging (default: gpt-5.5)")
    parser.add_argument("--api-key", default=None, help="API key (or set OPENAI_API_KEY / GEMINI_API_KEY env var)")
    parser.add_argument("--filter-case", nargs="*", default=None, help="Only evaluate specific case names")
    parser.add_argument("--filter-suffix", default=None, help="Only evaluate result dirs containing this suffix (e.g., CARE_hybrid)")
    parser.add_argument("--filter-exact-model", default=None, help="Only match result dirs with exactly this model tag (e.g., gpt-5.2)")
    parser.add_argument("--skip-visual", action="store_true", help="Skip visual quality judging (faster, instruction-only)")
    parser.add_argument("--output-json", default=None, help="Output JSON file path")
    parser.add_argument("--output-csv", default=None, help="Output CSV file path")
    parser.add_argument("--eval-file", default=None, help="Custom evaluation pairs JSON file path")
    parser.add_argument("--results-dir", default=None, help="Custom results directory path (default: results/figma_slide)")
    parser.add_argument("--resume-from", default=None,
                        help="Path to a previous evaluation_results JSON; matching (case_name, result_dir, judge_model) rows are reused instead of re-judged")
    parser.add_argument("--pred-snapshot", type=int, default=None,
                        help="Force pred to use a specific snapshot turn (e.g., 0 = initial state before any agent edits). "
                             "Useful for measuring an 'agent-did-nothing' lower-bound for fair comparison against systems "
                             "that don't always produce a modified output (e.g., 'No changes needed' cases).")
    parser.add_argument("--parallel", type=int, default=1,
                        help="Number of cases to judge concurrently via ThreadPoolExecutor. Default 1 (serial). "
                             "LLM-bound work fans out; 8-12 is a safe target for OpenAI gpt-5 tier and gives ~8-10x speedup.")
    args = parser.parse_args()

    if args.eval_file:
        global EVAL_PAIRS_PATH
        EVAL_PAIRS_PATH = Path(args.eval_file).resolve()

    if args.results_dir:
        global RESULTS_DIR
        RESULTS_DIR = Path(args.results_dir).resolve()

    run_evaluation(
        judge_model=args.judge_model,
        api_key=args.api_key,
        filter_cases=args.filter_case,
        filter_suffix=args.filter_suffix,
        filter_exact_model=args.filter_exact_model,
        skip_visual=args.skip_visual,
        output_json=args.output_json,
        output_csv=args.output_csv,
        resume_from=args.resume_from,
        pred_snapshot_turn=args.pred_snapshot,
        parallel=args.parallel,
    )


if __name__ == "__main__":
    main()
