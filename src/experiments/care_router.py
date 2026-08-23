"""
CARE (Context-Aware Routing Engine) - Router Module

Classifies presentation editing instructions into one of three execution modes:
  - MICRO_SPATIAL: Targeted editing on specific slide(s)
  - MACRO_PROGRAMMATIC: Batch operations across the entire presentation
  - SYSTEMIC_TOKEN: Design system / theme-level changes

Each mode uses a different context representation to minimize token usage
while preserving the information the LLM needs.
"""

import os
import re
import json
import logging
from concurrent.futures import ThreadPoolExecutor, Future
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)


# Per-call usage log. Each entry: {label, model, input_tokens, output_tokens,
# reasoning_tokens, elapsed_sec}. The agentic experiment reads and clears this
# after each routing decision so it can record CARE cost per iter.
_ROUTER_USAGE_LOG: list = []


def _record_router_usage(response, model: str, label: str, elapsed_sec: float) -> None:
    """Append OpenAI chat.completions usage info to the router log."""
    try:
        u = getattr(response, "usage", None)
        inp = getattr(u, "prompt_tokens", 0) or 0 if u else 0
        out = getattr(u, "completion_tokens", 0) or 0 if u else 0
        det = getattr(u, "completion_tokens_details", None) if u else None
        reasoning = (getattr(det, "reasoning_tokens", 0) or 0) if det else 0
        _ROUTER_USAGE_LOG.append({
            "label": label, "model": model,
            "input_tokens": inp, "output_tokens": out,
            "reasoning_tokens": reasoning, "elapsed_sec": elapsed_sec,
        })
    except Exception as e:
        logger.warning(f"[CARE-USAGE] tracking failed: {e}")


def take_router_usage_log() -> list:
    """Return + clear the per-call usage log. Caller takes ownership of the list."""
    global _ROUTER_USAGE_LOG
    out = _ROUTER_USAGE_LOG
    _ROUTER_USAGE_LOG = []
    return out


class RoutingMode(str, Enum):
    MICRO_SPATIAL = "micro_spatial"
    MACRO_PROGRAMMATIC = "macro_programmatic"
    SYSTEMIC_TOKEN = "systemic_token"
    FULL = "full"


@dataclass
class RoutingDecision:
    mode: RoutingMode
    target_slide_indices: List[int]  # 0-based
    reason: str
    confidence: float  # 0.0 – 1.0
    edit_type_hint: Optional[str] = None
    needs_image: bool = True  # Whether slide images should be included in context


@dataclass
class PresentationSummary:
    """Lightweight metadata loaded from meta.json."""
    slide_count: int
    slides: List[Dict[str, Any]]
    file_name: str = ""


# ---------------------------------------------------------------------------
# Pattern banks
# ---------------------------------------------------------------------------

GLOBAL_SCOPE_PATTERNS = [
    r"(?:entire|whole|all|every)\s+(?:the\s+)?presentation",
    r"throughout\s+(?:the\s+)?presentation",
    r"(?:all|every)\s+slides?",
    r"\bthroughout\b",
    r"across\s+(?:all|the)\s+(?:slides|presentation|deck)",
    r"(?:each|every)\s+slide",
    r"(?:on\s+)?all\s+(?:of\s+the\s+)?slides",
]

MACRO_KEYWORDS = [
    # Batch text operations
    r"translat\w+",
    r"\bproofread\b",
    r"\bspelling\b",
    r"replace\s+(?:all|every)",
    r"change\s+(?:all|every)",
    r"all\s+instances",
    r"find\s+and\s+replace",
    r"\bbatch\b",
    r"search\s+and\s+replace",
    # Batch formatting
    r"(?:italicize|bold|underline)\s+(?:all|every)",
    r"(?:font|text)\s+(?:size|family|style)\s+(?:across|throughout)",
    r"\btitle\s+case\b",
    r"\bcapitalize\b",
    # Global additions
    r"(?:add|insert)\s+(?:a\s+)?(?:watermark|footer|header|slide\s+number)\s+(?:to\s+)?(?:every|all|each)",
    # Summarize / rewrite all
    r"summarize\s+(?:the\s+)?(?:large|main|body)",
]

SYSTEMIC_KEYWORDS = [
    r"(?:color|colour)\s+scheme",
    r"\btheme\b",
    r"brand\s+colou?r",
    r"(?:flip|switch|change|apply|update)\s+(?:the\s+)?(?:theme|scheme)",
    r"(?:primary|accent|background|secondary)\s+colou?r",
    r"design\s+(?:system|tokens?)",
    r"\bpalette\b",
    r"(?:dark|light)\s+mode",
    r"replace\s+(?:all\s+)?(?:the\s+)?colou?r",
    r"colou?r\s+(?:of\s+)?(?:all|every|the\s+entire)",
]

