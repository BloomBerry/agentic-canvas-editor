"""Agentic (self-correcting) variant of the figma-slide experiment.

Inherits FigmaSlideExperiment and wraps the per-case agent invocation in an
iter loop. After each iter the IF judge is called inline (no subprocess);
if the score is below threshold, the judge's reasoning is converted to
feedback and a new iter is launched WITHOUT cleaning the canvas. The figma
plugin's snapshot mechanism therefore naturally yields Pattern B
(continue from the previous iter's state).

Auto mode only.

Usage:
  cd src/ && python -m experiments.run_figma_slide_agentic_mcp_experiment \\
      --model claude-sonnet-4-6 --channel channel_1 \\
      --config-name single-figma-slide --routing dual_llm \\
      --eval-file ../figma_bench_eval.json --cases 11 --auto \\
      --max-iter 3 --threshold 4.0 --feedback-mode llm_distill
"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

import aiohttp
import tiktoken

from .base_runner import ExperimentConfig
from .run_figma_slide_mcp_experiment import FigmaSlideExperiment, parse_args as base_parse_args
from .care_context import select_images_for_mode

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))  # allow `import evaluate_figma_results`

DISTILL_MODEL = "gpt-5.1-mini"   # same as dual_llm router
JUDGE_MODEL = "gpt-5.5"

# Per-1M-token pricing (USD). Rough estimates for non-evaluator models;
# evaluator uses its own constants (see evaluate_figma_results._USD_PER_1M_*).
_PRICING = {
    # OpenAI
    "gpt-5.1-mini": {"input": 0.40, "output": 1.60},   # rough; update if known
    "gpt-5.5":      {"input": 1.25, "output": 10.00},  # matches evaluator
    # Anthropic
    "claude-sonnet-4-6": {
        "input": 3.0, "output": 15.0,
        "cache_read": 0.30, "cache_create_5m": 3.75, "cache_create_1h": 6.0,
    },
}


def _price_openai(model: str, inp: int, out: int) -> float:
    p = _PRICING.get(model, {"input": 1.0, "output": 5.0})
    return inp / 1e6 * p["input"] + out / 1e6 * p["output"]


def _price_anthropic_full(model: str, usage: dict) -> float:
    """Compute Anthropic cost from a usage dict (claude-sonnet-4-6 with cache breakdown)."""
    p = _PRICING.get(model)
    if not p:
        return 0.0
    c = 0.0
    c += (usage.get("input_tokens") or 0) / 1e6 * p["input"]
    c += (usage.get("output_tokens") or 0) / 1e6 * p["output"]
    cc = usage.get("cache_creation") or {}
    c += (cc.get("ephemeral_5m_input_tokens") or 0) / 1e6 * p.get("cache_create_5m", 0)
    c += (cc.get("ephemeral_1h_input_tokens") or 0) / 1e6 * p.get("cache_create_1h", 0)
    c += (usage.get("cache_read_input_tokens") or 0) / 1e6 * p.get("cache_read", 0)
    return c


def _capture_chat_usage(response, model: str, elapsed_sec: float) -> dict:
    """Extract usage from a chat.completions response (used by distill)."""
    try:
        u = getattr(response, "usage", None)
        inp = getattr(u, "prompt_tokens", 0) or 0 if u else 0
        out = getattr(u, "completion_tokens", 0) or 0 if u else 0
        det = getattr(u, "completion_tokens_details", None) if u else None
        reasoning = (getattr(det, "reasoning_tokens", 0) or 0) if det else 0
        return {
            "model": model, "elapsed_sec": round(elapsed_sec, 3),
            "input_tokens": inp, "output_tokens": out,
            "reasoning_tokens": reasoning,
            "cost_usd": round(_price_openai(model, inp, out), 6),
        }
    except Exception:
        return {"model": model, "elapsed_sec": round(elapsed_sec, 3), "error": "usage_capture_failed"}


def _agent_usage_from_responses(responses_path: Path) -> dict:
    """Sum claude-sonnet-4-6 usage across all responses in a single iter's
    responses.json. Includes cache stats and reasoning tokens."""
    if not responses_path.exists():
        return {}
    try:
        responses = json.load(open(responses_path))
    except Exception:
        return {}
    inp = out = cr = cc_5m = cc_1h = reasoning = 0
    model = ""
    for r in responses:
        if isinstance(r, dict):
            model = r.get("model", model)
            u = r.get("usage") or {}
            inp += u.get("input_tokens", 0) or 0
            out += u.get("output_tokens", 0) or 0
            cr += u.get("cache_read_input_tokens", 0) or 0
            cc = u.get("cache_creation") or {}
            cc_5m += cc.get("ephemeral_5m_input_tokens", 0) or 0
            cc_1h += cc.get("ephemeral_1h_input_tokens", 0) or 0
            det = u.get("output_tokens_details") or {}
            reasoning += det.get("reasoning_tokens", 0) or 0
    usage_dict = {
        "input_tokens": inp, "output_tokens": out,
        "cache_read_input_tokens": cr,
        "cache_creation": {"ephemeral_5m_input_tokens": cc_5m, "ephemeral_1h_input_tokens": cc_1h},
        "output_tokens_details": {"reasoning_tokens": reasoning},
    }
    return {
        "model": model,
        "input_tokens": inp, "output_tokens": out,
        "cache_read_input_tokens": cr,
        "cache_creation_5m": cc_5m, "cache_creation_1h": cc_1h,
        "reasoning_tokens": reasoning,
        "cost_usd": round(_price_anthropic_full(model, usage_dict), 6),
        "n_responses": len(responses),
    }


def _capture_evaluator_usage_snapshot() -> dict:
    """Snapshot evaluator's global _USAGE_TOTALS so we can diff before/after a judge call."""
    try:
        import evaluate_figma_results as efr
        t = efr._USAGE_TOTALS
        return {"calls": t["calls"], "input": t["input"], "output": t["output"],
                "reasoning": t["reasoning"], "cost": t["cost"]}
    except Exception:
        return {"calls": 0, "input": 0, "output": 0, "reasoning": 0, "cost": 0.0}


