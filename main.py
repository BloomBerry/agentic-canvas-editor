"""
Agentic Canvas Editor - Main Entry Point
==========================================
This script runs the self-correcting slide-editing agent on a benchmark case.

The agent edits a Figma Slides deck through structured MCP tool calls and then
*self-corrects*: after every editing iteration an in-loop instruction-following
(IF) judge scores the result, and—if the score is below a threshold—the judge's
critique is distilled into feedback and a new iteration is launched on top of the
current canvas state (no reset). See README.md, Section 7.

Two modes are available:
  --mock   : Dry-run mode. Walks through the pipeline and prints what would be
             called without requiring any API keys or bundled benchmark data.
             Useful for reviewers who do not have access to Figma / LLM APIs.
  (default): Live mode. Requires FIGMA_ACCESS_TOKEN, an LLM API key
             (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_APPLICATION_CREDENTIALS),
             a running MCP stack, and a Figma Slides file with the plugin loaded
             (see README.md, Section 4).

Example usage
-------------
  # Dry-run (no API keys / no data needed):
  python main.py --mock

  # Live, self-correcting run with Claude Sonnet (default):
  python main.py --model claude-sonnet-4-6 --max-iter 3 --threshold 4.0

  # Live run with GPT-5.5:
  python main.py --model gpt-5.5 --routing dual_llm

  # Live, single forward pass (no self-correction loop):
  python main.py --model claude-sonnet-4-6 --single-pass
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data" / "ConvertTableToBarChart_TestA"   # not bundled in this release
BENCHMARK_FILE = ROOT / "benchmark.json"
SAMPLE_LOG_FILE = ROOT / "sample_output" / "case_108_history.json"
ENV_FILE = ROOT / "config.env"

AGENTIC_RUNNER = "src.experiments.run_figma_slide_agentic_mcp_experiment"
SINGLE_RUNNER = "src.experiments.run_figma_slide_mcp_experiment"


# ---------------------------------------------------------------------------
# Mock / Dry-run mode
# ---------------------------------------------------------------------------

def _count_nodes(node: dict) -> int:
    count = 1
    for child in node.get("children", []):
        count += _count_nodes(child)
    return count


def run_mock():
    """
    Simulate the agent pipeline without any API calls or bundled data.

    Steps shown:
      1.  Load the benchmark case definition
      2.  List the source modules that implement the pipeline
      3.  (If bundled) inspect slide structures; otherwise skip
      4.  Print the CARE routing decision that would be made
      5.  Print the self-correction loop that would run
      6.  Summarize the saved real execution log from sample_output/
    """
    print("=" * 70)
    print("  Agentic Canvas Editor — MOCK / DRY-RUN MODE")
    print("  (No API keys, no bundled data required)")
    print("=" * 70)

    # --- Step 1: Load benchmark ---
    print("\n[1/6] Loading benchmark case...")
    with open(BENCHMARK_FILE, "r") as f:
        benchmark = json.load(f)
    case = benchmark[0]
    print(f"  Case name : {case['name']}")
    print(f"  Prompt    : {case['prompt']}")
    print(f"  Categories: {', '.join(case['category'])}")

    # --- Step 2: List pipeline source modules ---
    print("\n[2/6] Pipeline source modules:")
    modules = [
        ("src/experiments/care_router.py", "Classify instruction -> spatial-context routing mode"),
        ("src/experiments/care_context.py", "Build the compressed canvas context (micro/macro/systemic/full)"),
        ("src/experiments/run_figma_slide_mcp_experiment.py", "Single-pass agent runner"),
        ("src/experiments/run_figma_slide_agentic_mcp_experiment.py", "Self-correcting runner (IF-judge loop)"),
        ("evaluate_figma_results.py", "In-loop instruction-following (IF) + visual-quality judge"),
        ("src/mcp_client/", "TypeScript: agent <-> Figma bridge (multi-turn LLM loop)"),
        ("src/mcp_server/", "TypeScript: canvas-editing MCP tool implementations"),
        ("src/socket_server/", "TypeScript: central WebSocket relay hub"),
        ("src/figma_plugin/", "Figma Slides plugin (executes tools inside Figma)"),
    ]
    for path, desc in modules:
        present = "OK " if (ROOT / path).exists() else "-- "
        print(f"  [{present}] {path:<55} {desc}")

    # --- Step 3: Slide structures (only if data is bundled) ---
    print("\n[3/6] Slide structures:")
    jsons_dir = DATA_DIR / "jsons"
    if jsons_dir.exists():
        total_nodes = 0
        for p in sorted(jsons_dir.glob("slide_*.json")):
            with open(p, "r") as f:
                data = json.load(f)
            n = _count_nodes(data)
            total_nodes += n
            print(f"  {p.name}: {n} nodes, {p.stat().st_size // 1024} KB")
        print(f"  Total nodes across all slides: {total_nodes}")
    else:
        print("  (Benchmark decks are not bundled in this source release.)")
        print("  Provide your own Figma Slides deck and point --eval-file at it;")
        print("  see README.md, Sections 4 and 6.")

    # --- Step 4: CARE routing simulation ---
    print("\n[4/6] CARE routing decision (simulated):")
    print(f"  Instruction: \"{case['prompt']}\"")
    print("  Detected target slide: slide 2 (index 1)")
    print("  Routing mode: MICRO_SPATIAL")
    print("  Context: slide-2 node structure + rendered image")
    print("  Reason: single-slide task, layout + content modification")

    # --- Step 5: Self-correction loop ---
    print("\n[5/6] Self-correction loop (simulated, --max-iter 3, --threshold 4.0):")
    print("  iter 1: agent edits canvas -> IF judge scores 3.0  (< 4.0)  -> feedback distilled")
    print("  iter 2: agent refines on top of iter-1 state -> IF judge scores 4.0 (>= 4.0)")
    print("  stop  : threshold reached after 2 iterations")
    print("  (Real loop in run_figma_slide_agentic_mcp_experiment.py; judge in evaluate_figma_results.py)")

    # --- Step 6: Sample log summary ---
    print("\n[6/6] Sample agent execution log (sample_output/case_108_history.json):")
    if not SAMPLE_LOG_FILE.exists():
        print("  [WARNING] Sample log not found.")
    else:
        with open(SAMPLE_LOG_FILE, "r") as f:
            history = json.load(f)
        print(f"  Total turns: {len(history)}")
        for i, msg in enumerate(history):
            role = msg.get("role", "?")
            msg_type = msg.get("type", "?")
            content = msg.get("content", [])
            if isinstance(content, list) and content:
                first = content[0]
                if isinstance(first, dict) and first.get("type") == "text":
                    preview = first["text"][:120].replace("\n", " ")
                else:
                    preview = f"[{first.get('type', '?')} content]"
            else:
                preview = str(content)[:120]
            print(f"  Turn {i}: [{role}] {msg_type} — {preview}...")

    print("\n" + "=" * 70)
    print("  MOCK RUN COMPLETE")
    print("  To run with real APIs, see README.md Section 4.")
    print("=" * 70)


# ---------------------------------------------------------------------------
# Live mode helpers
# ---------------------------------------------------------------------------

def check_env():
    """Verify required environment variables are set."""
    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)

    missing = []
    if not os.getenv("FIGMA_ACCESS_TOKEN"):
        missing.append("FIGMA_ACCESS_TOKEN")

    model = os.getenv("AGENT_MODEL", "claude-sonnet-4-6")
    if "claude" in model and not os.getenv("ANTHROPIC_API_KEY"):
        missing.append("ANTHROPIC_API_KEY")
    elif "gpt" in model and not os.getenv("OPENAI_API_KEY"):
        missing.append("OPENAI_API_KEY")
    elif "gemini" in model and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        missing.append("GOOGLE_APPLICATION_CREDENTIALS")

    if missing:
        print("[ERROR] Missing environment variables:")
        for v in missing:
            print(f"  - {v}")
        print("\nSee config.env.example for required variables.")
        print("Or run with --mock for a no-API dry run.")
        sys.exit(1)


def run_live(args):
    """Launch the real experiment runner (self-correcting by default)."""
    import subprocess

    runner = SINGLE_RUNNER if args.single_pass else AGENTIC_RUNNER
    print("=" * 70)
    print("  Agentic Canvas Editor — LIVE MODE")
    print(f"  Runner : {'single-pass' if args.single_pass else 'self-correcting'}")
    print(f"  Model  : {args.model}")
    print(f"  Case   : {args.case}")
    print(f"  Routing: {args.routing}")
    if not args.single_pass:
        print(f"  Loop   : max-iter={args.max_iter}, threshold={args.threshold}, "
              f"feedback={args.feedback_mode}")
    print("=" * 70)

    check_env()

    cmd = [
        sys.executable, "-m", runner,
        "--model", args.model,
        "--channel", args.channel,
        "--config-name", "single-figma-slide",
        "--routing", args.routing,
        "--eval-file", str(BENCHMARK_FILE),
        "--cases", str(args.case),
        "--auto",
        "--results-dir", str(args.results_dir),
    ]
    if not args.single_pass:
        cmd += [
            "--max-iter", str(args.max_iter),
            "--threshold", str(args.threshold),
            "--feedback-mode", args.feedback_mode,
        ]

    print(f"\nRunning: {' '.join(cmd)}\n")
    env = os.environ.copy()
    src_dir = str(ROOT / "src")
    env["PYTHONPATH"] = src_dir + os.pathsep + env.get("PYTHONPATH", "")
    result = subprocess.run(cmd, cwd=ROOT, env=env)
    sys.exit(result.returncode)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Agentic Canvas Editor — EMNLP 2026 Supplementary"
    )
    parser.add_argument(
        "--mock", action="store_true",
        help="Dry-run mode: walk through the pipeline without any API calls.",
    )
    parser.add_argument(
        "--model", type=str, default="claude-sonnet-4-6",
        choices=[
            "claude-sonnet-4-6", "claude-opus-4-6", "claude-3-5-sonnet",
            "gpt-4o", "gpt-4.1", "gpt-5.2", "gpt-5.5",
            "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-pro",
            "gemini-3-flash-preview", "gemini-3.5-flash",
        ],
        help="LLM to use as the agent backbone (live mode only).",
    )
    parser.add_argument(
        "--case", type=int, default=0,
        help="Index of the case to run (only 0 is available in this submission).",
    )
    parser.add_argument(
        "--channel", type=str, default="channel_1",
        help="MCP channel name defined in src/config/expr/single-figma-slide.yaml.",
    )
    parser.add_argument(
        "--routing", type=str, default="dual_llm",
        choices=["dual_llm", "auto", "micro", "macro", "systemic", "full", "off"],
        help="CARE routing strategy.",
    )
    parser.add_argument(
        "--single-pass", action="store_true",
        help="Disable the self-correction loop (single forward pass).",
    )
    parser.add_argument(
        "--max-iter", type=int, default=3,
        help="Max self-correction iterations per case (self-correcting mode).",
    )
    parser.add_argument(
        "--threshold", type=float, default=4.0,
        help="Stop early once the IF-judge score reaches this threshold.",
    )
    parser.add_argument(
        "--feedback-mode", type=str, default="llm_distill",
        choices=["verbatim", "llm_distill", "template"],
        help="How the IF judge's critique is turned into next-iteration feedback.",
    )
    parser.add_argument(
        "--results-dir", type=str, default=str(ROOT / "results"),
        help="Directory to write result JSON files.",
    )
    args = parser.parse_args()

    if args.mock:
        run_mock()
    else:
        run_live(args)


if __name__ == "__main__":
    main()