MICRO_SPATIAL_KEYWORDS = [
    r"(?:add|create|insert|place|draw)\s+(?:a\s+)?(?:chart|table|shape|rectangle|text|frame|image|picture|graphic|diagram|box|arrow|line|circle|ellipse|icon|logo)",
    r"(?:\bmove\b|\bresize\b|\balign\b|\barrange\b|\breposition\b|\bcrop\b|\brotate\b|\bscale\b|\bstretch\b|\bshrink\b)",
    r"(?:layout|autolayout|auto[\s-]?layout)",
    r"(?:z[\s-]?order|bring\s+to\s+front|send\s+to\s+back|bring\s+forward|send\s+backward)",
    r"(?:delete|remove)\s+(?:the|a|this)",
    r"font\s+size\s+(?:on|in|of)\s+slide",
    r"(?:sort|reorder)\s+(?:the\s+)?(?:rows?|columns?|table|items?)",
    r"(?:border|shadow|corner\s+radius|rounded)",
    r"(?:overlap|overlapping|reposition|readjust)",
]

# Patterns indicating whole-presentation structural changes.
# These ALWAYS route to MACRO_PROGRAMMATIC regardless of target slide count,
# because the LLM needs to see all slides to reason about structure.
STRUCTURAL_KEYWORDS = [
    # Slide reordering
    r"(?:wrong|incorrect|mixed[\s.-]?up)\s+order",
    r"slides?\s+(?:are\s+)?(?:in\s+)?(?:the\s+)?wrong\s+order",
    r"(?:reorder|rearrange|reorganize|restructure)\s+(?:the\s+)?(?:slides?|presentation|deck)",
    r"(?:fix|correct|change)\s+(?:the\s+)?(?:slide\s+)?order",
    r"flows?\s+logically",
    r"logical\s+(?:flow|order|sequence)",
    # Slide deletion/merging based on content
    r"(?:delete|remove)\s+(?:slides?|pages?)\s+(?:that|which|not|if)",
    r"(?:merge|combine|consolidate)\s+(?:slides?|sections?)",
    r"(?:split|separate)\s+(?:the\s+)?slide",
    # Agenda / TOC alignment
    r"agenda\s+(?:list\s+)?match",
    r"match(?:es)?\s+(?:the\s+)?(?:new\s+)?(?:slide\s+)?order",
    r"(?:table\s+of\s+contents|agenda|toc)\s+(?:is\s+)?(?:wrong|incorrect|mixed|outdated)",
]

# Patterns where images are NOT needed (text/data-only operations)
NO_IMAGE_PATTERNS = [
    r"translat\w+",
    r"\bproofread\b",
    r"\bspelling\b",
    r"replace\s+(?:all|every)",
    r"find\s+and\s+replace",
    r"search\s+and\s+replace",
    r"change\s+(?:all|every)\s+(?:instances?|occurrences?)",
    r"(?:change|replace|update|switch)\s+(?:the\s+)?(?:font|typeface)",
    r"\btitle\s+case\b",
    r"\bcapitalize\b",
    r"\bbold\s+(?:all|every)\b",
    r"\bitalicize\s+(?:all|every)\b",
    r"\bunderline\s+(?:all|every)\b",
    r"(?:color|colour)\s+scheme",
    r"\btheme\b",
    r"\bpalette\b",
    r"(?:dark|light)\s+mode",
    r"brand\s+colou?r",
    r"(?:update|change|modify)\s+(?:the\s+)?(?:text|data|content|number|value|statistic)",
    r"(?:add|insert)\s+(?:a\s+)?(?:footer|header|slide\s+number|watermark)\s+(?:to\s+)?(?:every|all|each)",
]

# Patterns where images ARE needed (visual/spatial operations)
IMAGE_NEEDED_PATTERNS = [
    r"(?:add|create|insert|place|draw)\s+(?:a\s+)?(?:chart|table|shape|rectangle|image|picture|graphic|diagram|box|arrow|line|circle|ellipse|icon|logo)",
    r"(?:\bmove\b|\bresize\b|\balign\b|\barrange\b|\breposition\b|\bcrop\b|\brotate\b|\bscale\b|\bstretch\b|\bshrink\b)",
    r"(?:overlap|overlapping)",
    r"(?:layout|autolayout|auto[\s-]?layout)",
    r"(?:z[\s-]?order|bring\s+to\s+front|send\s+to\s+back)",
    r"(?:border|shadow|corner\s+radius|rounded)",
    r"(?:margin|padding|spacing|gap)\s+(?:between|around|of)",
    r"\bposition\b",
    r"\bcoordinat",
    r"(?:left|right|top|bottom|center|middle)\s+(?:of|align|side)",
]