def _evaluator_usage_delta(before: dict, after: dict, elapsed_sec: float, model: str) -> dict:
    return {
        "model": model, "elapsed_sec": round(elapsed_sec, 3),
        "input_tokens": after["input"] - before["input"],
        "output_tokens": after["output"] - before["output"],
        "reasoning_tokens": after["reasoning"] - before["reasoning"],
        "cost_usd": round(after["cost"] - before["cost"], 6),
        "calls": after["calls"] - before["calls"],
    }


def _take_router_usage_with_cost(model: str) -> dict:
    """Drain CARE router usage log and aggregate. Calls take_router_usage_log() in care_router."""
    from .care_router import take_router_usage_log
    entries = take_router_usage_log()
    if not entries:
        return {}
    inp = sum(e.get("input_tokens", 0) for e in entries)
    out = sum(e.get("output_tokens", 0) for e in entries)
    reasoning = sum(e.get("reasoning_tokens", 0) for e in entries)
    elapsed = sum(e.get("elapsed_sec", 0.0) for e in entries)
    return {
        "model": model, "elapsed_sec": round(elapsed, 3),
        "input_tokens": inp, "output_tokens": out,
        "reasoning_tokens": reasoning,
        "cost_usd": round(_price_openai(model, inp, out), 6),
        "calls": len(entries),
        "per_call": entries,
    }


def _load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def _distill_feedback_llm(if_reason: str, logger, original_task: str = "",
                          cumulative_actions: list[str] | None = None,
                          usage_sink: dict | None = None) -> str:
    """Use gpt-5.1-mini (same as dual router) to turn judge reasoning into
    2–4 imperative bullet actions for the next iter's prompt.

    Passes ORIGINAL TASK + ACTIONS ALREADY DONE so the distiller can interpret
    judge phrases like "Slide 1 reference styles" correctly (e.g. recognizing
    that Slide 1 was removed and is now a style source, NOT an edit target)
    and avoid re-suggesting already-completed work.
    """
    try:
        import openai
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            logger.warning("[DISTILL] no OPENAI_API_KEY — falling back to verbatim")
            return if_reason
        client = openai.OpenAI(api_key=api_key)

        actions_text = ""
        if cumulative_actions:
            actions_text = "\nALREADY-EXECUTED ACTIONS (state of canvas reflects these — do NOT re-do):\n"
            actions_text += "\n".join(f"- {a}" for a in cumulative_actions)

        system_prompt = (
            "You convert a slide-deck judge's critique into 2–4 concise, "
            "imperative bullet points for an LLM agent that will edit a "
            "Figma deck.\n\n"
            "CRITICAL — the recipient agent is STATELESS:\n"
            "  • It does NOT remember any prior iterations.\n"
            "  • It only sees the CURRENT canvas state via tools.\n"
            "  • It CANNOT access content that has been deleted, moved, or\n"
            "    substantially altered in prior iters (per ALREADY-EXECUTED ACTIONS).\n"
            "  • Therefore, each bullet must be SELF-CONTAINED: extract any\n"
            "    concrete values from the critique and place them directly\n"
            "    in the bullet. Do NOT refer to entities that may no longer\n"
            "    exist on the canvas.\n\n"
            "You receive these inputs:\n"
            "  • ORIGINAL TASK — describes the overall goal and role of each element.\n"
            "  • ALREADY-EXECUTED ACTIONS — tool calls already applied; canvas reflects them.\n"
            "  • JUDGE'S CRITIQUE — what is still wrong with the current state.\n\n"
            "Constraints:\n"
            "  (a) Each bullet must be DIRECTLY actionable.\n"
            "  (b) Avoid suggesting work that ALREADY-EXECUTED ACTIONS shows is done.\n"
            "  (c) Preserve concrete values from the critique verbatim.\n"
            "  (d) No preamble, no summary. Output only the bullet list. "
            "      Start each bullet with '- '."
        )
        user_prompt = (
            f"ORIGINAL TASK:\n{original_task}\n"
            f"{actions_text}\n\n"
            f"JUDGE'S CRITIQUE of the previous attempt:\n{if_reason}\n\n"
            "Produce 2–4 actionable bullets for the next iteration."
        )

        import time as _t
        _t0 = _t.time()
        resp = client.chat.completions.create(
            model=DISTILL_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0,
            max_tokens=400,
        )
        if usage_sink is not None:
            usage_sink.update(_capture_chat_usage(resp, DISTILL_MODEL, _t.time() - _t0))
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"[DISTILL] LLM distill failed ({e}) — falling back to verbatim")
        return if_reason


