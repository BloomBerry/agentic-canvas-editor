"""
CARE (Context-Aware Routing Engine) - Context Preparation Module

Builds optimised context representations for each routing mode:
  - Skeleton JSON   (MACRO_PROGRAMMATIC)  – text nodes + IDs only
  - Style metadata  (SYSTEMIC_TOKEN)      – colors, fonts, usage
  - Micro-spatial   (MICRO_SPATIAL)       – target slide scene-graphs only
  - Image selection  per mode
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .care_router import RoutingMode, RoutingDecision, PresentationSummary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip_absolute_bbox(slide_data: dict) -> None:
    """Remove absoluteBoundingBox/absoluteRenderBounds from slide descendants.

    Models confuse absoluteBoundingBox (slide-level absolute position) with
    parent-relative coordinates used by move_node.  After normalisation the
    values fall in a similar 0-1920 range as relativeTransform, making the
    confusion worse.  Stripping them forces the model to rely on
    relativeTransform, which matches what move_node expects.

    The slide root node keeps a simplified bbox (x=0, y=0, width, height)
    so the model still knows the slide dimensions.
    """
    root_bbox = slide_data.get("absoluteBoundingBox")
    # Preserve slide root dimensions but zero its origin
    if isinstance(root_bbox, dict):
        slide_data["absoluteBoundingBox"] = {
            "x": 0, "y": 0,
            "width": root_bbox.get("width", 1920),
            "height": root_bbox.get("height", 1080),
        }
    slide_data.pop("absoluteRenderBounds", None)

    def _strip(node: dict) -> None:
        node.pop("absoluteBoundingBox", None)
        node.pop("absoluteRenderBounds", None)
        for child in node.get("children", []):
            if isinstance(child, dict):
                _strip(child)

    for child in slide_data.get("children", []):
        if isinstance(child, dict):
            _strip(child)


def _strip_document_absolute_bbox(full_doc: dict) -> None:
    """Strip absoluteBoundingBox from all slides in a full document JSON.

    Delegates to _strip_absolute_bbox for each slide found in the document.
    Modifies the document in place.
    """
    slides = _find_slides_in_document(full_doc)
    for slide in slides:
        _strip_absolute_bbox(slide)


def _find_slides_in_document(full_doc: dict) -> List[dict]:
    """Walk the Figma doc tree and return all slide-level nodes in order.

    Supports both original Figma Slides format (type=SLIDE) and
    converted Design format (CANVAS > SECTION > FRAME or CANVAS > FRAME).
    """
    slides: List[dict] = []

    def _walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        ntype = node.get("type")

        if ntype == "SLIDE":
            slides.append(node)
            return

        if ntype in ("DOCUMENT", "SLIDE_ROW"):
            for child in node.get("children", []):
                _walk(child)
            return

        if ntype == "CANVAS":
            for child in node.get("children", []):
                ctype = child.get("type")
                if ctype == "SLIDE":
                    slides.append(child)
                elif ctype == "SECTION":
                    for gc in child.get("children", []):
                        if gc.get("type") in ("FRAME", "SLIDE"):
                            slides.append(gc)
                elif ctype == "FRAME":
                    # Check if it's a Presentation container (FRAME > SLIDE_ROW > SLIDE)
                    inner = [
                        gc
                        for gc in child.get("children", [])
                        if gc.get("type") in ("SLIDE", "SLIDE_ROW")
                    ]
                    if inner:
                        for item in child.get("children", []):
                            if item.get("type") == "SLIDE":
                                slides.append(item)
                            elif item.get("type") == "SLIDE_ROW":
                                for gc in item.get("children", []):
                                    if gc.get("type") in ("SLIDE", "FRAME"):
                                        slides.append(gc)
                    else:
                        slides.append(child)
                elif ctype == "SLIDE_ROW":
                    for gc in child.get("children", []):
                        if gc.get("type") in ("SLIDE", "FRAME"):
                            slides.append(gc)
            return

        for child in node.get("children", []):
            _walk(child)

    _walk(full_doc.get("document", full_doc))
    return slides


def _rgba_to_hex(color: dict) -> str:
    r = int(color.get("r", 0) * 255)
    g = int(color.get("g", 0) * 255)
    b = int(color.get("b", 0) * 255)
    a = color.get("a", 1)
    if a < 1:
        return f"#{r:02x}{g:02x}{b:02x}{int(a * 255):02x}"
    return f"#{r:02x}{g:02x}{b:02x}"


# ---------------------------------------------------------------------------
# 1. Skeleton JSON  (MACRO_PROGRAMMATIC)
# ---------------------------------------------------------------------------

_SKELETON_STYLE_KEYS = {
    "fontFamily", "fontStyle", "fontWeight", "fontSize", "textCase",
    "textDecoration", "textAlignHorizontal",
}


def extract_skeleton_json(
    full_doc: dict,
    target_slide_indices: Optional[List[int]] = None,
) -> dict:
    """
    Strip rendering data from the document, keeping only
    identity (id, name, type), text content, and minimal style info.

    For *target* slides (those the user explicitly references in the
    instruction), compact bounding-box data ``[x, y, w, h]`` is also
    preserved so the model can perform spatial reasoning (e.g. "text
    below the chart").  Non-target slides remain lean.

    Expected reduction: ~85-95 % of original size.
    """
    # Build sets for slide-level detection and spatial data.
    slides = _find_slides_in_document(full_doc)
    _all_slide_ids: set = {s.get("id") for s in slides if s.get("id")}
    _target_slide_ids: set = set()
    # Per-slide canvas offset for bbox normalization (slide_id → (offset_x, offset_y))
    _slide_offsets: Dict[str, tuple] = {}
    if target_slide_indices:
        for idx in target_slide_indices:
            if 0 <= idx < len(slides):
                slide = slides[idx]
                sid = slide.get("id")
                if sid:
                    _target_slide_ids.add(sid)
                    bb = slide.get("absoluteBoundingBox")
                    if isinstance(bb, dict):
                        _slide_offsets[sid] = (bb.get("x", 0), bb.get("y", 0))

    def _compact_bounds(node: dict, offset: tuple = (0, 0)) -> Optional[list]:
        """Return [x, y, w, h] as rounded ints, normalised to slide-relative coords."""
        bb = node.get("absoluteBoundingBox") or node.get("absoluteRenderBounds")
        if not isinstance(bb, dict):
            return None
        try:
            return [
                round(bb["x"] - offset[0]),
                round(bb["y"] - offset[1]),
                round(bb["width"]),
                round(bb["height"]),
            ]
        except (KeyError, TypeError):
            return None

    def _strip(node: Any, in_target_slide: bool = False,
               slide_offset: tuple = (0, 0)) -> Optional[dict]:
        if not isinstance(node, dict):
            return None

        out: Dict[str, Any] = {}

        # Identity – always keep
        for k in ("id", "name", "type"):
            if k in node:
                out[k] = node[k]

        # Track whether we are inside a target slide
        node_id = node.get("id")
        is_target = in_target_slide or (node_id in _target_slide_ids)
        # Pick up this slide's offset when entering a target slide
        cur_offset = _slide_offsets.get(node_id, slide_offset) if is_target else slide_offset

        # Compact bounding box [x, y, w, h] – only for target slides
        if is_target:
            bounds = _compact_bounds(node, cur_offset)
            if bounds is not None:
                out["bounds"] = bounds

        # Text content
        if node.get("type") == "TEXT":
            if "characters" in node:
                out["characters"] = node["characters"]
            if "style" in node and isinstance(node["style"], dict):
                out["style"] = {
                    k: v
                    for k, v in node["style"].items()
                    if k in _SKELETON_STYLE_KEYS
                }
            if "textAlignHorizontal" in node:
                out["textAlignHorizontal"] = node["textAlignHorizontal"]
            # Mixed text styles (bold/italic segments within a single TEXT node)
            if "characterStyleOverrides" in node:
                out["characterStyleOverrides"] = node["characterStyleOverrides"]
            if "styleOverrideTable" in node:
                # Keep only text-relevant keys in each override entry
                filtered_table = {}
                for key, override in node["styleOverrideTable"].items():
                    if isinstance(override, dict):
                        filtered_table[key] = {
                            k: v for k, v in override.items()
                            if k in _SKELETON_STYLE_KEYS
                        }
                if filtered_table:
                    out["styleOverrideTable"] = filtered_table

        # Slide size (useful for creating new elements)
        # Supports both SLIDE (original) and FRAME (converted) at slide level
        if node.get("type") in ("SLIDE", "FRAME") and "size" in node:
            if node.get("type") == "SLIDE" or node_id in _all_slide_ids:
                out["size"] = node["size"]

        # Recurse
        if "children" in node:
            children = []
            for child in node["children"]:
                stripped = _strip(child, in_target_slide=is_target,
                                  slide_offset=cur_offset)
                if stripped is not None:
                    children.append(stripped)
            if children:
                out["children"] = children

        return out

    return {
        "fileName": full_doc.get("fileName", ""),
        "document": _strip(full_doc.get("document", {})),
    }


# ---------------------------------------------------------------------------
# 2. Style Metadata  (SYSTEMIC_TOKEN)
# ---------------------------------------------------------------------------

def extract_style_metadata(full_doc: dict) -> dict:
    """
    Extract design-system-relevant data only:
    unique fill/stroke colours, unique fonts, per-slide backgrounds.

    Output is typically 2-15 KB regardless of presentation size.
    """
    style_data: Dict[str, Any] = {
        "fileName": full_doc.get("fileName", ""),
        "slideCount": 0,
        "slides": [],
        "uniqueColors": [],
        "uniqueFonts": [],
        "colorUsage": {},
        "fontUsage": {},
    }

    seen_colors: set[str] = set()
    seen_fonts: set[str] = set()

    def _collect(node: dict, slide_idx: int) -> None:
        if not isinstance(node, dict):
            return

        node_id = node.get("id", "")
        node_name = node.get("name", "")

        # Fill colours
        for fill in node.get("fills", []):
            if fill.get("type") == "SOLID" and "color" in fill:
                hx = _rgba_to_hex(fill["color"])
                if hx not in seen_colors:
                    seen_colors.add(hx)
                    style_data["uniqueColors"].append(hx)
                    style_data["colorUsage"][hx] = []
                style_data["colorUsage"][hx].append({
                    "nodeId": node_id,
                    "nodeName": node_name,
                    "slideIndex": slide_idx,
                    "property": "fill",
                })

        # Stroke colours
        for stroke in node.get("strokes", []):
            if stroke.get("type") == "SOLID" and "color" in stroke:
                hx = _rgba_to_hex(stroke["color"])
                if hx not in seen_colors:
                    seen_colors.add(hx)
                    style_data["uniqueColors"].append(hx)
                    style_data["colorUsage"][hx] = []
                style_data["colorUsage"][hx].append({
                    "nodeId": node_id,
                    "nodeName": node_name,
                    "slideIndex": slide_idx,
                    "property": "stroke",
                })

        # Font info
        if node.get("type") == "TEXT" and isinstance(node.get("style"), dict):
            s = node["style"]
            fk = f"{s.get('fontFamily', 'Unknown')}:{s.get('fontStyle', 'Regular')}"
            if fk not in seen_fonts:
                seen_fonts.add(fk)
                style_data["uniqueFonts"].append({
                    "fontFamily": s.get("fontFamily", "Unknown"),
                    "fontStyle": s.get("fontStyle", "Regular"),
                })
                style_data["fontUsage"][fk] = []
            style_data["fontUsage"][fk].append({
                "nodeId": node_id,
                "nodeName": node_name,
                "slideIndex": slide_idx,
                "fontSize": s.get("fontSize"),
            })

        for child in node.get("children", []):
            _collect(child, slide_idx)

    slides = _find_slides_in_document(full_doc)
    style_data["slideCount"] = len(slides)

    for idx, slide in enumerate(slides):
        info: Dict[str, Any] = {
            "index": idx,
            "id": slide.get("id", ""),
            "name": slide.get("name", ""),
            "backgroundFill": None,
        }
        fills = slide.get("fills", [])
        if fills and fills[0].get("type") == "SOLID" and "color" in fills[0]:
            info["backgroundFill"] = _rgba_to_hex(fills[0]["color"])
        style_data["slides"].append(info)
        _collect(slide, idx)

    return style_data


# ---------------------------------------------------------------------------
# 3. Micro-Spatial Context  (MICRO_SPATIAL)
# ---------------------------------------------------------------------------

_MICRO_TEXT_STYLE_KEYS = {
    "fontFamily", "fontStyle", "fontSize",
    "textAlignHorizontal", "textAlignVertical",
    "letterSpacing", "lineHeightPx",
    "textCase", "textDecoration", "fontWeight",
}


def _compact_fill(fill: dict) -> Optional[dict]:
    """Compact a fill entry to {type, color, opacity?}."""
    ftype = fill.get("type")
    if ftype == "SOLID" and "color" in fill:
        out: Dict[str, Any] = {"type": "SOLID", "color": _rgba_to_hex(fill["color"])}
        opacity = fill.get("opacity")
        if opacity is not None and opacity < 1:
            out["opacity"] = round(opacity, 2)
        vis = fill.get("visible")
        if vis is False:
            out["visible"] = False
        return out
    if ftype in ("GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"):
        return {"type": ftype}
    if ftype == "IMAGE":
        return {"type": "IMAGE"}
    return None


def _prune_micro_spatial_node(
    node: Any,
    slide_offset: tuple = (0, 0),
    is_slide_root: bool = False,
) -> Optional[dict]:
    """Recursively prune a scene-graph node for micro-spatial context.

    Keeps identity, spatial data (bounds + compact relativeTransform),
    text content/style, compact fills/strokes, and layout properties.
    Strips rendering metadata, computed geometry, variable bindings, etc.
    """
    if not isinstance(node, dict):
        return None

    out: Dict[str, Any] = {}
    ntype = node.get("type", "")

    # --- Identity (always) ---
    for k in ("id", "name", "type"):
        if k in node:
            out[k] = node[k]

    # --- Slide-relative bounds [x, y, w, h] ---
    bb = node.get("absoluteBoundingBox") or node.get("absoluteRenderBounds")
    if isinstance(bb, dict):
        try:
            out["bounds"] = [
                round(bb["x"] - slide_offset[0]),
                round(bb["y"] - slide_offset[1]),
                round(bb["width"]),
                round(bb["height"]),
            ]
        except (KeyError, TypeError):
            pass

    # --- Position: relativeTransform → [tx, ty] ---
    rt = node.get("relativeTransform")
    if isinstance(rt, list) and len(rt) == 2:
        try:
            tx = round(rt[0][2], 1)
            ty = round(rt[1][2], 1)
            out["pos"] = [tx, ty]
            # Include rotation component if non-zero
            a, b = rt[0][0], rt[0][1]
            if not (abs(a - 1.0) < 0.001 and abs(b) < 0.001):
                out["relativeTransform"] = rt
        except (IndexError, TypeError):
            pass

    # --- Size: {x, y} → [w, h] ---
    sz = node.get("size")
    if isinstance(sz, dict):
        out["size"] = [round(sz.get("x", 0), 1), round(sz.get("y", 0), 1)]
    elif is_slide_root:
        # Fallback: derive from absoluteBoundingBox for slide root
        if isinstance(bb, dict):
            out["size"] = [round(bb.get("width", 1920)), round(bb.get("height", 1080))]

    # --- Rotation ---
    rot = node.get("rotation")
    if rot is not None and rot != 0:
        out["rotation"] = round(rot, 1)

    # --- Visibility (only when hidden) ---
    if node.get("visible") is False:
        out["visible"] = False

    # --- Opacity (only when not 1) ---
    opacity = node.get("opacity")
    if opacity is not None and opacity < 1:
        out["opacity"] = round(opacity, 2)

    # --- Text properties ---
    if ntype == "TEXT":
        if "characters" in node:
            out["characters"] = node["characters"]
        if "textAutoResize" in node:
            out["textAutoResize"] = node["textAutoResize"]
        # Compact style
        if isinstance(node.get("style"), dict):
            out["style"] = {
                k: v for k, v in node["style"].items()
                if k in _MICRO_TEXT_STYLE_KEYS
            }
        # Mixed formatting
        if node.get("characterStyleOverrides"):
            out["characterStyleOverrides"] = node["characterStyleOverrides"]
        if node.get("styleOverrideTable"):
            filtered = {}
            for key, override in node["styleOverrideTable"].items():
                if isinstance(override, dict):
                    filtered[key] = {
                        k: v for k, v in override.items()
                        if k in _MICRO_TEXT_STYLE_KEYS
                    }
            if filtered:
                out["styleOverrideTable"] = filtered

    # --- Fills (compact) ---
    fills = node.get("fills")
    if isinstance(fills, list) and fills:
        compacted = [f for f in (_compact_fill(f) for f in fills) if f]
        if compacted:
            out["fills"] = compacted

    # --- Strokes (compact) ---
    strokes = node.get("strokes")
    if isinstance(strokes, list) and strokes:
        compact_strokes = []
        for s in strokes:
            if s.get("type") == "SOLID" and "color" in s:
                cs: Dict[str, Any] = {"type": "SOLID", "color": _rgba_to_hex(s["color"])}
                sw = s.get("strokeWeight") or node.get("strokeWeight")
                if sw:
                    cs["weight"] = sw
                compact_strokes.append(cs)
        if compact_strokes:
            out["strokes"] = compact_strokes
    elif node.get("strokeWeight") and node.get("strokeWeight") > 0:
        out["strokeWeight"] = node["strokeWeight"]

    # --- Corner radius ---
    cr = node.get("cornerRadius")
    if cr is not None and cr > 0:
        out["cornerRadius"] = cr

    # --- Layout properties ---
    lm = node.get("layoutMode")
    if lm and lm != "NONE":
        out["layoutMode"] = lm
        for lk in ("itemSpacing", "paddingTop", "paddingLeft",
                    "paddingRight", "paddingBottom",
                    "primaryAxisAlignItems", "counterAxisAlignItems",
                    "layoutSizingHorizontal", "layoutSizingVertical"):
            if lk in node:
                out[lk] = node[lk]

    if node.get("clipsContent") is True:
        out["clipsContent"] = True

    # --- Children (recurse) ---
    children = node.get("children")
    if isinstance(children, list):
        pruned_children = []
        for child in children:
            pruned = _prune_micro_spatial_node(child, slide_offset)
            if pruned is not None:
                pruned_children.append(pruned)
        if pruned_children:
            out["children"] = pruned_children

    return out


def build_micro_spatial_context(
    data_dir: Path,
    target_indices: List[int],
    summary: PresentationSummary,
) -> dict:
    """
    Load pruned scene-graph JSON for the target slide(s) only,
    plus a minimal reference list for the rest.

    Pruning keeps identity, spatial bounds, text content, compact
    fills/strokes, and layout properties while stripping rendering
    metadata, computed geometry, and variable bindings.
    """
    context: Dict[str, Any] = {
        "fileName": summary.file_name,
        "slideCount": summary.slide_count,
        "targetSlides": [],
        "otherSlides": [],
    }

    jsons_dir = data_dir / "jsons"

    for idx in range(summary.slide_count):
        meta = summary.slides[idx] if idx < len(summary.slides) else {}

        if idx in target_indices:
            slide_path = jsons_dir / f"slide_{idx:03d}.json"
            if slide_path.exists():
                with open(slide_path, "r", encoding="utf-8") as f:
                    slide_data = json.load(f)
                # Extract slide canvas offset for slide-relative bounds
                root_bb = slide_data.get("absoluteBoundingBox", {})
                slide_offset = (root_bb.get("x", 0), root_bb.get("y", 0))
                pruned = _prune_micro_spatial_node(
                    slide_data, slide_offset, is_slide_root=True
                )
                context["targetSlides"].append({
                    "slideIndex": idx,
                    "slideNumber": idx + 1,
                    "nodeId": meta.get("node_id", ""),
                    "name": meta.get("name", ""),
                    "sceneGraph": pruned,
                })
            else:
                logger.warning(f"Slide JSON not found: {slide_path}")
                context["otherSlides"].append({
                    "slideIndex": idx,
                    "slideNumber": idx + 1,
                    "nodeId": meta.get("node_id", ""),
                    "name": meta.get("name", ""),
                })
        else:
            context["otherSlides"].append({
                "slideIndex": idx,
                "slideNumber": idx + 1,
                "nodeId": meta.get("node_id", ""),
                "name": meta.get("name", ""),
            })

    return context


# ---------------------------------------------------------------------------
# 4. Image Selection
# ---------------------------------------------------------------------------

def select_images_for_mode(
    frames_dir: Path,
    decision: RoutingDecision,
    summary: PresentationSummary,
) -> List[Path]:
    """
    Return slide PNG paths appropriate for the routing mode.

    If the router determined images are not needed (needs_image=False),
    return an empty list regardless of mode.

    Otherwise:
    - MICRO_SPATIAL:        target slide image(s) only
    - MACRO_PROGRAMMATIC:   first + last slide (visual reference)
    - SYSTEMIC_TOKEN:       first + middle slide
    - FULL:                 all slides
    """
    # Router says images are not needed for this task
    if not decision.needs_image:
        return []

    all_frames = sorted(frames_dir.glob("*.png"))
    if not all_frames:
        return []

    if decision.mode == RoutingMode.MICRO_SPATIAL:
        selected = []
        for idx in decision.target_slide_indices:
            fp = frames_dir / f"slide_{idx:03d}.png"
            if fp.exists():
                selected.append(fp)
        return selected if selected else all_frames[:1]

    if decision.mode == RoutingMode.MACRO_PROGRAMMATIC:
        targets = decision.target_slide_indices
        selected = []
        for idx in targets:
            fp = frames_dir / f"slide_{idx:03d}.png"
            if fp.exists():
                selected.append(fp)
        # If needs_image=True but no specific targets, provide all slides
        return selected if selected else all_frames

    if decision.mode == RoutingMode.SYSTEMIC_TOKEN:
        selected = [all_frames[0]]
        if len(all_frames) > 2:
            selected.append(all_frames[len(all_frames) // 2])
        return selected

    # FULL – return everything
    return all_frames