def _infer_needs_image(instruction: str) -> bool:
    """Heuristic: determine if the instruction needs slide images."""
    text = instruction.lower()

    has_image_needed = any(re.search(p, text) for p in IMAGE_NEEDED_PATTERNS)
    has_no_image = any(re.search(p, text) for p in NO_IMAGE_PATTERNS)

    # If specific slides are mentioned, the instruction likely references
    # visual context on those slides (e.g. "bold the text below the charts
    # on slides 6, 7, and 9") — always provide images in that case.
    has_specific_slides = bool(re.search(
        r"(?:on|in)\s+slides?\s+\d", text
    ))
    if has_specific_slides:
        return True

    if has_image_needed and not has_no_image:
        return True
    if has_no_image and not has_image_needed:
        return False
    # Both or neither matched — default to True (safer)
    return True


# ---------------------------------------------------------------------------
# Slide number extraction
# ---------------------------------------------------------------------------

def extract_slide_numbers(instruction: str, total_slides: int) -> List[int]:
    """
    Extract 0-based slide indices from an instruction string.
    Handles: "slide 5", "slides 2 through 6", "slides 3, 5, 7",
             "the first slide", "the last slide", etc.
    """
    text = instruction.lower()
    found: set[int] = set()

    # Range: "slides 2 through 6" / "slides 2-6" / "slides 2 to 6"
    for m in re.finditer(
        r"slides?\s+(\d+)\s*(?:through|to|-|~)\s*(\d+)", text
    ):
        start, end = int(m.group(1)), int(m.group(2))
        for i in range(start, end + 1):
            if 1 <= i <= total_slides:
                found.add(i - 1)

    # List: "slides 3, 5, 7" or "slides 3, 5 and 7"
    for m in re.finditer(
        r"slides?\s+((?:\d+\s*(?:,\s*|\s+and\s+))*\d+)", text
    ):
        for n in re.findall(r"\d+", m.group(1)):
            v = int(n)
            if 1 <= v <= total_slides:
                found.add(v - 1)

    # Prepositional: "on slide 5", "in slide 3"
    for m in re.finditer(
        r"(?:on|in|to|from|for|of)\s+slide\s+(\d+)", text
    ):
        v = int(m.group(1))
        if 1 <= v <= total_slides:
            found.add(v - 1)

    # Standalone: "slide 5" (catch remaining)
    for m in re.finditer(r"\bslide\s+(\d+)\b", text):
        v = int(m.group(1))
        if 1 <= v <= total_slides:
            found.add(v - 1)

    # Ordinals
    ordinal_map = {
        "first": 0, "second": 1, "third": 2, "fourth": 3,
        "fifth": 4, "sixth": 5, "seventh": 6, "eighth": 7,
        "ninth": 8, "tenth": 9,
    }
    for word, idx in ordinal_map.items():
        if re.search(rf"\b{word}\s+slide\b", text) and idx < total_slides:
            found.add(idx)

    # Special
    if re.search(r"\b(?:last|final)\s+slide\b", text):
        found.add(total_slides - 1)
    if re.search(r"\btitle\s+slide\b", text):
        found.add(0)

    return sorted(found)


# ---------------------------------------------------------------------------
# Main classifier
# ---------------------------------------------------------------------------

def classify_instruction(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str] = None,
) -> RoutingDecision:
    """
    Classify an instruction into a routing mode using heuristic rules.
    Single-slide presentations are always reclassified to MICRO_SPATIAL.
    """
    decision = _classify_instruction_inner(instruction, summary, edit_type)
    return _maybe_reclassify_single_slide(decision, summary)