def _summarize_actions_from_responses(responses_path: Path) -> list[str]:
    """Parse a responses.json file and return a concise list of action strings,
    one per tool_use block, in invocation order. batch_execute is expanded into
    per-command counts (e.g. 'batch_execute(set_text_font×8, set_fill_color×2)')."""
    from collections import Counter
    if not responses_path.exists():
        return []
    try:
        responses = json.load(open(responses_path))
    except Exception:
        return []
    out = []
    for r in responses:
        for b in r.get("content", []) or []:
            if not (isinstance(b, dict) and b.get("type") == "tool_use"):
                continue
            name = b.get("name", "?")
            inp = b.get("input", {}) or {}
            if name == "batch_execute":
                cmds = Counter(op.get("command", "?") for op in inp.get("operations", []))
                summary = ", ".join(f"{c}×{n}" for c, n in cmds.most_common())
                out.append(f"batch_execute({summary})")
            elif name in ("delete_slide", "delete_node", "delete_element"):
                key = inp.get("slideId") or inp.get("nodeId") or inp.get("id") or "?"
                out.append(f"{name}({key})")
            elif name == "create_slide":
                tpl = inp.get("template") or inp.get("slideType") or ""
                idx = inp.get("index", inp.get("insertAt", ""))
                out.append(f"create_slide(template={tpl!r}, index={idx})")
            elif name in ("move_node", "reorder_slide", "reorder_node"):
                out.append(f"{name}({json.dumps(inp, ensure_ascii=False)[:120]})")
            else:
                out.append(f"{name}({json.dumps(inp, ensure_ascii=False)[:80]})")
    return out


def _build_iter_prompt(original: str, prev_if_reason: str, iter_num: int,
                       feedback_mode: str, logger,
                       cumulative_actions: list[str] | None = None,
                       distill_usage_sink: dict | None = None) -> tuple[str, str, str]:
    """Returns (next_prompt, feedback_text_used, actions_block_used).

    Iter ≥ 2 prompt = distilled feedback only. The original task and the
    accumulated tool-call history are intentionally OMITTED from the prompt to
    keep the agent from re-executing destructive ops mentioned in the original
    task. The agent must rely on get_all_slides / inspection tools to read the
    current canvas state. We still log cumulative_actions for debugging AND
    pass them to the distiller so it can avoid re-suggesting completed work.
    """
    if feedback_mode == "verbatim":
        feedback = (
            "The following is a judge's critique of your previous attempt at "
            "this slide-editing task. Address each issue raised:\n\n"
            f"{prev_if_reason}"
        )
    elif feedback_mode == "template":
        feedback = f"Previous attempt issue: {prev_if_reason}. Address this specific issue."
    else:  # llm_distill — pass original task + action history as context
        feedback = _distill_feedback_llm(
            prev_if_reason, logger,
            original_task=original,
            cumulative_actions=cumulative_actions,
            usage_sink=distill_usage_sink,
        )
    logger.info(f"[REASON2ACTION/{feedback_mode}] for iter {iter_num}:")
    for line in feedback.splitlines():
        if line.strip():
            logger.info(f"[REASON2ACTION]   {line}")

    # Log accumulated actions for traceability (NOT injected into prompt).
    actions_block = ""
    if cumulative_actions:
        actions_block = "\n".join(f"- {a}" for a in cumulative_actions)
        logger.info(f"[ACTION-HISTORY] {len(cumulative_actions)} prior actions "
                    f"(logged only — NOT passed to iter {iter_num} prompt):")
        for a in cumulative_actions:
            logger.info(f"[ACTION-HISTORY]   - {a}")

    # Iter ≥ 2 prompt: feedback bullets only.
    next_prompt = feedback
    return next_prompt, feedback, actions_block


