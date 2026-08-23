import json
import re
import asyncio
import aiohttp
import argparse
import base64
import io
import math
from pathlib import Path
import tiktoken
from PIL import Image
from dotenv import load_dotenv
from .base_runner import BaseExperiment, ExperimentConfig, parse_common_args
from .care_router import (
    RoutingMode,
    RoutingDecision,
    PresentationSummary,
    classify_instruction,
    classify_instruction_llm,
    classify_instruction_hybrid,
    classify_instruction_dual_llm,
)
from .care_context import (
    _strip_document_absolute_bbox,
    extract_skeleton_json,
    extract_style_metadata,
    build_micro_spatial_context,
    select_images_for_mode,
)

load_dotenv(Path(__file__).resolve().parents[2] / "config.env")


class FigmaSlideExperiment(BaseExperiment):
    def __init__(self, config: ExperimentConfig):
        super().__init__(config)
        self.project_root = Path(__file__).resolve().parents[2]
        eval_file = getattr(config, "eval_file", None)
        if eval_file:
            eval_pairs_path = Path(eval_file).resolve()
        else:
            eval_pairs_path = self.project_root / "evaluation_pairs_figma.json"
        with open(eval_pairs_path, "r", encoding="utf-8") as f:
            self.evaluation_pairs = json.load(f)
        # CARE routing mode: "auto" | "llm" | "hybrid" | "micro" | "macro" | "systemic" | "full" | "off"
        self.routing_mode = getattr(config, "routing", "auto")

    # ---- CARE helpers ----

    @staticmethod
    def _load_presentation_summary(data_dir: Path) -> PresentationSummary:
        """Load meta.json to get lightweight slide metadata."""
        meta_path = data_dir / "meta.json"
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return PresentationSummary(
            slide_count=meta["slide_count"],
            slides=meta.get("slides", []),
            file_name=meta.get("file_name", ""),
        )

    @staticmethod
    def _load_image_data(data_dir: Path) -> dict:
        """Load pre-downloaded image fills as base64 from data_dir/images/.

        Files may have a .png extension but actually contain JPEG data.
        To guarantee Figma plugin compatibility, we re-encode every image
        as a standard (non-progressive) PNG via Pillow before base64-encoding.
        """
        from PIL import Image as PILImage
        import io

        images_dir = data_dir / "images"
        if not images_dir.is_dir():
            return {}
        image_data = {}
        for img_file in images_dir.glob("*.png"):
            ref = img_file.stem  # filename without extension = imageRef
            raw = img_file.read_bytes()
            # Check if the file is actually a JPEG (magic bytes FF D8 FF)
            if raw[:3] == b'\xff\xd8\xff':
                # Convert JPEG → standard PNG for Figma compatibility
                pil_img = PILImage.open(io.BytesIO(raw))
                # PNG cannot encode CMYK / certain modes — convert to a PNG-safe mode
                if pil_img.mode not in ("1", "L", "P", "RGB", "RGBA"):
                    pil_img = pil_img.convert("RGBA" if "A" in pil_img.mode else "RGB")
                buf = io.BytesIO()
                pil_img.save(buf, format="PNG")
                raw = buf.getvalue()
            image_data[ref] = base64.b64encode(raw).decode("ascii")
        return image_data

    def _prepare_context(
        self,
        decision: RoutingDecision,
        base_json_string: str,
        data_dir: Path,
        summary: PresentationSummary,
    ) -> str:
        """Build a reduced contextJson string based on routing mode."""
        if decision.mode == RoutingMode.MICRO_SPATIAL:
            ctx = build_micro_spatial_context(
                data_dir, decision.target_slide_indices, summary
            )
            return json.dumps(ctx)

        if decision.mode == RoutingMode.MACRO_PROGRAMMATIC:
            full_doc = json.loads(base_json_string)
            skeleton = extract_skeleton_json(
                full_doc,
                target_slide_indices=decision.target_slide_indices,
            )
            return json.dumps(skeleton)

        if decision.mode == RoutingMode.SYSTEMIC_TOKEN:
            full_doc = json.loads(base_json_string)
            style_meta = extract_style_metadata(full_doc)
            return json.dumps(style_meta)

        # FULL – strip absoluteBoundingBox to prevent model confusion
        full_doc = json.loads(base_json_string)
        _strip_document_absolute_bbox(full_doc)
        return json.dumps(full_doc)

    def _resolve_routing(
        self, prompt: str, summary: PresentationSummary, edit_type: str | None,
    ) -> RoutingDecision:
        """Determine the routing mode based on config and instruction."""
        mode_map = {
            "micro": RoutingMode.MICRO_SPATIAL,
            "macro": RoutingMode.MACRO_PROGRAMMATIC,
            "systemic": RoutingMode.SYSTEMIC_TOKEN,
            "full": RoutingMode.FULL,
        }
        if self.routing_mode in mode_map:
            forced = mode_map[self.routing_mode]
            if forced == RoutingMode.MICRO_SPATIAL:
                from .care_router import extract_slide_numbers
                targets = extract_slide_numbers(prompt.lower(), summary.slide_count)
                if not targets:
                    targets = list(range(min(3, summary.slide_count)))
            elif forced == RoutingMode.FULL:
                targets = []
            else:
                targets = list(range(summary.slide_count))
            return RoutingDecision(
                mode=forced,
                target_slide_indices=targets,
                reason=f"Forced mode via --routing {self.routing_mode}",
                confidence=1.0,
                edit_type_hint=edit_type,
            )
        # "llm" – use LLM-only classifier
        if self.routing_mode == "llm":
            return classify_instruction_llm(prompt, summary, edit_type)
        # "dual_llm" – independent parallel LLM calls for mode and needs_image
        if self.routing_mode == "dual_llm":
            return classify_instruction_dual_llm(prompt, summary, edit_type)
        # "hybrid" – heuristic first, LLM fallback for low confidence
        if self.routing_mode == "hybrid":
            return classify_instruction_hybrid(prompt, summary, edit_type)
        # "auto" – use heuristic classifier
        return classify_instruction(prompt, summary, edit_type)

    @staticmethod
    def _create_composite_image(
        frame_paths: list, max_long_edge: int = 2048
    ) -> bytes:
        """Combine multiple slide images into a grid composite PNG.

        Each slide cell is uniformly resized so that the composite's
        longest edge does not exceed *max_long_edge* pixels.
        """
        images = [Image.open(p) for p in frame_paths]
        n = len(images)
        if n == 0:
            return b""
        cols = math.ceil(math.sqrt(n))
        rows = math.ceil(n / cols)
        cell_w = max(img.width for img in images)
        cell_h = max(img.height for img in images)
        total_w = cols * cell_w
        total_h = rows * cell_h

        # Downscale cells so the composite fits within max_long_edge
        scale = min(1.0, max_long_edge / max(total_w, total_h))
        if scale < 1.0:
            cell_w = int(cell_w * scale)
            cell_h = int(cell_h * scale)
            images = [
                img.resize((cell_w, cell_h), Image.LANCZOS) for img in images
            ]

        composite = Image.new(
            "RGB", (cols * cell_w, rows * cell_h), (255, 255, 255)
        )
        for idx, img in enumerate(images):
            r, c = divmod(idx, cols)
            composite.paste(img, (c * cell_w, r * cell_h))
        buf = io.BytesIO()
        composite.save(buf, format="PNG")
        return buf.getvalue()

    async def run(self):
        self.logger.info(
            f"Starting figma-slide experiment with model: {self.config.model.value}"
        )

        cases = self.evaluation_pairs

        # Filter to specific case indices if provided via --cases
        if hasattr(self.config, "cases") and self.config.cases:
            case_indices = set(self.config.cases)
            cases = [c for i, c in enumerate(self.evaluation_pairs) if i in case_indices]
            self.logger.info(f"Filtered to {len(cases)} case(s): {[c['name'] for c in cases]}")

        timeout = aiohttp.ClientTimeout(total=None)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            # Switch channel if configured
            desired_channel = self.channel_config.get("channel_code")
            if desired_channel:
                try:
                    self.logger.info(
                        f"[CHANNEL] Switching to channel {desired_channel}"
                    )
                    async with session.post(
                        f"{self.api_base_url}/tool/select_channel",
                        params={"channel": desired_channel},
                    ) as resp:
                        if resp.status != 200:
                            self.logger.warning(
                                f"Failed to switch channel (HTTP {resp.status})"
                            )
                except Exception as e:
                    self.logger.warning(f"Exception while switching channel: {e}")

            for idx, case in enumerate(cases):
                case_name = case["name"]
                prompt = case["prompt"]
                original_path = case.get("original")
                # ---- From-scratch generation: no original deck ----
                # Cases like "Make slide from text" provide only a prompt + GT;
                # the model starts on an empty canvas and generates from scratch.
                is_from_scratch = not original_path
                original_dir = self.project_root / original_path if original_path else None

                self.logger.info(
                    f"--- [{idx + 1}/{len(cases)}] Processing: {case_name} ---"
                )
                self.logger.info(f"[PROMPT] {prompt}")

                # ---- Early skip: check if result already exists (before routing) ----
                if is_from_scratch:
                    # Derive a stable result_name from the case name
                    # (e.g. "Case 104: MakeSlidefromText" -> "Case_104_MakeSlidefromText")
                    safe = re.sub(r"[^A-Za-z0-9]+", "_", case_name).strip("_")
                    dir_name = safe
                else:
                    dir_name = Path(original_path).name
                result_name = f"{dir_name}-{self.config.model.value}"
                result_dir = self.results_dir / result_name

                if getattr(self.config, "auto", False):
                    raw_response_file = result_dir / f"{result_name}-raw-response.json"
                    if raw_response_file.exists():
                        self.logger.info(
                            f"[AUTO] Result already exists. Skipping (before routing): {result_name}"
                        )
                        continue

                if is_from_scratch:
                    # routing="off" + minimal seed so the agent calls get_all_slides
                    # against a clean canvas (Figma always keeps one default empty
                    # slide), then fills that existing slide. The prepended hint
                    # below stops the agent from creating an extra slide.
                    self.logger.info(
                        "[FROM-SCRATCH] No original deck; will fill the default empty slide"
                    )
                    prompt = (
                        "The Figma Slides canvas currently has exactly one empty slide "
                        "(default 1920x1080). Use that existing slide as your target: "
                        "first call get_all_slides to obtain its ID, then focus_slide "
                        "on it, and add ALL requested content INSIDE that slide. "
                        "Do NOT call create_slide unless the user request explicitly "
                        "requires multiple slides.\n\n"
                        f"User request: {prompt}"
                    )
                    base_json_string = json.dumps({"document": {"children": []}})
                    selected_frames = []
                    composite_bytes = None
                    fill_image_data = None
                    context_json_string = None
                    routing_mode_value = "off"
                    care_target_slide_indices = None
                else:
                    # ---- Validate data directory ----
                    if not original_dir.is_dir():
                        self.logger.warning(
                            f"Original directory not found: {original_dir}. Skipping."
                        )
                        continue

                    frames_dir = original_dir / "frames"

                    if not frames_dir.is_dir():
                        self.logger.warning(
                            f"Frames directory not found: {frames_dir}. Skipping."
                        )
                        continue

                    # ---- Load frame images ----
                    frame_images = sorted(frames_dir.glob("*.png"))
                    if not frame_images:
                        self.logger.warning(
                            f"No frame images found in {frames_dir}. Skipping."
                        )
                        continue

                    # ---- Load full document JSON as page structure ----
                    full_doc_path = original_dir / "full_document.json"
                    if not full_doc_path.exists():
                        self.logger.warning(
                            f"full_document.json not found in {original_dir}. Skipping."
                        )
                        continue
                    with open(full_doc_path, "r", encoding="utf-8") as f:
                        base_json_string = f.read()

                    # ---- CARE: Route instruction and prepare context ----
                    figma_data_dir = original_dir
                    context_json_string = None
                    routing_mode_value = None
                    care_target_slide_indices = None

                    if self.routing_mode == "off":
                        # Off mode: no CARE context, no images — LLM discovers via tools
                        selected_frames = []
                        routing_mode_value = "off"
                        self.logger.info(
                            "[CARE] Off mode — no context or images, LLM will discover canvas via tools"
                        )
                    elif self.routing_mode != "off":
                        try:
                            summary = self._load_presentation_summary(figma_data_dir)
                            decision = self._resolve_routing(
                                prompt, summary, case.get("edit_type"),
                            )
                            care_target_slide_indices = decision.target_slide_indices if decision.target_slide_indices else None
                            self.logger.info(
                                f"[CARE] Mode: {decision.mode.value}, "
                                f"Targets: {[i+1 for i in decision.target_slide_indices]}, "
                                f"NeedsImage: {decision.needs_image}, "
                                f"Reason: {decision.reason}, "
                                f"Confidence: {decision.confidence:.2f}"
                            )

                            context_json_string = self._prepare_context(
                                decision, base_json_string, figma_data_dir, summary,
                            )
                            routing_mode_value = decision.mode.value

                            ctx_size = len(context_json_string)
                            full_size = len(base_json_string)
                            enc = tiktoken.get_encoding("cl100k_base")
                            ctx_tokens = len(enc.encode(context_json_string))
                            full_tokens = len(enc.encode(base_json_string))
                            self.logger.info(
                                f"[CARE] Context: {ctx_size:,} bytes ({ctx_tokens:,} tokens) "
                                f"(from {full_size:,} bytes / {full_tokens:,} tokens, "
                                f"{(1 - ctx_size / full_size) * 100:.1f}% reduction)"
                            )

                            # Select images for this mode
                            selected_frames = select_images_for_mode(
                                frames_dir, decision, summary,
                            )
                            selected_names = [p.stem for p in selected_frames]
                            self.logger.info(
                                f"[CARE] Images: {len(selected_frames)} of "
                                f"{len(frame_images)} slides → {selected_names}"
                            )
                        except Exception as e:
                            self.logger.warning(
                                f"[CARE] Routing failed, falling back to FULL: {e}"
                            )
                            selected_frames = frame_images

                    # ---- Create composite image (or skip if no images needed) ----
                    if selected_frames:
                        composite_bytes = self._create_composite_image(selected_frames)
                        self.logger.info(
                            f"Created composite image from {len(selected_frames)} frames"
                        )
                    else:
                        composite_bytes = None
                        self.logger.info("[CARE] No images needed — skipping composite")

                    # ---- Load image fill data (pre-downloaded PNGs) ----
                    fill_image_data = self._load_image_data(original_dir)
                if fill_image_data:
                    self.logger.info(
                        f"Loaded {len(fill_image_data)} image fill(s) from images/"
                    )

                # ---- Per-case log file ----
                case_log = self.logger.add_case_log(result_dir)
                self.logger.info(f"[START] Generating result for: {result_name}")
                self.logger.info(f"[LOG] Case log: {case_log}")

                # ---- Pre-case canvas cleanup ----
                try:
                    await self.ensure_canvas_empty(session)
                except RuntimeError:
                    self.logger.error(
                        f"[CLEANUP] Pre-case canvas cleanup failed for {result_name}. "
                        "Skipping case to avoid dirty canvas state."
                    )
                    self.logger.remove_case_log()
                    continue

                # ---- Auto mode ----
                if getattr(self.config, "auto", False):
                    lock_path = self._acquire_lock(result_name)
                    if lock_path is None:
                        self.logger.info(
                            f"[AUTO] Another process already working on {result_name}. Skipping."
                        )
                        self.logger.remove_case_log()
                        continue
                    try:
                        result = await self.run_modification(
                            session,
                            composite_bytes,
                            base_json_string,
                            prompt,
                            result_name,
                            context_json_string=context_json_string,
                            routing_mode=routing_mode_value,
                            image_data=fill_image_data,
                            target_slide_indices=care_target_slide_indices,
                        )

                        if result is None:
                            self.logger.warning(
                                f"[RETRY] First attempt for {result_name} failed. Retrying in 5s..."
                            )
                            await asyncio.sleep(5)
                            result = await self.run_modification(
                                session,
                                composite_bytes,
                                base_json_string,
                                prompt,
                                result_name,
                                context_json_string=context_json_string,
                                routing_mode=routing_mode_value,
                                image_data=fill_image_data,
                            )
                            if result is None:
                                self.logger.error(
                                    f"[SKIP] Task {result_name} failed after 2 attempts. Skipping."
                                )
                                # Cooldown: let Figma plugin finish any in-flight
                                # operations (e.g. import_json that caused -32001 timeout)
                                self.logger.info(
                                    "[COOLDOWN] Waiting 10s for Figma to settle before cleanup..."
                                )
                                await asyncio.sleep(10)
                                try:
                                    await self.ensure_canvas_empty(session)
                                except RuntimeError as e:
                                    self.logger.error(
                                        f"Failed to clean canvas for {result_name}: {e}"
                                    )
                                continue

                        await self.save_results(result, result_name)
                    finally:
                        self._release_lock(lock_path)
                        self.logger.remove_case_log()
                    continue

                # ---- Interactive mode ----
                if result_dir.exists():
                    user_input = (
                        input(
                            f"[SKIP?] Result directory for '{result_name}' already exists. "
                            "Do you want to skip? [y] skip / [n] overwrite / [q] quit > "
                        )
                        .strip()
                        .lower()
                    )
                    if user_input == "y":
                        self.logger.info(
                            f"[SKIP] Skipping already existing result: {result_name}"
                        )
                        self.logger.remove_case_log()
                        continue
                    elif user_input == "q":
                        self.logger.warning("[ABORT] Stopping experiment early.")
                        self.logger.remove_case_log()
                        return
                    elif user_input != "n":
                        print("Invalid input. Please enter y / n / q.")
                        self.logger.remove_case_log()
                        continue

                while True:
                    result = await self.run_modification(
                        session,
                        composite_bytes,
                        base_json_string,
                        prompt,
                        result_name,
                        context_json_string=context_json_string,
                        routing_mode=routing_mode_value,
                        image_data=fill_image_data,
                        target_slide_indices=care_target_slide_indices,
                    )

                    if result is None:
                        # Cooldown: let Figma plugin finish any in-flight operations
                        self.logger.info(
                            "[COOLDOWN] Waiting 10s for Figma to settle before cleanup..."
                        )
                        await asyncio.sleep(10)
                        try:
                            await self.ensure_canvas_empty(session)
                        except RuntimeError as e:
                            self.logger.error(
                                f"Failed to clean canvas for {result_name}: {e}"
                            )

                        user_choice = (
                            input(
                                "[ERROR] Generation failed. Retry? [y] retry / [s] skip / [q] quit > "
                            )
                            .strip()
                            .lower()
                        )
                        if user_choice == "y":
                            continue
                        elif user_choice == "s":
                            self.logger.info(
                                f"[SKIP] Skipping failed sample: {result_name}"
                            )
                            break
                        elif user_choice == "q":
                            self.logger.warning(
                                "[ABORT] Stopping experiment early."
                            )
                            self.logger.remove_case_log()
                            return
                        else:
                            print("Invalid input. Please enter y / s / q.")
                            continue

                    user_input = (
                        input(
                            "[REVIEW] Save this result? [y] yes / [n] retry / [q] quit > "
                        )
                        .strip()
                        .lower()
                    )

                    if user_input == "y":
                        await self.save_results(result, result_name)
                        break
                    elif user_input == "n":
                        self.logger.info(f"[RETRY] Retrying {result_name}")
                    elif user_input == "q":
                        self.logger.warning("[ABORT] Stopping experiment early.")
                        self.logger.remove_case_log()
                        return
                    else:
                        print("Invalid input. Please enter y / n / q.")

                self.logger.remove_case_log()

    async def run_modification(
        self,
        session,
        image_bytes,
        base_json_string,
        instruction,
        result_name,
        context_json_string=None,
        routing_mode=None,
        image_data=None,
        target_slide_indices=None,
        skip_import: bool = False,
    ):
        endpoint = "modification"

        base_meta = self.experiment_config["models"][self.config.model.value]
        agent_type = (
            self.config.agent_type.value
            if self.config.agent_type
            else self.experiment_config.get("agent_type", "single_figma_slide")
        )

        def build_metadata():
            override = getattr(self.config, "max_turns_override", None)
            mt = override if override is not None else base_meta.get("max_turns", 6)
            metadata = {
                "case_id": result_name,
                "model_provider": base_meta["provider"],
                "model_name": base_meta["name"],
                "agent_type": agent_type,
                "temperature": base_meta.get("temperature", 0.0),
                "input_cost": base_meta.get("input_cost", 0.0),
                "output_cost": base_meta.get("output_cost", 0.0),
                "max_tokens": base_meta.get("max_tokens", 16384),
                "max_turns": mt,
                "max_calls": base_meta.get("max_calls", 50),
            }
            if base_meta.get("thinking_level"):
                metadata["thinking_level"] = base_meta["thinking_level"]
            return json.dumps(metadata)

        def build_form_data():
            form = aiohttp.FormData()
            if image_bytes is not None:
                form.add_field(
                    "image",
                    image_bytes,
                    filename="composite.png",
                    content_type="image/png",
                )
            else:
                # Force multipart/form-data encoding even without a file,
                # so Express routes through multer (100 MB) instead of the
                # urlencoded body-parser (50 MB).
                form._is_multipart = True
            form.add_field("message", instruction)
            form.add_field("baseJsonString", base_json_string)
            form.add_field("metadata", build_metadata())
            # CARE routing fields
            if context_json_string is not None:
                form.add_field("contextJson", context_json_string)
            if routing_mode is not None:
                form.add_field("routingMode", routing_mode)
            # Image fill data (imageRef → base64 PNG)
            if image_data:
                form.add_field("imageData", json.dumps(image_data))
            # Selective import: only recreate slides at these indices
            if target_slide_indices is not None and len(target_slide_indices) > 0:
                form.add_field("targetSlideIndices", json.dumps(target_slide_indices))
            # Agentic Pattern B: skip baseJsonString import to preserve prior iter state
            if skip_import:
                form.add_field("skipImport", "true")
            return form

        for attempt in range(3):
            try:
                self.logger.info(f"Calling {endpoint} (attempt {attempt + 1}/3)")
                form_data = build_form_data()
                async with session.post(
                    f"{self.api_base_url}/{endpoint}", data=form_data
                ) as res:
                    if res.status != 200:
                        self.logger.error(
                            f"Error from server (HTTP {res.status}): {await res.text()}"
                        )
                        return None
                    return await res.json()
            except Exception as e:
                self.logger.warning(f"Request failed: {e}")
                await asyncio.sleep(2)

        self.logger.error(
            f"[SKIP] Failed to get response after 3 retries for {result_name}"
        )
        return None


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run figma-slide evaluation experiments"
    )
    parser = parse_common_args(parser)
    parser.add_argument(
        "--auto", action="store_true", help="Run in non-interactive auto-save mode"
    )
    parser.add_argument(
        "--cases",
        nargs="+",
        type=int,
        help="Specific case indices to run (0-based). Runs all if not specified.",
    )
    parser.add_argument(
        "--eval-file",
        type=str,
        help="Path to evaluation pairs JSON file (default: evaluation_pairs_figma.json)",
    )
    parser.add_argument(
        "--results-dir",
        type=str,
        help="Override results directory (default: from config YAML)",
    )
    parser.add_argument(
        "--routing",
        choices=["auto", "llm", "dual_llm", "hybrid", "micro", "macro", "systemic", "full", "off"],
        default="auto",
        help=(
            "CARE routing mode: "
            "auto (heuristic only), "
            "llm (LLM-only classification), "
            "dual_llm (independent parallel LLM calls for mode and needs_image), "
            "hybrid (heuristic + LLM fallback for low confidence), "
            "force a specific mode (micro/macro/systemic/full), "
            "or off."
        ),
    )
    parser.add_argument(
        "--max-turns",
        type=int,
        default=None,
        help="Override the agent's max_turns. Use 0 to skip the agent loop entirely "
             "(import + snapshot-0 only — useful for capturing baselines without LLM cost).",
    )
    return parser.parse_args()


async def main():
    args = parse_args()
    config = ExperimentConfig.from_args(args)
    setattr(config, "auto", getattr(args, "auto", False))
    config.cases = getattr(args, "cases", [])
    config.routing = getattr(args, "routing", "auto")
    config.eval_file = getattr(args, "eval_file", None)
    config.results_dir = getattr(args, "results_dir", None)
    config.max_turns_override = getattr(args, "max_turns", None)
    experiment = FigmaSlideExperiment(config)
    await experiment.run()


if __name__ == "__main__":
    asyncio.run(main())