def _classify_instruction_inner(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str] = None,
) -> RoutingDecision:
    """
    Decision priority:
      1.  SYSTEMIC keywords + global scope   → SYSTEMIC_TOKEN
      2a. STRUCTURAL keywords (reorder etc.) → MACRO_PROGRAMMATIC (always)
      2b. MACRO keywords + global scope      → MACRO_PROGRAMMATIC
      3.  Specific slides referenced          → MICRO_SPATIAL
      4.  Global but ambiguous                → MACRO_PROGRAMMATIC
      5.  Fallback                            → FULL
    """
    text = instruction.lower()

    target_slides = extract_slide_numbers(text, summary.slide_count)
    is_global = any(re.search(p, text) for p in GLOBAL_SCOPE_PATTERNS)

    has_systemic = any(re.search(p, text) for p in SYSTEMIC_KEYWORDS)
    has_macro = any(re.search(p, text) for p in MACRO_KEYWORDS)
    has_micro = any(re.search(p, text) for p in MICRO_SPATIAL_KEYWORDS)
    has_structural = any(re.search(p, text) for p in STRUCTURAL_KEYWORDS)

    # Use edit_type hint from evaluation pairs when available
    if edit_type:
        if edit_type in ("Theme & Background",):
            has_systemic = True
        if edit_type in ("Text & Typography",) and is_global:
            has_macro = True
        if "Slide" in edit_type and ("Management" in edit_type or "Section" in edit_type):
            has_structural = True

    needs_image = _infer_needs_image(instruction)

    # --- Decision tree ---

    # 1) Systemic
    if has_systemic and (is_global or not target_slides):
        return RoutingDecision(
            mode=RoutingMode.SYSTEMIC_TOKEN,
            target_slide_indices=[],
            reason="Systemic keywords detected with global scope",
            confidence=0.85,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 2a) Structural operations (reorder, merge, delete-by-content) → always MACRO
    #     The LLM needs to see ALL slides to reason about presentation structure.
    if has_structural:
        return RoutingDecision(
            mode=RoutingMode.MACRO_PROGRAMMATIC,
            target_slide_indices=(
                target_slides
                if target_slides
                else list(range(summary.slide_count))
            ),
            reason=f"Structural operation (reorder/merge/delete) — full deck context required",
            confidence=0.90,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 2b) Macro-programmatic
    if has_macro and (is_global or len(target_slides) > 3):
        return RoutingDecision(
            mode=RoutingMode.MACRO_PROGRAMMATIC,
            target_slide_indices=(
                target_slides
                if target_slides
                else list(range(summary.slide_count))
            ),
            reason=f"Macro/batch operation across {'all' if is_global else len(target_slides)} slides",
            confidence=0.80,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 3) Micro-spatial – few specific slides
    if target_slides and len(target_slides) <= 3:
        return RoutingDecision(
            mode=RoutingMode.MICRO_SPATIAL,
            target_slide_indices=target_slides,
            reason=f"Specific slide(s) {[i+1 for i in target_slides]} targeted",
            confidence=0.90,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 4) Micro-spatial – moderate number of specific slides
    if target_slides and len(target_slides) <= 6:
        return RoutingDecision(
            mode=RoutingMode.MICRO_SPATIAL,
            target_slide_indices=target_slides,
            reason=f"Multiple slides {[i+1 for i in target_slides]} targeted",
            confidence=0.70,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 5) Global but no clear macro/systemic pattern
    if is_global or not target_slides:
        if has_micro:
            return RoutingDecision(
                mode=RoutingMode.MACRO_PROGRAMMATIC,
                target_slide_indices=list(range(summary.slide_count)),
                reason="Global spatial operation – using skeleton for overview",
                confidence=0.60,
                edit_type_hint=edit_type,
                needs_image=needs_image,
            )
        return RoutingDecision(
            mode=RoutingMode.MACRO_PROGRAMMATIC,
            target_slide_indices=list(range(summary.slide_count)),
            reason="Global operation, defaulting to macro mode",
            confidence=0.55,
            edit_type_hint=edit_type,
            needs_image=needs_image,
        )

    # 6) Fallback
    return RoutingDecision(
        mode=RoutingMode.FULL,
        target_slide_indices=[],
        reason="Could not confidently classify; using full context",
        confidence=0.30,
        edit_type_hint=edit_type,
        needs_image=needs_image,
    )


def _maybe_reclassify_single_slide(
    decision: RoutingDecision,
    summary: PresentationSummary,
) -> RoutingDecision:
    """If the presentation has only 1 slide and mode is MACRO, reclassify to MICRO."""
    if summary.slide_count == 1 and decision.mode == RoutingMode.MACRO_PROGRAMMATIC:
        return RoutingDecision(
            mode=RoutingMode.MICRO_SPATIAL,
            target_slide_indices=[0],
            reason=f"Reclassified from MACRO→MICRO (single-slide presentation). Original: {decision.reason}",
            confidence=decision.confidence,
            edit_type_hint=decision.edit_type_hint,
            needs_image=decision.needs_image,
        )
    return decision


# ---------------------------------------------------------------------------
# LLM-based router
# ---------------------------------------------------------------------------