def _judge_if_inline(case: dict, result_dir: Path, result_name: str,
                     original_dir: Path, logger,
                     true_initial_dir: Path | None = None) -> tuple[float, str]:
    """Invoke evaluate_figma_results.judge_instruction_following directly.

    For Pattern B iter ≥ 2, the current snapshots/snapshot-0 is iter N's start
    (= iter N-1's end), NOT the true original. Pass `true_initial_dir` (= the
    iter_snapshots/iter_1/ path) so the judge compares ORIGINAL → CUMULATIVE
    state, matching how non-agentic baseline is judged.
    """
    import evaluate_figma_results as efr
    snapshot_dir = result_dir / "snapshots"
    case_prefix = result_name

    # Find max snapshot turn number in current snapshots/
    snap_files = sorted(snapshot_dir.glob(f"{case_prefix}-snapshot-*.json"))
    nums = set()
    for f in snap_files:
        m = re.search(r"-snapshot-(\d+)\.json$", f.name)
        if m:
            nums.add(int(m.group(1)))
        m2 = re.search(r"-snapshot-(\d+)-structure\.json$", f.name)
        if m2:
            nums.add(int(m2.group(1)))
    if not nums:
        raise RuntimeError(f"No snapshot files in {snapshot_dir}")
    pred_turn = max(nums)

    # Initial JSON: prefer iter-1's snapshot-0 (true original) when provided
    if true_initial_dir is not None and true_initial_dir.exists():
        initial_json = efr.load_snapshot_structure_json(true_initial_dir, case_prefix, 0)
        logger.info(f"[IF-INLINE] using true initial from {true_initial_dir.name}/snapshot-0")
        init_snap_dir_for_transitions = true_initial_dir
    else:
        initial_json = efr.load_snapshot_structure_json(snapshot_dir, case_prefix, min(nums))
        init_snap_dir_for_transitions = snapshot_dir

    # Pred = latest snapshot in current snapshots/ = this iter's cumulative state
    pred_json = efr.load_snapshot_structure_json(snapshot_dir, case_prefix, pred_turn)
    pred_images_b64 = efr.load_snapshot_images_b64(snapshot_dir, case_prefix, pred_turn)

    # Inject slide transitions from full snapshot JSONs (slim -structure.json
    # files don't include them, but the agent's set_slide_transition edits live
    # in the full "-snapshot-N.json" toolResults). Without this, diff_figma_json
    # misses transition-only changes (e.g. Case 37 "Add Transitions").
    init_full_path = init_snap_dir_for_transitions / f"{case_prefix}-snapshot-0.json"
    pred_full_path = snapshot_dir / f"{case_prefix}-snapshot-{pred_turn}.json"
    if init_full_path.exists() and initial_json is not None:
        efr._inject_transitions_into_doc(
            initial_json, efr._extract_transitions_from_snap_full(init_full_path)
        )
    if pred_full_path.exists() and pred_json is not None:
        efr._inject_transitions_into_doc(
            pred_json, efr._extract_transitions_from_snap_full(pred_full_path)
        )

    # Ground truth: load from gt_dir if specified, else INIT-vs-PRED works
    gt_dir = case.get("gt_dir")
    gt_json = None
    if gt_dir:
        gt_path = PROJECT_ROOT / gt_dir / "full_document_baseline.json"
        if not gt_path.exists():
            gt_path = PROJECT_ROOT / gt_dir / "full_document.json"
        if gt_path.exists():
            gt_json = json.load(open(gt_path))

    api_key = os.environ.get("OPENAI_API_KEY") or ""
    result = efr.judge_instruction_following(
        instruction=case["prompt"],
        style_target="",
        gt_json=gt_json,
        pred_json=pred_json,
        initial_json=initial_json,
        judge_model=JUDGE_MODEL,
        api_key=api_key,
        pred_images_b64=pred_images_b64,
    )
    # NOTE: evaluator returns keys `instruction_following_score` / `_reason`
    score = result.get("instruction_following_score")
    reason = result.get("instruction_following_reason", "")
    logger.info(f"[IF-INLINE] snapshot-{pred_turn} → IF={score}")
    logger.info(f"[IF-INLINE] IF reason: {reason}")
    return float(score) if score is not None else 0.0, reason


