"""
SceneGraph → OOXML (PresentationML) Converter for Ablation Study

Converts Figma SceneGraph JSON (JSON_REST_V1) to PowerPoint-style OOXML XML,
flattening the hierarchy and using absolute EMU positioning.

Also produces a bidirectional ID mapping table so that agent actions
referencing XML element IDs can be converted back to Figma SceneGraph node IDs.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape as xml_escape

from .care_context import _find_slides_in_document, _rgba_to_hex

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PX_TO_EMU = 9525  # 1 pixel = 9525 EMU at 96 DPI

NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# Default slide dimensions in pixels
DEFAULT_SLIDE_W = 1920
DEFAULT_SLIDE_H = 1080


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _px_to_emu(px: float) -> int:
    """Convert pixels to EMU (English Metric Units)."""
    return round(px * PX_TO_EMU)


def _font_size_to_ooxml(font_size_pt: float) -> int:
    """Convert font size in points to OOXML hundredths-of-a-point."""
    return round(font_size_pt * 100)


def _get_absolute_position(node: dict) -> Tuple[float, float]:
    """Extract absolute position (px) from a node.

    Prefers absoluteBoundingBox; falls back to relativeTransform tx/ty.
    """
    bb = node.get("absoluteBoundingBox")
    if isinstance(bb, dict):
        return (bb.get("x", 0), bb.get("y", 0))

    rt = node.get("relativeTransform")
    if isinstance(rt, list) and len(rt) == 2:
        try:
            return (rt[0][2], rt[1][2])
        except (IndexError, TypeError):
            pass

    # Compact micro-spatial format: "pos" = [tx, ty]
    pos = node.get("pos")
    if isinstance(pos, list) and len(pos) == 2:
        return (pos[0], pos[1])

    # Compact skeleton format: "bounds" = [x, y, w, h]
    bounds = node.get("bounds")
    if isinstance(bounds, list) and len(bounds) >= 2:
        return (bounds[0], bounds[1])

    return (0, 0)


def _get_size(node: dict) -> Tuple[float, float]:
    """Extract width/height (px) from a node."""
    # Standard size field {x: w, y: h}
    sz = node.get("size")
    if isinstance(sz, dict):
        return (sz.get("x", 0), sz.get("y", 0))
    # Compact micro-spatial format: [w, h]
    if isinstance(sz, list) and len(sz) == 2:
        return (sz[0], sz[1])

    bb = node.get("absoluteBoundingBox")
    if isinstance(bb, dict):
        return (bb.get("width", 0), bb.get("height", 0))

    # Compact skeleton format: "bounds" = [x, y, w, h]
    bounds = node.get("bounds")
    if isinstance(bounds, list) and len(bounds) >= 4:
        return (bounds[2], bounds[3])

    return (0, 0)


def _get_fill_hex(node: dict) -> Optional[str]:
    """Return hex colour string from first solid fill, or None."""
    fills = node.get("fills")
    if not isinstance(fills, list):
        return None
    for fill in fills:
        if not isinstance(fill, dict):
            continue
        # Micro-spatial compact form: {"type": "SOLID", "color": "#hex"}
        if fill.get("type") == "SOLID":
            color = fill.get("color")
            if isinstance(color, str) and color.startswith("#"):
                return color.lstrip("#").upper()
            if isinstance(color, dict):
                return _rgba_to_hex(color).lstrip("#").upper()
    return None


def _get_stroke_info(node: dict) -> Optional[Tuple[str, float]]:
    """Return (hex_color, weight_px) from first solid stroke, or None."""
    strokes = node.get("strokes")
    if not isinstance(strokes, list):
        return None
    for stroke in strokes:
        if not isinstance(stroke, dict):
            continue
        if stroke.get("type") == "SOLID":
            color = stroke.get("color")
            weight = stroke.get("weight") or node.get("strokeWeight", 1)
            if isinstance(color, str) and color.startswith("#"):
                return (color.lstrip("#").upper(), weight)
            if isinstance(color, dict):
                return (_rgba_to_hex(color).lstrip("#").upper(), weight)
    return None


def _get_text_style(node: dict) -> dict:
    """Extract text style info from a TEXT node."""
    style = node.get("style", {})
    if not isinstance(style, dict):
        style = {}
    return {
        "fontFamily": style.get("fontFamily", ""),
        "fontSize": style.get("fontSize", 18),
        "fontWeight": style.get("fontWeight"),
        "fontStyle": style.get("fontStyle", "Regular"),
        "textAlignHorizontal": (
            style.get("textAlignHorizontal")
            or node.get("textAlignHorizontal")
            or "LEFT"
        ),
    }


def _parse_svg_path(path_str: str) -> list:
    """Parse an SVG path string into a list of (command, points) tuples.

    Supports M (moveTo), L (lineTo), C (cubicBezTo), Q (quadBezTo), Z (close).
    Returns: [(cmd, [(x, y), ...]), ...]
    """
    import re
    commands = []
    # Tokenize: split on command letters, keeping the letter
    tokens = re.findall(r'[MLCQZmlcqz][^MLCQZmlcqz]*', path_str.strip())
    for token in tokens:
        cmd = token[0].upper()
        if cmd == 'Z':
            commands.append(('Z', []))
            continue
        # Extract numbers (int or float)
        nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', token[1:])]
        points = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        commands.append((cmd, points))
    return commands


def _svg_path_to_custgeom(path_str: str, width: float, height: float) -> str:
    """Convert an SVG path string to OOXML <a:custGeom> XML.

    Uses the shape's pixel dimensions as the path coordinate space.
    """
    commands = _parse_svg_path(path_str)
    if not commands:
        return f'<a:prstGeom prst="rect"/>'

    # Use shape pixel dimensions as coordinate space (scaled to int)
    # Multiply by 100 for precision with fractional coordinates
    scale = 100
    path_w = round(width * scale)
    path_h = round(height * scale)

    path_elements = []
    for cmd, points in commands:
        if cmd == 'M' and len(points) >= 1:
            x, y = points[0]
            path_elements.append(
                f'<a:moveTo><a:pt x="{round(x * scale)}" y="{round(y * scale)}"/></a:moveTo>'
            )
        elif cmd == 'L':
            for x, y in points:
                path_elements.append(
                    f'<a:lnTo><a:pt x="{round(x * scale)}" y="{round(y * scale)}"/></a:lnTo>'
                )
        elif cmd == 'C':
            # Cubic bezier: 3 points per curve segment
            for i in range(0, len(points) - 2, 3):
                p1, p2, p3 = points[i], points[i + 1], points[i + 2]
                path_elements.append(
                    f'<a:cubicBezTo>'
                    f'<a:pt x="{round(p1[0] * scale)}" y="{round(p1[1] * scale)}"/>'
                    f'<a:pt x="{round(p2[0] * scale)}" y="{round(p2[1] * scale)}"/>'
                    f'<a:pt x="{round(p3[0] * scale)}" y="{round(p3[1] * scale)}"/>'
                    f'</a:cubicBezTo>'
                )
        elif cmd == 'Q':
            # Quadratic bezier: 2 points per segment
            for i in range(0, len(points) - 1, 2):
                p1, p2 = points[i], points[i + 1]
                path_elements.append(
                    f'<a:quadBezTo>'
                    f'<a:pt x="{round(p1[0] * scale)}" y="{round(p1[1] * scale)}"/>'
                    f'<a:pt x="{round(p2[0] * scale)}" y="{round(p2[1] * scale)}"/>'
                    f'</a:quadBezTo>'
                )
        elif cmd == 'Z':
            path_elements.append('<a:close/>')

    inner = "\n      ".join(path_elements)
    return (
        f'<a:custGeom>\n'
        f'  <a:avLst/>\n'
        f'  <a:gdLst/>\n'
        f'  <a:ahLst/>\n'
        f'  <a:cxnLst/>\n'
        f'  <a:rect l="0" t="0" r="{path_w}" b="{path_h}"/>\n'
        f'  <a:pathLst>\n'
        f'    <a:path w="{path_w}" h="{path_h}">\n'
        f'      {inner}\n'
        f'    </a:path>\n'
        f'  </a:pathLst>\n'
        f'</a:custGeom>'
    )


def _get_fill_geometry_path(node: dict) -> Optional[str]:
    """Extract the first fillGeometry path string from a VECTOR node, or None."""
    fg = node.get("fillGeometry")
    if isinstance(fg, list) and fg:
        entry = fg[0]
        if isinstance(entry, dict):
            return entry.get("path")
    return None


def _indent(text: str, level: int) -> str:
    """Indent each line of text by `level * 2` spaces."""
    prefix = "  " * level
    return "\n".join(prefix + line for line in text.split("\n"))


# ---------------------------------------------------------------------------
# Node → OOXML shape serialization
# ---------------------------------------------------------------------------

def _shape_to_xml(
    xml_id: int,
    node: dict,
    abs_x: float,
    abs_y: float,
    width: float,
    height: float,
) -> str:
    """Serialize a single SceneGraph node as an OOXML <p:sp> element."""
    ntype = node.get("type", "RECTANGLE")
    name = xml_escape(node.get("name", ""))

    x_emu = _px_to_emu(abs_x)
    y_emu = _px_to_emu(abs_y)
    cx_emu = _px_to_emu(width)
    cy_emu = _px_to_emu(height)

    # Determine geometry
    geom_xml = None
    if ntype == "VECTOR":
        svg_path = _get_fill_geometry_path(node)
        if svg_path:
            geom_xml = _svg_path_to_custgeom(svg_path, width, height)

    if geom_xml is None:
        if ntype == "ELLIPSE":
            prst = "ellipse"
        else:
            prst = "rect"
        geom_xml = f'<a:prstGeom prst="{prst}"/>'

    # Build shape properties
    sp_pr_children = [
        f'<a:xfrm>\n'
        f'  <a:off x="{x_emu}" y="{y_emu}"/>\n'
        f'  <a:ext cx="{cx_emu}" cy="{cy_emu}"/>\n'
        f'</a:xfrm>',
        geom_xml,
    ]

    # Fill
    fill_hex = _get_fill_hex(node)
    if fill_hex:
        opacity = node.get("opacity")
        if opacity is not None and opacity < 1:
            alpha_val = round(opacity * 100000)
            sp_pr_children.append(
                f'<a:solidFill>\n'
                f'  <a:srgbClr val="{fill_hex}">\n'
                f'    <a:alpha val="{alpha_val}"/>\n'
                f'  </a:srgbClr>\n'
                f'</a:solidFill>'
            )
        else:
            sp_pr_children.append(
                f'<a:solidFill>\n'
                f'  <a:srgbClr val="{fill_hex}"/>\n'
                f'</a:solidFill>'
            )

    # Stroke
    stroke_info = _get_stroke_info(node)
    if stroke_info:
        s_color, s_weight = stroke_info
        w_emu = _px_to_emu(s_weight)
        sp_pr_children.append(
            f'<a:ln w="{w_emu}">\n'
            f'  <a:solidFill>\n'
            f'    <a:srgbClr val="{s_color}"/>\n'
            f'  </a:solidFill>\n'
            f'</a:ln>'
        )

    sp_pr_xml = "\n".join(sp_pr_children)

    # Non-visual properties
    nv_sp_pr = (
        f'<p:nvSpPr>\n'
        f'  <p:cNvPr id="{xml_id}" name="{name}"/>\n'
        f'  <p:cNvSpPr/>\n'
        f'  <p:nvPr/>\n'
        f'</p:nvSpPr>'
    )

    # Text body (for TEXT nodes)
    tx_body = ""
    if ntype == "TEXT":
        characters = node.get("characters", "")
        ts = _get_text_style(node)
        font_family = xml_escape(ts["fontFamily"]) if ts["fontFamily"] else "Arial"
        sz = _font_size_to_ooxml(ts["fontSize"])
        bold = ' b="1"' if ts.get("fontWeight") and str(ts["fontWeight"]).lower() in ("bold", "700", "800", "900") else ""
        italic = ' i="1"' if ts.get("fontStyle") and "italic" in str(ts["fontStyle"]).lower() else ""

        # Text color from fill
        text_color_hex = fill_hex or "000000"

        # Alignment
        algn_map = {"LEFT": "l", "CENTER": "ctr", "RIGHT": "r", "JUSTIFIED": "just"}
        algn = algn_map.get(ts["textAlignHorizontal"], "l")

        # Handle multi-line text: split by newlines into separate <a:p> elements
        lines = characters.split("\n") if characters else [""]
        paragraphs = []
        for line in lines:
            escaped_line = xml_escape(line)
            paragraphs.append(
                f'<a:p>\n'
                f'  <a:pPr algn="{algn}"/>\n'
                f'  <a:r>\n'
                f'    <a:rPr lang="en-US" sz="{sz}"{bold}{italic} dirty="0">\n'
                f'      <a:solidFill>\n'
                f'        <a:srgbClr val="{text_color_hex}"/>\n'
                f'      </a:solidFill>\n'
                f'      <a:latin typeface="{font_family}"/>\n'
                f'    </a:rPr>\n'
                f'    <a:t>{escaped_line}</a:t>\n'
                f'  </a:r>\n'
                f'</a:p>'
            )

        tx_body = (
            f'<p:txBody>\n'
            f'  <a:bodyPr/>\n'
            f'  {"  ".join(paragraphs)}\n'
            f'</p:txBody>'
        )

    # Assemble <p:sp>
    parts = [nv_sp_pr, f'<p:spPr>\n{_indent(sp_pr_xml, 1)}\n</p:spPr>']
    if tx_body:
        parts.append(tx_body)

    inner = "\n".join(f"  {p}" for p in parts)
    return f'<p:sp>\n{_indent(inner, 0)}\n</p:sp>'


# ---------------------------------------------------------------------------
# Main conversion: SceneGraph → OOXML
# ---------------------------------------------------------------------------

def _flatten_slide_nodes(
    node: dict,
    slide_abs_x: float,
    slide_abs_y: float,
    parent_figma_id: str,
    parent_abs_x: float,
    parent_abs_y: float,
    counter: List[int],
    shapes: List[str],
    id_mapping: Dict[str, dict],
    is_slide_root: bool = False,
) -> None:
    """Recursively flatten all descendant nodes of a slide into shapes.

    Each node is emitted as a direct child of <p:spTree> with absolute
    positioning, regardless of nesting depth in the original SceneGraph.
    """
    children = node.get("children", [])
    if not isinstance(children, list):
        return

    for child in children:
        if not isinstance(child, dict):
            continue

        child_id = child.get("id", "")
        child_type = child.get("type", "")

        # Skip non-visual nodes
        if child.get("visible") is False:
            continue

        # Compute absolute position
        child_rel_x, child_rel_y = _get_absolute_position(child)
        # If the child has absoluteBoundingBox, use it directly (slide-relative)
        bb = child.get("absoluteBoundingBox")
        if isinstance(bb, dict):
            child_abs_x = bb.get("x", 0) - slide_abs_x
            child_abs_y = bb.get("y", 0) - slide_abs_y
        elif child.get("bounds"):
            # Micro-spatial compact: bounds are already slide-relative
            bounds = child["bounds"]
            child_abs_x = bounds[0]
            child_abs_y = bounds[1]
        elif child.get("pos"):
            # Micro-spatial compact: pos is parent-relative
            child_abs_x = parent_abs_x + child["pos"][0]
            child_abs_y = parent_abs_y + child["pos"][1]
        else:
            # relativeTransform is parent-relative
            child_abs_x = parent_abs_x + child_rel_x
            child_abs_y = parent_abs_y + child_rel_y

        child_w, child_h = _get_size(child)

        # Skip zero-size nodes (decorative or structural)
        if child_w == 0 and child_h == 0 and child_type not in ("TEXT",):
            # Still recurse into children for groups/frames
            if child_type in ("FRAME", "GROUP", "SECTION", "SLIDE_ROW"):
                _flatten_slide_nodes(
                    child, slide_abs_x, slide_abs_y,
                    child_id, child_abs_x, child_abs_y,
                    counter, shapes, id_mapping,
                )
            continue

        # Assign XML ID
        counter[0] += 1
        xml_id = counter[0]

        # Record mapping (coordinates stored in PIXELS for MappedTools)
        id_mapping[str(xml_id)] = {
            "figmaId": child_id,
            "type": child_type,
            "name": child.get("name", ""),
            "parentFigmaId": parent_figma_id,
            "parentAbsX": parent_abs_x,
            "parentAbsY": parent_abs_y,
            "absX": child_abs_x,
            "absY": child_abs_y,
        }

        # Emit as <p:sp> shape (flat, absolute positioning)
        shape_xml = _shape_to_xml(
            xml_id, child,
            child_abs_x, child_abs_y,
            child_w, child_h,
        )
        shapes.append(shape_xml)

        # Recurse into children (for FRAME, GROUP, etc.)
        # Even though the XML is flat, we need to visit nested children
        if child_type in ("FRAME", "GROUP", "SECTION"):
            _flatten_slide_nodes(
                child, slide_abs_x, slide_abs_y,
                child_id, child_abs_x, child_abs_y,
                counter, shapes, id_mapping,
            )


def _slide_to_xml(
    slide: dict,
    slide_index: int,
    counter: List[int],
    id_mapping: Dict[str, dict],
) -> str:
    """Convert a single slide node to OOXML <p:sld> element."""
    slide_id = slide.get("id", "")
    slide_name = xml_escape(slide.get("name", f"Slide {slide_index + 1}"))

    # Slide dimensions
    w, h = _get_size(slide)
    if w == 0:
        w = DEFAULT_SLIDE_W
    if h == 0:
        h = DEFAULT_SLIDE_H

    # Slide absolute position on canvas (for computing child abs positions)
    bb = slide.get("absoluteBoundingBox", {})
    slide_abs_x = bb.get("x", 0) if isinstance(bb, dict) else 0
    slide_abs_y = bb.get("y", 0) if isinstance(bb, dict) else 0

    slide_w_emu = _px_to_emu(w)
    slide_h_emu = _px_to_emu(h)

    # Assign XML ID for the slide itself
    counter[0] += 1
    slide_xml_id = counter[0]

    id_mapping[str(slide_xml_id)] = {
        "figmaId": slide_id,
        "type": slide.get("type", "SLIDE"),
        "name": slide.get("name", ""),
        "parentFigmaId": "",
        "parentAbsX": 0,
        "parentAbsY": 0,
        "absX": 0,
        "absY": 0,
    }

    # Group shape properties (root container)
    grp_sp_tree_header = (
        f'<p:nvGrpSpPr>\n'
        f'  <p:cNvPr id="{slide_xml_id}" name=""/>\n'
        f'  <p:cNvGrpSpPr/>\n'
        f'  <p:nvPr/>\n'
        f'</p:nvGrpSpPr>\n'
        f'<p:grpSpPr>\n'
        f'  <a:xfrm>\n'
        f'    <a:off x="0" y="0"/>\n'
        f'    <a:ext cx="{slide_w_emu}" cy="{slide_h_emu}"/>\n'
        f'    <a:chOff x="0" y="0"/>\n'
        f'    <a:chExt cx="{slide_w_emu}" cy="{slide_h_emu}"/>\n'
        f'  </a:xfrm>\n'
        f'</p:grpSpPr>'
    )

    # Flatten all descendant nodes into shapes
    shapes: List[str] = []
    _flatten_slide_nodes(
        slide, slide_abs_x, slide_abs_y,
        slide_id, 0, 0,  # parent abs is (0,0) = slide origin
        counter, shapes, id_mapping,
        is_slide_root=True,
    )

    # Assemble <p:spTree>
    shapes_xml = "\n".join(_indent(s, 3) for s in shapes)
    sp_tree = (
        f'    <p:spTree>\n'
        f'{_indent(grp_sp_tree_header, 3)}\n'
        f'{shapes_xml}\n'
        f'    </p:spTree>'
    )

    # Slide fill
    slide_fill = ""
    fill_hex = _get_fill_hex(slide)
    if fill_hex:
        slide_fill = (
            f'\n    <p:bg>\n'
            f'      <p:bgPr>\n'
            f'        <a:solidFill>\n'
            f'          <a:srgbClr val="{fill_hex}"/>\n'
            f'        </a:solidFill>\n'
            f'      </p:bgPr>\n'
            f'    </p:bg>'
        )

    return (
        f'<p:sld xmlns:a="{NS_A}"\n'
        f'       xmlns:r="{NS_R}"\n'
        f'       xmlns:p="{NS_P}">\n'
        f'  <p:cSld name="{slide_name}">{slide_fill}\n'
        f'{sp_tree}\n'
        f'  </p:cSld>\n'
        f'</p:sld>'
    )


def scenegraph_to_xml(
    scene_graph: dict,
    target_slide_indices: Optional[List[int]] = None,
) -> Tuple[str, Dict[str, dict]]:
    """Convert a SceneGraph JSON document to OOXML PresentationML XML.

    Supports both full documents and CARE context representations
    (micro-spatial, skeleton, etc.).

    Args:
        scene_graph: The SceneGraph JSON (full_document, skeleton, or
            micro-spatial context).
        target_slide_indices: If provided, only convert these slides.

    Returns:
        A tuple of (xml_string, id_mapping) where:
        - xml_string: The complete OOXML XML representation.
        - id_mapping: Dict mapping XML element ID (str) to mapping entry
          containing figmaId, type, parentFigmaId, parentAbsX/Y, absX/Y.
    """
    id_mapping: Dict[str, dict] = {}
    counter = [0]  # Mutable counter for sequential ID assignment

    # Handle micro-spatial context format
    # {targetSlides: [{sceneGraph: {...}}, ...], otherSlides: [...]}
    target_slides_list = scene_graph.get("targetSlides")
    if target_slides_list is not None:
        slides_data = []
        for ts in target_slides_list:
            sg = ts.get("sceneGraph")
            if sg:
                slides_data.append(sg)
        # Also note other slides (minimal reference)
        other_slides = scene_graph.get("otherSlides", [])
    else:
        # Standard document format or skeleton
        doc = scene_graph.get("document", scene_graph)
        slides_data = _find_slides_in_document(scene_graph)
        other_slides = []

    # Filter to target indices if specified
    if target_slide_indices and not target_slides_list:
        slides_data = [
            s for i, s in enumerate(slides_data)
            if i in target_slide_indices
        ]

    if not slides_data:
        logger.warning("No slides found in scene graph for XML conversion")
        return "<p:presentation/>", {}

    # Convert each slide
    slide_xmls: List[str] = []
    for idx, slide in enumerate(slides_data):
        slide_xml = _slide_to_xml(slide, idx, counter, id_mapping)
        slide_xmls.append(slide_xml)

    # Wrap in <p:presentation> if multiple slides
    if len(slide_xmls) == 1:
        xml_string = slide_xmls[0]
    else:
        slides_inner = "\n".join(_indent(s, 1) for s in slide_xmls)
        xml_string = (
            f'<p:presentation xmlns:a="{NS_A}"\n'
            f'                xmlns:r="{NS_R}"\n'
            f'                xmlns:p="{NS_P}">\n'
            f'{slides_inner}\n'
            f'</p:presentation>'
        )

    logger.info(
        f"SceneGraph → XML: {len(slides_data)} slide(s), "
        f"{len(id_mapping)} element(s), "
        f"{len(xml_string):,} bytes"
    )

    return xml_string, id_mapping


# ---------------------------------------------------------------------------
# Style Metadata → OOXML XML (for SYSTEMIC_TOKEN mode)
# ---------------------------------------------------------------------------

def style_metadata_to_xml(
    style_meta: dict,
) -> Tuple[str, Dict[str, Dict]]:
    """Convert style metadata JSON to an OOXML-style XML representation.

    The style metadata (from extract_style_metadata) is a design-token summary,
    not a spatial tree. We serialize it as a <p:presentation> with:
    - <p:sldIdLst> listing all slides
    - <a:theme> with unique colors and fonts
    - <a:colorUsage> mapping colors to nodes per slide

    Returns (xml_string, id_mapping) where id_mapping maps XML integer IDs
    to original Figma node IDs, just like scenegraph_to_xml.
    """
    slide_count = style_meta.get("slideCount", 0)
    slides = style_meta.get("slides", [])
    unique_colors = style_meta.get("uniqueColors", [])
    unique_fonts = style_meta.get("uniqueFonts", [])
    color_usage = style_meta.get("colorUsage", {})
    font_usage = style_meta.get("fontUsage", {})

    # Build Figma ID → XML integer ID mapping
    id_mapping: Dict[str, Dict] = {}
    figma_to_xml: Dict[str, int] = {}
    counter = 0

    def get_xml_id(figma_id: str, node_name: str = "",
                   node_type: str = "NODE") -> int:
        nonlocal counter
        if figma_id in figma_to_xml:
            return figma_to_xml[figma_id]
        counter += 1
        xml_id = counter
        figma_to_xml[figma_id] = xml_id
        id_mapping[str(xml_id)] = {
            "figmaId": figma_id,
            "type": node_type,
            "name": node_name,
            "parentFigmaId": "",
            "parentAbsX": 0,
            "parentAbsY": 0,
            "absX": 0,
            "absY": 0,
        }
        return xml_id

    parts: List[str] = []

    # Slide list — map slide IDs to integers
    slide_lines = []
    for s in slides:
        figma_sid = str(s.get("id", ""))
        slide_name = str(s.get("name", ""))
        xml_sid = get_xml_id(figma_sid, slide_name, "SLIDE")
        bg = s.get("backgroundFill", "")
        bg_attr = f' bg="{xml_escape(bg)}"' if bg else ""
        slide_lines.append(
            f'    <p:sldId id="{xml_sid}" '
            f'name="{xml_escape(slide_name)}" '
            f'idx="{s.get("index", 0)}"{bg_attr}/>'
        )
    parts.append(
        f"  <p:sldIdLst count=\"{slide_count}\">\n"
        + "\n".join(slide_lines)
        + "\n  </p:sldIdLst>"
    )

    # Theme colors — map nodeId in usage entries to integers
    color_lines = []
    for hex_color in unique_colors:
        val = hex_color.lstrip("#").upper()
        usages = color_usage.get(hex_color, [])
        if usages:
            usage_entries = []
            for u in usages:
                figma_nid = str(u.get("nodeId", ""))
                node_name = str(u.get("nodeName", ""))
                xml_nid = get_xml_id(figma_nid, node_name)
                usage_entries.append(
                    f'        <a:usage nodeId="{xml_nid}" '
                    f'name="{xml_escape(node_name)}" '
                    f'slide="{u.get("slideIndex", 0)}" '
                    f'prop="{xml_escape(str(u.get("property", "")))}" />'
                )
            color_lines.append(
                f'      <a:srgbClr val="{val}">\n'
                + "\n".join(usage_entries)
                + "\n      </a:srgbClr>"
            )
        else:
            color_lines.append(f'      <a:srgbClr val="{val}"/>')

    # Theme fonts — map nodeId in usage entries to integers
    font_lines = []
    for f in unique_fonts:
        family = xml_escape(str(f.get("fontFamily", "")))
        style = xml_escape(str(f.get("fontStyle", "")))
        fk = f"{f.get('fontFamily', '')}:{f.get('fontStyle', '')}"
        usages = font_usage.get(fk, [])
        if usages:
            usage_entries = []
            for u in usages:
                figma_nid = str(u.get("nodeId", ""))
                node_name = str(u.get("nodeName", ""))
                xml_nid = get_xml_id(figma_nid, node_name)
                usage_entries.append(
                    f'        <a:usage nodeId="{xml_nid}" '
                    f'name="{xml_escape(node_name)}" '
                    f'slide="{u.get("slideIndex", 0)}" '
                    f'sz="{u.get("fontSize", "")}" />'
                )
            font_lines.append(
                f'      <a:latin typeface="{family}" style="{style}">\n'
                + "\n".join(usage_entries)
                + "\n      </a:latin>"
            )
        else:
            font_lines.append(
                f'      <a:latin typeface="{family}" style="{style}"/>'
            )

    parts.append(
        f"  <a:theme>\n"
        f"    <a:clrScheme>\n"
        + "\n".join(color_lines)
        + "\n    </a:clrScheme>\n"
        f"    <a:fontScheme>\n"
        + "\n".join(font_lines)
        + "\n    </a:fontScheme>\n"
        f"  </a:theme>"
    )

    xml_string = (
        f'<p:presentation xmlns:a="{NS_A}"\n'
        f'                xmlns:r="{NS_R}"\n'
        f'                xmlns:p="{NS_P}">\n'
        + "\n".join(parts)
        + "\n</p:presentation>"
    )

    return xml_string, id_mapping