_LLM_ROUTER_SYSTEM_PROMPT = """\
You are a routing engine for a Figma Slides editing system.
Given a user instruction and a presentation summary, do TWO things:

## 1. Classify the instruction into EXACTLY ONE mode:

MICRO_SPATIAL
  - The instruction targets specific slide(s) by number or position AND all required information is contained within those slides.
  - Operations: add/edit/move/resize elements on a particular slide, spatial layout changes, single-slide chart/table creation.
  - IMPORTANT: Do NOT use MICRO_SPATIAL if the instruction requires understanding context from OTHER slides that are not explicitly targeted. Examples of cross-slide dependencies:
    * "match the presentation's style/colors/theme" → needs other slides' styles → SYSTEMIC_TOKEN
    * "make it consistent with the rest of the deck" → needs global context → SYSTEMIC_TOKEN or MACRO_PROGRAMMATIC
    * "use the same format as slide 1 on slide 5" → needs slide 1 as reference → include both in target_slides
    * "reformat to fit the overall design" → implicit reference to other slides → SYSTEMIC_TOKEN
  - Example (valid MICRO_SPATIAL): "On slide 5, add a bar chart", "Move the title on the last slide".

MACRO_PROGRAMMATIC
  - The instruction applies an operation across many or all slides, OR performs whole-presentation structural changes that require examining the entire deck.
  - Operations: translate all text, find-and-replace, change font everywhere, proofread, add watermark to every slide, bold all titles, delete/merge/consolidate slides based on content across the presentation, restructure the deck, **reorder slides**, fix slide order, align agenda/TOC with slide order.
  - IMPORTANT: Any instruction involving slide reordering, fixing slide order, or aligning an agenda/table-of-contents with the actual slides is ALWAYS MACRO_PROGRAMMATIC — even if specific slides are mentioned. The LLM needs the full deck skeleton to reason about ordering.
  - Example: "Translate the entire presentation to English", "Replace all texts of xx with yy", "Clean up the presentation by consolidating similar sections", "The slides are in the wrong order — fix the order", "Fix the agenda on slide 1 to match the slide order".

SYSTEMIC_TOKEN
  - The instruction changes design-system-level properties (colors, themes, palettes) globally.
  - Operations: change color scheme, flip theme, apply palette, update brand colors.
  - Example: "Apply a dark mode theme", "Change the accent color to blue across all slides".

## 2. Identify target slides (1-based slide numbers):

Extract ALL slide numbers that appear anywhere in the instruction, regardless of mode.
This includes BOTH slides being modified AND source/reference slides whose content must be understood to complete the task.
- Example: "Change all headings to uppercase. Also, on slides 3 and 8, resize the main image." → target_slides: [3, 8]
- Example: "Translate the entire presentation to Korean." → target_slides: []
- Example: "Apply the layout from slide 1 to slides 2 through 5." → target_slides: [1, 2, 3, 4, 5]  (slide 1 is the source — include it!)
- Example: "Make slide 3 look like slide 1." → target_slides: [1, 3]  (slide 1 is the reference)
- IMPORTANT: Even for MACRO_PROGRAMMATIC, you MUST include slide numbers if any are mentioned in the instruction. These slides need visual context.
- IMPORTANT: If a slide is referenced as a source, template, or example (e.g., "from slide 1", "like slide 3", "based on slide 2", "match slide 1"), you MUST include it — the LLM needs to see the source to understand what to replicate.

## 3. Determine whether the LLM needs slide images to complete the task:

needs_image = true when:
  - The task requires understanding visual layout, positions, or spatial relationships
  - The task involves adding/moving/resizing visual elements (charts, shapes, images)
  - The task references visual properties that can only be understood from images (e.g., "the overlapping elements", "the chart in the corner")
  - The task mentions specific slides by number for visual modifications (e.g., "bold the text below the charts on slides 6, 7, and 9")
  - The task requires subjective judgment about slide content — e.g., comparing, evaluating, selecting, or filtering slides based on quality, relevance, similarity, or fitness. These decisions depend on visual understanding, not just metadata.
  - The task involves structural changes (delete, merge, split, reorder slides) where the REASON for the change depends on understanding what is on the slides, rather than a mechanical rule.

needs_image = false when:
  - The task is purely text-based (translate, proofread, find-and-replace, change font)
  - The task can be fully described by the JSON structure alone (rename, reorder text, change data values)
  - The task involves global style tokens (color scheme, theme) where metadata is sufficient
  - The structural change targets slides by explicit position only, with no content-dependent judgment (e.g., "delete the last slide", "reverse slide order")

A "Heuristic needs_image hint" is provided in the user message. This is a rule-based pre-assessment. Consider it as a reference signal:
  - If the heuristic says true but you believe false, explain why in your reason.
  - If the heuristic says true and you are unsure, prefer true.

Respond with ONLY a JSON object in this exact format (no extra text):
{"mode": "MICRO_SPATIAL" | "MACRO_PROGRAMMATIC" | "SYSTEMIC_TOKEN", "target_slides": [1, 5, 9], "needs_image": true | false, "reason": "<one sentence>"}
"""