class FigmaSlideAgenticExperiment(FigmaSlideExperiment):
    """Self-correcting wrapper: loops with IF-judge feedback, no cleanup
    between iters (Pattern B)."""

    def __init__(self, config: ExperimentConfig, *, max_iter: int, threshold: float,
                 feedback_mode: str):
        super().__init__(config)
        self.max_iter = max_iter
        self.threshold = threshold
        self.feedback_mode = feedback_mode

    async def run(self):
        self.logger.info(
            f"[AGENTIC] Starting self-correcting figma-slide experiment "
            f"(model={self.config.model.value}, max_iter={self.max_iter}, "
            f"threshold={self.threshold}, feedback_mode={self.feedback_mode})"
        )

        cases = self.evaluation_pairs
        if hasattr(self.config, "cases") and self.config.cases:
            indices = set(self.config.cases)
            cases = [c for i, c in enumerate(self.evaluation_pairs) if i in indices]
        self.logger.info(f"Filtered to {len(cases)} case(s): {[c['name'] for c in cases]}")

        timeout = aiohttp.ClientTimeout(total=None)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            desired_channel = self.channel_config.get("channel_code")
            if desired_channel:
                try:
                    async with session.post(
                        f"{self.api_base_url}/tool/select_channel",
                        params={"channel": desired_channel},
                    ) as resp:
                        if resp.status != 200:
                            self.logger.warning(f"channel switch failed ({resp.status})")
                except Exception as e:
                    self.logger.warning(f"channel switch err: {e}")

            for idx, case in enumerate(cases):
                await self._run_one_case_with_self_correct(session, idx, len(cases), case)

    async def _run_one_case_with_self_correct(self, session, idx: int, total: int, case: dict):
        case_name = case["name"]
        original_path = case.get("original")
        if not original_path:
            self.logger.warning(f"[AGENTIC] Skipping '{case_name}': no original_path (from-scratch unsupported)")
            return
        original_dir = self.project_root / original_path
        if not original_dir.is_dir():
            self.logger.warning(f"[AGENTIC] Skipping '{case_name}': missing {original_dir}")
            return

        frames_dir = original_dir / "frames"
        full_doc_path = original_dir / "full_document.json"
        if not (frames_dir.is_dir() and full_doc_path.exists()):
            self.logger.warning(f"[AGENTIC] Skipping '{case_name}': missing frames or full_document.json")
            return

        dir_name = Path(original_path).name
        result_name = f"{dir_name}-{self.config.model.value}"
        result_dir = self.results_dir / result_name
        case_log = self.logger.add_case_log(result_dir)

        self.logger.info(f"=== [{idx+1}/{total}] {case_name} ===")
        self.logger.info(f"[AGENTIC] result_dir={result_dir}")
        self.logger.info(f"[PROMPT] {case['prompt']}")

        # Skip-existing (auto)
        raw_path = result_dir / f"{result_name}-raw-response.json"
        if getattr(self.config, "auto", False) and raw_path.exists():
            self.logger.info(f"[AUTO] Result exists, skipping: {result_name}")
            self.logger.remove_case_log()
            return

        # ---- One-time setup: load original, route, cleanup ----
        with open(full_doc_path, "r", encoding="utf-8") as f:
            base_json_string = f.read()

        context_json_string = None
        routing_mode_value = None
        care_target_slide_indices = None
        composite_bytes = None
        fill_image_data = self._load_image_data(original_dir)

        # Drain any stale router usage from prior runs so this case's count is clean
        from .care_router import take_router_usage_log as _drain_router
        _drain_router()
        care_usage = {}  # populated after _resolve_routing
        if self.routing_mode != "off":
            try:
                summary = self._load_presentation_summary(original_dir)
                decision = self._resolve_routing(case["prompt"], summary, case.get("edit_type"))
                care_target_slide_indices = decision.target_slide_indices or None
                context_json_string = self._prepare_context(decision, base_json_string, original_dir, summary)
                routing_mode_value = decision.mode.value
                selected = select_images_for_mode(frames_dir, decision, summary)
                if selected:
                    composite_bytes = self._create_composite_image(selected)
                self.logger.info(
                    f"[CARE] Mode: {decision.mode.value}, "
                    f"Targets: {[i+1 for i in (decision.target_slide_indices or [])]}, "
                    f"NeedsImage: {decision.needs_image}, "
                    f"Confidence: {decision.confidence:.2f}"
                )
                self.logger.info(f"[CARE] Reason: {decision.reason}")
                # Capture router LLM usage (drained → aggregated)
                care_usage = _take_router_usage_with_cost(DISTILL_MODEL)
                if care_usage:
                    self.logger.info(
                        f"[USAGE/CARE] {care_usage['calls']} call(s) "
                        f"in={care_usage['input_tokens']} out={care_usage['output_tokens']} "
                        f"reasoning={care_usage['reasoning_tokens']} "
                        f"cost=${care_usage['cost_usd']:.4f} "
                        f"elapsed={care_usage['elapsed_sec']:.2f}s"
                    )
            except Exception as e:
                self.logger.warning(f"[CARE] failed, using FULL fallback: {e}")
                composite_bytes = self._create_composite_image(sorted(frames_dir.glob("*.png")))

        try:
            await self.ensure_canvas_empty(session)
        except RuntimeError:
            self.logger.error(f"[CLEANUP] failed for {result_name}, skipping")
            self.logger.remove_case_log()
            return

        lock_path = None
        if getattr(self.config, "auto", False):
            lock_path = self._acquire_lock(result_name)
            if lock_path is None:
                self.logger.info(f"[AUTO] locked elsewhere, skipping: {result_name}")
                self.logger.remove_case_log()
                return

        # ---- Iter loop ----
        import shutil
        history = []
        current_prompt = case["prompt"]
        final_if_score = None
        prev_if_score = None  # for regression detection (C)
        cumulative_actions: list[str] = []  # Tool calls accumulated across iters
        try:
            for it in range(1, self.max_iter + 1):
                self.logger.info(f"[AGENTIC] iter {it}/{self.max_iter}"
                                 f" {'(skipImport — Pattern B)' if it > 1 else '(initial import)'}")
                t0 = time.time()
                # iter ≥ 2: skip heavy payloads (base JSON, composite image,
                # image fills, routed context). Plugin doesn't use them once
                # skipImport=true, and resending them risks claude's 1M-token
                # context overflow (e.g. Case 44 hit 1.13M tokens at iter 2).
                # The agent reads current canvas state via tools instead.
                is_first = (it == 1)
                result = await self.run_modification(
                    session,
                    composite_bytes if is_first else None,
                    base_json_string if is_first else "{}",
                    current_prompt,
                    result_name,
                    context_json_string=context_json_string if is_first else None,
                    routing_mode=routing_mode_value if is_first else None,
                    image_data=fill_image_data if is_first else None,
                    target_slide_indices=care_target_slide_indices if is_first else None,
                    skip_import=(it > 1),  # Pattern B: only iter 1 imports baseJson
                )
                infer_t = time.time() - t0
                if result is None:
                    self.logger.error(f"[AGENTIC] iter {it} inference failed")
                    history.append({"iter": it, "error": "inference_failed", "inference_sec": infer_t})
                    break
                await self.save_results(result, result_name)
                self.logger.info(f"[AGENTIC] iter {it} inference done ({infer_t:.0f}s)")

                # (A) Preserve this iter's snapshot dir before next iter overwrites it
                snap_src = result_dir / "snapshots"
                snap_dst = result_dir / "iter_snapshots" / f"iter_{it}"
                try:
                    snap_dst.parent.mkdir(parents=True, exist_ok=True)
                    if snap_dst.exists():
                        shutil.rmtree(snap_dst)
                    shutil.copytree(snap_src, snap_dst)
                    self.logger.info(f"[AGENTIC] iter {it} snapshots preserved → iter_snapshots/iter_{it}/")
                except Exception as e:
                    self.logger.warning(f"[AGENTIC] failed to preserve iter {it} snapshots: {e}")

                # Extract this iter's tool-call actions and accumulate across iters.
                # responses.json gets overwritten each iter, so read it NOW before
                # the next iter clobbers it.
                resp_path = result_dir / f"{result_name}-responses.json"
                iter_actions = _summarize_actions_from_responses(resp_path)
                if iter_actions:
                    self.logger.info(f"[AGENTIC] iter {it} executed {len(iter_actions)} tool call(s); accumulating")
                    cumulative_actions.extend(f"(iter {it}) {a}" for a in iter_actions)
                # Also copy responses.json into iter_snapshots for record
                try:
                    shutil.copy2(resp_path, snap_dst / "responses.json")
                except Exception:
                    pass

                # Agent inference usage (from responses.json saved by save_results)
                agent_usage = _agent_usage_from_responses(resp_path)
                agent_usage["elapsed_sec"] = round(infer_t, 3)
                if agent_usage.get("input_tokens") is not None:
                    self.logger.info(
                        f"[USAGE/AGENT] in={agent_usage.get('input_tokens')} "
                        f"out={agent_usage.get('output_tokens')} "
                        f"reasoning={agent_usage.get('reasoning_tokens')} "
                        f"cache_r={agent_usage.get('cache_read_input_tokens')} "
                        f"cost=${agent_usage.get('cost_usd'):.4f}"
                    )

                # Inline IF judge: for iter ≥ 2, point to iter_1's snapshot-0
                # as the true initial (cumulative-state evaluation).
                true_initial_dir = None
                if it > 1:
                    candidate = result_dir / "iter_snapshots" / "iter_1"
                    if candidate.exists():
                        true_initial_dir = candidate
                try:
                    eval_before = _capture_evaluator_usage_snapshot()
                    t0 = time.time()
                    if_score, if_reason = _judge_if_inline(
                        case, result_dir, result_name, original_dir, self.logger,
                        true_initial_dir=true_initial_dir,
                    )
                    judge_t = time.time() - t0
                    eval_after = _capture_evaluator_usage_snapshot()
                    if_judge_usage = _evaluator_usage_delta(eval_before, eval_after, judge_t, JUDGE_MODEL)
                    final_if_score = if_score
                    self.logger.info(f"[AGENTIC] iter {it} IF={if_score} ({judge_t:.0f}s)")
                    self.logger.info(f"[AGENTIC] IF reason: {if_reason[:200]}")
                    self.logger.info(
                        f"[USAGE/IF-JUDGE] in={if_judge_usage['input_tokens']} "
                        f"out={if_judge_usage['output_tokens']} "
                        f"reasoning={if_judge_usage['reasoning_tokens']} "
                        f"cost=${if_judge_usage['cost_usd']:.4f}"
                    )
                except Exception as e:
                    self.logger.error(f"[AGENTIC] IF judge failed: {e}")
                    history.append({"iter": it, "error": f"judge_failed: {e}", "inference_sec": infer_t})
                    break

                iter_record = {
                    "iter": it, "IF": if_score, "IF_reason": if_reason,
                    "prompt": current_prompt,
                    "inference_sec": infer_t, "judge_sec": judge_t,
                    "usage": {
                        "agent": agent_usage,
                        "if_judge": if_judge_usage,
                        # care_router is a one-time call at start of case;
                        # also stored at top-level (see below) for clarity.
                    },
                }

                if if_score >= self.threshold:
                    self.logger.info(f"[AGENTIC] IF {if_score} ≥ threshold {self.threshold}, stopping")
                    history.append(iter_record)
                    break

                # (C) Early-stop on regression: this iter's IF is worse than previous
                if prev_if_score is not None and if_score < prev_if_score:
                    self.logger.warning(
                        f"[AGENTIC] IF regressed ({prev_if_score} → {if_score}), "
                        f"stopping. Last better iter was iter {it-1}; its snapshots are in "
                        f"iter_snapshots/iter_{it-1}/."
                    )
                    iter_record["regression"] = True
                    iter_record["prev_IF"] = prev_if_score
                    history.append(iter_record)
                    break

                if it == self.max_iter:
                    self.logger.info(f"[AGENTIC] max iter reached")
                    history.append(iter_record)
                    break

                # Build next iter prompt: include distilled feedback + accumulated
                # action history (so iter N+1 doesn't re-execute destructive ops).
                distill_usage: dict = {}
                current_prompt, distilled_feedback, actions_block = _build_iter_prompt(
                    case["prompt"], if_reason, it+1, self.feedback_mode, self.logger,
                    cumulative_actions=cumulative_actions,
                    distill_usage_sink=distill_usage,
                )
                iter_record["feedback_used_in_next_iter"] = distilled_feedback
                iter_record["actions_history_used_in_next_iter"] = actions_block
                iter_record["usage"]["distill"] = distill_usage
                if distill_usage.get("input_tokens") is not None:
                    self.logger.info(
                        f"[USAGE/DISTILL] in={distill_usage.get('input_tokens')} "
                        f"out={distill_usage.get('output_tokens')} "
                        f"reasoning={distill_usage.get('reasoning_tokens')} "
                        f"cost=${distill_usage.get('cost_usd'):.4f} "
                        f"elapsed={distill_usage.get('elapsed_sec'):.2f}s"
                    )
                history.append(iter_record)
                prev_if_score = if_score
                # NB: NO cleanup between iters — Pattern B
                # base_json_string / context_json_string remain (stale but agent uses tools)
        finally:
            # Restore the TRUE initial snapshot (iter 1's snapshot-0 = original
            # deck) over result_dir/snapshots/snapshot-0. The figma plugin
            # naturally overwrites snapshots/snapshot-0 each iter with that
            # iter's start state (= prev iter's end under skipImport=Pattern B),
            # which would mislead the canonical evaluator into computing only
            # the LAST iter's incremental diff instead of the cumulative one.
            try:
                iter1_dir = result_dir / "iter_snapshots" / "iter_1"
                snap_dir = result_dir / "snapshots"
                if iter1_dir.exists() and snap_dir.exists():
                    copied = 0
                    for f in iter1_dir.glob(f"{result_name}-snapshot-0*"):
                        shutil.copy2(f, snap_dir / f.name)
                        copied += 1
                    if copied:
                        self.logger.info(
                            f"[AGENTIC] restored snapshots/snapshot-0 from "
                            f"iter_snapshots/iter_1/ ({copied} files) — "
                            "canonical evaluator now uses TRUE initial as baseline."
                        )
            except Exception as e:
                self.logger.warning(f"[AGENTIC] failed to restore true initial snapshot: {e}")

            # Persist iter history (includes per-iter usage breakdown)
            # Aggregate totals across all 4 components for quick scanning.
            totals = {"agent_cost": 0.0, "if_judge_cost": 0.0, "distill_cost": 0.0,
                      "care_router_cost": care_usage.get("cost_usd", 0.0) if care_usage else 0.0,
                      "total_cost": 0.0}
            for h in history:
                u = h.get("usage", {}) or {}
                totals["agent_cost"] += (u.get("agent") or {}).get("cost_usd", 0.0) or 0.0
                totals["if_judge_cost"] += (u.get("if_judge") or {}).get("cost_usd", 0.0) or 0.0
                totals["distill_cost"] += (u.get("distill") or {}).get("cost_usd", 0.0) or 0.0
            totals["total_cost"] = (
                totals["agent_cost"] + totals["if_judge_cost"]
                + totals["distill_cost"] + totals["care_router_cost"]
            )
            hist_path = result_dir / f"{result_name}-self_correct_history.json"
            try:
                hist_path.parent.mkdir(parents=True, exist_ok=True)
                json.dump({
                    "case_name": case_name,
                    "max_iter": self.max_iter,
                    "threshold": self.threshold,
                    "feedback_mode": self.feedback_mode,
                    "iters_run": len(history),
                    "final_IF": final_if_score,
                    "care_router_usage": care_usage,  # one-time per case
                    "totals_usd": totals,
                    "history": history,
                }, open(hist_path, "w"), indent=2)
                self.logger.info(f"[AGENTIC] history saved → {hist_path}")
            except Exception as e:
                self.logger.error(f"[AGENTIC] failed to save history: {e}")
            if lock_path:
                self._release_lock(lock_path)
            self.logger.remove_case_log()