def classify_instruction_llm(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str] = None,
    api_key: Optional[str] = None,
    model: str = "gpt-4.1-mini",
) -> RoutingDecision:
    """
    Use a lightweight LLM to classify the instruction into a routing mode.
    Falls back to heuristic classification on any error.
    """
    try:
        import openai
    except ImportError:
        logger.warning("[CARE-LLM] openai package not installed, falling back to heuristic")
        return classify_instruction(instruction, summary, edit_type)

    key = api_key or os.environ.get("OPENAI_API_KEY")
    if not key:
        logger.warning("[CARE-LLM] OPENAI_API_KEY not set, falling back to heuristic")
        return classify_instruction(instruction, summary, edit_type)

    # Build a lightweight presentation summary for the LLM
    slide_names = [
        s.get("name", str(i + 1)) for i, s in enumerate(summary.slides)
    ]
    heuristic_needs_image = _infer_needs_image(instruction)
    user_prompt = (
        f"--- User Instruction ---\n{instruction}\n\n"
        f"--- Presentation Summary ---\n"
        f"Slide count: {summary.slide_count}\n"
        f"Slide names: {slide_names}\n"
    )
    if edit_type:
        user_prompt += f"Edit type hint: {edit_type}\n"
    user_prompt += f"Heuristic needs_image hint: {heuristic_needs_image}\n"

    try:
        import time as _t
        client = openai.OpenAI(api_key=key)
        _t0 = _t.time()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _LLM_ROUTER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0,
            max_tokens=150,
        )
        _record_router_usage(response, model, "classify_llm", _t.time() - _t0)
        raw = response.choices[0].message.content.strip()
        logger.info(f"[CARE-LLM] Raw response: {raw}")

        # Parse JSON response
        result = json.loads(raw)
        mode_str = result.get("mode", "").upper()
        reason = result.get("reason", "LLM decision")
        needs_image = result.get("needs_image", True)  # default to True for safety

        mode_map = {
            "MICRO_SPATIAL": RoutingMode.MICRO_SPATIAL,
            "MACRO_PROGRAMMATIC": RoutingMode.MACRO_PROGRAMMATIC,
            "SYSTEMIC_TOKEN": RoutingMode.SYSTEMIC_TOKEN,
        }
        mode = mode_map.get(mode_str)
        if mode is None:
            logger.warning(f"[CARE-LLM] Unexpected mode '{mode_str}', falling back to heuristic")
            return classify_instruction(instruction, summary, edit_type)

        # Extract target slides from LLM response (1-based → 0-based)
        llm_targets = result.get("target_slides", [])
        target_slides = [
            int(s) - 1 for s in llm_targets
            if isinstance(s, (int, float)) and 1 <= int(s) <= summary.slide_count
        ] if isinstance(llm_targets, list) else []

        logger.info(
            f"[CARE-LLM] needs_image={needs_image}, "
            f"target_slides(1-indexed)={[i+1 for i in target_slides]}"
        )

        decision = RoutingDecision(
            mode=mode,
            target_slide_indices=target_slides,
            reason=f"[LLM] {reason}",
            confidence=0.95,
            edit_type_hint=edit_type,
            needs_image=bool(needs_image),
        )
        return _maybe_reclassify_single_slide(decision, summary)

    except Exception as e:
        logger.warning(f"[CARE-LLM] LLM router failed ({e}), falling back to heuristic")
        return classify_instruction(instruction, summary, edit_type)


# ---------------------------------------------------------------------------
# Hybrid router: heuristic first, LLM for low-confidence cases
# ---------------------------------------------------------------------------

def classify_instruction_hybrid(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str] = None,
    confidence_threshold: float = 0.70,
    api_key: Optional[str] = None,
    llm_model: str = "gpt-4.1-mini",
) -> RoutingDecision:
    """
    Two-stage router:
      1. Run heuristic classifier first.
      2. If confidence < threshold, escalate to LLM for a second opinion.
    """
    heuristic = classify_instruction(instruction, summary, edit_type)

    if heuristic.confidence >= confidence_threshold:
        return heuristic

    logger.info(
        f"[CARE-HYBRID] Heuristic confidence {heuristic.confidence:.2f} "
        f"< {confidence_threshold:.2f}, escalating to LLM"
    )
    llm_decision = classify_instruction_llm(
        instruction, summary, edit_type,
        api_key=api_key, model=llm_model,
    )
    # Tag the reason to show it was a hybrid decision
    llm_decision.reason = (
        f"{llm_decision.reason} "
        f"(heuristic was {heuristic.mode.value}@{heuristic.confidence:.2f})"
    )
    return llm_decision


# ---------------------------------------------------------------------------
# Dual-LLM router: independent mode + needs_image predictions
# ---------------------------------------------------------------------------

_MODE_LLM_SYSTEM_PROMPT = """\
You are a routing engine for a Figma Slides editing system.
Given a user instruction and a presentation summary, classify the instruction into EXACTLY ONE mode and extract target slides.

## Mode Classification

MICRO_SPATIAL
  - The instruction targets specific slide(s) by number or position AND all required information is contained within those slides.
  - Operations: add/edit/move/resize elements on a particular slide, spatial layout changes, single-slide chart/table creation.
  - IMPORTANT: Do NOT use MICRO_SPATIAL if the instruction requires understanding context from OTHER slides that are not explicitly targeted. Examples of cross-slide dependencies:
    * "match the presentation's style/colors/theme" → needs other slides' styles → SYSTEMIC_TOKEN
    * "make it consistent with the rest of the deck" → needs global context → SYSTEMIC_TOKEN or MACRO_PROGRAMMATIC
    * "use the same format as slide 1 on slide 5" → needs slide 1 as reference → include both in target_slides
    * "reformat to fit the overall design" → implicit reference to other slides → SYSTEMIC_TOKEN
  - Example (valid MICRO_SPATIAL): "On slide 5, add a bar chart", "Move the title on the last slide".

MACRO_PROGRAMMATIC
  - The instruction applies an operation across many or all slides, OR performs whole-presentation structural changes.
  - Operations: translate all text, find-and-replace, change font everywhere, proofread, add watermark to every slide, 
    bold all titles, delete/merge/consolidate slides, reorder slides, fix slide order.
  - IMPORTANT: Any instruction involving slide reordering, fixing slide order, or aligning an agenda/TOC with the actual 
    slides is ALWAYS MACRO_PROGRAMMATIC.
  - Example: "Translate the entire presentation to English", "The slides are in the wrong order — fix the order".

SYSTEMIC_TOKEN
  - The instruction changes design-system-level properties (colors, themes, palettes) globally.
  - Operations: change color scheme, flip theme, apply palette, update brand colors.
  - Example: "Apply a dark mode theme", "Change the accent color to blue across all slides".

## Target Slides (1-based)

Extract ALL slide numbers mentioned in the instruction, regardless of mode.
This includes BOTH slides being modified AND source/reference slides whose content must be understood.
- "Change all headings. Also, on slides 3 and 8, resize the image." → target_slides: [3, 8]
- "Translate the entire presentation to Korean." → target_slides: []
- "Apply the layout from slide 1 to slides 2 through 5." → target_slides: [1, 2, 3, 4, 5]  (slide 1 is the source — include it!)
- "Make slide 3 look like slide 1." → target_slides: [1, 3]
- IMPORTANT: If a slide is referenced as a source, template, or example (e.g., "from slide 1", "like slide 3", 
            "based on slide 2"), you MUST include it.

Respond with ONLY a JSON object (no extra text):
{"mode": "MICRO_SPATIAL" | "MACRO_PROGRAMMATIC" | "SYSTEMIC_TOKEN", "target_slides": [1, 5, 9], "reason": "<one sentence>"}
"""

_NEEDS_IMAGE_LLM_SYSTEM_PROMPT = """\
You are a visual-context analyst for a Figma Slides editing system.
Given a user instruction and a presentation summary, determine whether the LLM executing this task needs slide images 
(screenshots) to complete it, or whether the structured JSON data alone is sufficient.

## needs_image = true when:
- The task requires understanding visual layout, positions, or spatial relationships between elements
- The task involves adding/moving/resizing visual elements (charts, shapes, images) where placement matters
- The task references visual properties only understandable from images (e.g., "the overlapping elements",
    "the chart in the corner")
- The task requires subjective judgment about slide content — e.g., comparing, evaluating, or filtering slides 
        based on quality or relevance
- The task involves structural changes (delete, merge, reorder) where the decision depends on understanding visual content

## needs_image = false when:
- The task is purely a text property change (translate, proofread, find-and-replace, change font, 
    change text alignment like center/left/right-align text)
- The task can be fully described by the JSON structure alone (rename, change data values, set text alignment properties)
- The task involves global style tokens (color scheme, theme) where metadata is sufficient
- The structural change targets slides by explicit position only, with no content-dependent judgment (e.g., "delete the last slide")
- The task is a batch formatting operation identifiable by node names/types in JSON (e.g., "center the text in all title placeholders" 
    — title placeholders are identifiable by name in JSON, and centering is a textAlignHorizontal property change)

## IMPORTANT distinctions:
- "Align text" (text alignment property like center/left/right) → needs_image = false (this is a text property change, not spatial)
- "Align elements" (spatial positioning of shapes/frames on canvas) → needs_image = true (requires visual context)
- "Center the text" → needs_image = false (textAlignHorizontal property)
- "Center the box on the slide" → needs_image = true (spatial positioning)

Respond with ONLY a JSON object (no extra text):
{"needs_image": true | false, "reason": "<one sentence>"}
"""


def _call_mode_llm(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str],
    api_key: Optional[str],
    model: str,
) -> Dict[str, Any]:
    """LLM call #1: classify mode + target_slides."""
    import openai

    slide_names = [
        s.get("name", str(i + 1)) for i, s in enumerate(summary.slides)
    ]
    user_prompt = (
        f"--- User Instruction ---\n{instruction}\n\n"
        f"--- Presentation Summary ---\n"
        f"Slide count: {summary.slide_count}\n"
        f"Slide names: {slide_names}\n"
    )
    if edit_type:
        user_prompt += f"Edit type hint: {edit_type}\n"

    import time as _t
    client = openai.OpenAI(api_key=api_key)
    _t0 = _t.time()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _MODE_LLM_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0,
        max_tokens=150,
    )
    _record_router_usage(response, model, "dual_mode", _t.time() - _t0)
    raw = response.choices[0].message.content.strip()
    logger.info(f"[CARE-DUAL-MODE] Raw response: {raw}")
    return json.loads(raw)