def parse_args():
    parser = argparse.ArgumentParser(description="Self-correcting figma-slide experiment")
    from .base_runner import parse_common_args
    parser = parse_common_args(parser)
    parser.add_argument("--auto", action="store_true", required=False)
    parser.add_argument("--cases", nargs="+", type=int)
    parser.add_argument("--eval-file", type=str)
    parser.add_argument("--results-dir", type=str)
    parser.add_argument("--routing", choices=["auto","llm","dual_llm","hybrid","micro","macro","systemic","full","off"], default="auto")
    parser.add_argument("--max-turns", type=int, default=None)
    parser.add_argument("--max-iter", type=int, default=3,
                        help="Max self-correction iters per case (default 3)")
    parser.add_argument("--threshold", type=float, default=4.0,
                        help="Stop early once IF >= threshold (default 4.0)")
    parser.add_argument("--feedback-mode", choices=["verbatim", "llm_distill", "template"],
                        default="llm_distill",
                        help="How to turn IF reason into next-iter feedback")
    return parser.parse_args()


async def main():
    _load_dotenv(PROJECT_ROOT / "config.env")
    args = parse_args()
    config = ExperimentConfig.from_args(args)
    setattr(config, "auto", getattr(args, "auto", False))
    config.cases = getattr(args, "cases", [])
    config.routing = getattr(args, "routing", "auto")
    config.eval_file = getattr(args, "eval_file", None)
    config.results_dir = getattr(args, "results_dir", None)
    if not config.results_dir:
        # Auto-derive: avoid the yaml's hard-coded gpt-5.2-ours default leaking
        # into claude runs. Tag agentic results separately so they don't clobber
        # the non-agentic baseline.
        config.results_dir = f"../results/figma_slide_benchmark_{args.model}-ours-agentic"
    config.max_turns_override = getattr(args, "max_turns", None)
    experiment = FigmaSlideAgenticExperiment(
        config,
        max_iter=args.max_iter,
        threshold=args.threshold,
        feedback_mode=args.feedback_mode,
    )
    await experiment.run()


if __name__ == "__main__":
    asyncio.run(main())