def _call_needs_image_llm(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str],
    api_key: Optional[str],
    model: str,
) -> Dict[str, Any]:
    """LLM call #2: determine needs_image independently."""
    import openai

    slide_names = [
        s.get("name", str(i + 1)) for i, s in enumerate(summary.slides)
    ]
    user_prompt = (
        f"--- User Instruction ---\n{instruction}\n\n"
        f"--- Presentation Summary ---\n"
        f"Slide count: {summary.slide_count}\n"
        f"Slide names: {slide_names}\n"
    )
    if edit_type:
        user_prompt += f"Edit type hint: {edit_type}\n"

    import time as _t
    client = openai.OpenAI(api_key=api_key)
    _t0 = _t.time()
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _NEEDS_IMAGE_LLM_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.0,
        max_tokens=100,
    )
    _record_router_usage(response, model, "dual_needs_image", _t.time() - _t0)
    raw = response.choices[0].message.content.strip()
    logger.info(f"[CARE-DUAL-IMAGE] Raw response: {raw}")
    return json.loads(raw)


def classify_instruction_dual_llm(
    instruction: str,
    summary: PresentationSummary,
    edit_type: Optional[str] = None,
    api_key: Optional[str] = None,
    llm_model: str = "gpt-4.1-mini",
) -> RoutingDecision:
    """
    Dual-LLM router: two independent, parallel LLM calls.
      - Call 1: classify mode + target_slides
      - Call 2: determine needs_image
    Falls back to heuristic per-field on individual failures.
    """
    try:
        import openai  # noqa: F401
    except ImportError:
        logger.warning("[CARE-DUAL] openai not installed, falling back to heuristic")
        return classify_instruction(instruction, summary, edit_type)

    key = api_key or os.environ.get("OPENAI_API_KEY")
    if not key:
        logger.warning("[CARE-DUAL] OPENAI_API_KEY not set, falling back to heuristic")
        return classify_instruction(instruction, summary, edit_type)

    heuristic = classify_instruction(instruction, summary, edit_type)

    # Launch both LLM calls in parallel
    with ThreadPoolExecutor(max_workers=2) as executor:
        mode_future: Future = executor.submit(
            _call_mode_llm, instruction, summary, edit_type, key, llm_model,
        )
        image_future: Future = executor.submit(
            _call_needs_image_llm, instruction, summary, edit_type, key, llm_model,
        )

    # --- Parse mode result ---
    mode = heuristic.mode
    target_slides = heuristic.target_slide_indices
    mode_reason = heuristic.reason

    try:
        mode_result = mode_future.result()
        mode_str = mode_result.get("mode", "").upper()
        mode_map = {
            "MICRO_SPATIAL": RoutingMode.MICRO_SPATIAL,
            "MACRO_PROGRAMMATIC": RoutingMode.MACRO_PROGRAMMATIC,
            "SYSTEMIC_TOKEN": RoutingMode.SYSTEMIC_TOKEN,
        }
        parsed_mode = mode_map.get(mode_str)
        if parsed_mode is not None:
            mode = parsed_mode
            mode_reason = f"[LLM-mode] {mode_result.get('reason', '')}"
            llm_targets = mode_result.get("target_slides", [])
            if isinstance(llm_targets, list):
                target_slides = [
                    int(s) - 1 for s in llm_targets
                    if isinstance(s, (int, float)) and 1 <= int(s) <= summary.slide_count
                ]
        else:
            logger.warning(f"[CARE-DUAL] Unexpected mode '{mode_str}', using heuristic mode")
    except Exception as e:
        logger.warning(f"[CARE-DUAL] Mode LLM failed ({e}), using heuristic mode")

    # --- Parse needs_image result ---
    needs_image = heuristic.needs_image
    image_reason = ""

    try:
        image_result = image_future.result()
        needs_image = bool(image_result.get("needs_image", True))
        image_reason = f"[LLM-image] {image_result.get('reason', '')}"
    except Exception as e:
        logger.warning(f"[CARE-DUAL] NeedsImage LLM failed ({e}), using heuristic")

    # Combine reasons
    reason = mode_reason
    if image_reason:
        reason = f"{mode_reason} | {image_reason}"

    decision = RoutingDecision(
        mode=mode,
        target_slide_indices=target_slides,
        reason=reason,
        confidence=0.95,
        edit_type_hint=edit_type,
        needs_image=needs_image,
    )
    return _maybe_reclassify_single_slide(decision, summary)
