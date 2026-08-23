# Agentic Canvas Editor

[![Paper](https://img.shields.io/badge/EMNLP%202026-Industry%20Track-b31b1b.svg)](#citation)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Official source code for our paper on **agentic slide editing via structured
canvas representation with self-correction**, **accepted at the EMNLP 2026
Industry Track**.

> 📄 **Paper:** _archive URL to be updated_ (`xxx.archive` — TBD)
> 🗂️ **Benchmark dataset:** _release link to be updated_ (see [Citation](#citation))

This package includes:
- The full agent pipeline (Python orchestrator + TypeScript MCP tools)
- The **self-correction loop** with an in-loop instruction-following (IF) judge
  (`src/experiments/run_figma_slide_agentic_mcp_experiment.py` +
  `evaluate_figma_results.py`)
- The **CARE** instruction router and spatial-context builders
- The Figma Plugin (`src/figma_plugin/`) that runs inside the Figma Slides desktop app
- One benchmark case **definition** (`benchmark.json`, Case 108: ConvertTableToBarChart)
- The **released execution logs** for all 94 evaluable tasks (`execution_logs/`,
  see Section 8) plus one annotated sample log (`sample_output/case_108_history.json`)
- A mock / dry-run mode that requires **no API keys and no bundled data**

> **Scope.** This release publishes the *source code* of the agent together with
> the per-task **execution logs** (`execution_logs/`). The benchmark *decks*
> themselves (input/reference slide files) are **not** bundled — they are large
> and contain third-party slide content; the code is organized so you can point
> it at your own Figma Slides files. See Sections 4, 6, and 8.

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Installation](#2-installation)
3. [Quick Start — Mock Mode (No API Keys)](#3-quick-start--mock-mode-no-api-keys)
4. [Live Mode — Full Pipeline](#4-live-mode--full-pipeline)
5. [Code Structure](#5-code-structure)
6. [Reproducing Paper Results](#6-reproducing-paper-results)
7. [Self-Correction Loop and IF Judge](#7-self-correction-loop-and-if-judge)
8. [Execution Logs](#8-execution-logs)
9. [License](#9-license)
10. [Citation](#citation)

---

## 1. System Requirements

| Component | Requirement |
|-----------|-------------|
| Python    | >= 3.12 |
| Node.js   | >= 20 (for MCP client/server) |
| npm       | >= 10 |
| OS        | macOS / Linux (Windows untested) |
| RAM       | >= 8 GB recommended |

**API keys required for live mode (not needed for mock mode):**

| Model family | Required credential |
|---|---|
| Claude (Anthropic) | `ANTHROPIC_API_KEY` |
| GPT (OpenAI) | `OPENAI_API_KEY` |
| Gemini (Google) | `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON) |
| Any model (live) | `FIGMA_ACCESS_TOKEN` |

The in-loop IF judge defaults to a GPT backbone and therefore uses
`OPENAI_API_KEY` regardless of the agent model.

---

## 2. Installation

### 2a. Python environment

```bash
# Using conda (recommended — matches our exact environment)
conda create -n canvas-editor python=3.12
conda activate canvas-editor
pip install -r requirements.txt

# Or using venv
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2b. Node.js environment (for live mode only)

The pipeline uses four TypeScript components:
- **Socket Server** (`src/socket_server/`) — central WebSocket relay hub (port 3055)
- **MCP Client** (`src/mcp_client/`) — bridges the Python agent to Figma
- **MCP Server** (`src/mcp_server/`) — exposes canvas-editing tools, connects to Socket Server
- **Figma Plugin** (`src/figma_plugin/`) — runs inside the Figma Slides desktop app

```bash
# Build Socket Server
cd src/socket_server
npm install
cd ../..

# Build MCP Client
cd src/mcp_client
npm install
npm run build
cd ../..

# Build MCP Server
cd src/mcp_server
npm install
npm run build
cd ../..

# Build Figma Plugin
cd src/figma_plugin
npm install
npm run build
cd ../..
```

> Run `npm run build` for the Figma Plugin (step above) before loading it into
> Figma — the compiled output is generated under `src/figma_plugin/dist/`.

---

## 3. Quick Start — Mock Mode (No API Keys)

The mock mode walks through every stage of the pipeline using local files only
— no Figma account, LLM key, or benchmark deck required.

```bash
python main.py --mock
```

**What it does:**
1. Loads `benchmark.json` (Case 108 definition)
2. Lists the source modules that implement the pipeline (and checks they exist)
3. Inspects slide structures *if* a deck is bundled (skipped in this release)
4. Prints the CARE routing decision that would be made
5. Prints the self-correction loop that would run (IF-judge feedback)
6. Summarizes the real agent execution log from `sample_output/`

Expected output (abridged):
```
======================================================================
  Agentic Canvas Editor — MOCK / DRY-RUN MODE
  (No API keys, no bundled data required)
======================================================================

[1/6] Loading benchmark case...
  Case name : Case 108: ConvertTableToBarChart
  Prompt    : On slide 2, convert the table data showing uninsured
              rates into a bar chart. Also, create a custom legend
              for the chart on the right.
  Categories: Content, Layout
...
[5/6] Self-correction loop (simulated, --max-iter 3, --threshold 4.0):
  iter 1: agent edits canvas -> IF judge scores 3.0  (< 4.0)  -> feedback distilled
  iter 2: agent refines on top of iter-1 state -> IF judge scores 4.0 (>= 4.0)
  stop  : threshold reached after 2 iterations
...
```

---

## 4. Live Mode — Full Pipeline

### 4a. Environment setup

```bash
cp config.env.example config.env
# Open config.env and fill in your API keys
```

### 4b. Start the infrastructure services

The pipeline requires three background services and the Figma Plugin to be
running before launching the Python agent.

**Terminal 1 — Socket Server** (central WebSocket relay hub — must start first):

```bash
cd src/socket_server
npm run dev
# Listening on ws://localhost:3055
```

**Terminal 2 — MCP Server** (canvas-editing tools, connects to Socket Server):

```bash
cd src/mcp_server
npm run dev
# Connects to ws://localhost:3055
```

**Terminal 3 — MCP Client HTTP server** (receives agent requests, forwards to plugin):

```bash
cd src/mcp_client
node dist/app.js --port=3001
# Listening on http://localhost:3001
```

**Figma Plugin** — load into the Figma Slides desktop app:

1. Open [Figma Slides](https://www.figma.com/slides/) desktop app
2. Go to **Plugins → Development → Import plugin from manifest...**
3. Select `src/figma_plugin/dist/manifest.json`
4. Open a Figma Slides file and run the plugin (it connects to `ws://localhost:3055`)

The Socket Server acts as a central relay hub. Both the MCP Server and the
Figma Plugin connect to it as WebSocket clients and communicate through
channel-based messaging. The MCP Server receives tool-call instructions
(e.g., `create_bar_chart`, `set_text`) from the MCP Client and forwards them
through the Socket Server to the Figma Plugin, which executes them directly
inside the Figma plugin sandbox.

### 4c. Run the agent

```bash
# Self-correcting run with Claude Sonnet (default)
python main.py --model claude-sonnet-4-6 --max-iter 3 --threshold 4.0

# Self-correcting run with GPT-5.5
python main.py --model gpt-5.5 --routing dual_llm

# Single forward pass (no self-correction loop)
python main.py --model claude-sonnet-4-6 --single-pass

# Save results to a custom directory
python main.py --model claude-sonnet-4-6 --results-dir ./my_results
```

`main.py` is a thin launcher. Internally it invokes the experiment runner as a
module (with `PYTHONPATH=src`), e.g.:

```bash
python -m src.experiments.run_figma_slide_agentic_mcp_experiment \
    --model claude-sonnet-4-6 --channel channel_1 \
    --config-name single-figma-slide --routing dual_llm \
    --eval-file ./benchmark.json --cases 0 --auto \
    --max-iter 3 --threshold 4.0 --feedback-mode llm_distill
```

### 4d. CARE routing options

| Flag value | Description |
|---|---|
| `dual_llm` | Two-LLM routing: one classifies, one acts (default) |
| `auto` | Automatic single-LLM routing |
| `micro` | Force micro-spatial context (local slide view) |
| `macro` | Force macro-spatial context (full deck overview) |
| `systemic` | Force systemic context (cross-slide structure) |
| `full` | Pass complete presentation JSON (no routing) |
| `off` | Disable context reduction |

### 4e. Self-correction options

| Flag | Default | Description |
|---|---|---|
| `--max-iter` | `3` | Max self-correction iterations per case |
| `--threshold` | `4.0` | Stop early once the IF-judge score reaches this value |
| `--feedback-mode` | `llm_distill` | `verbatim` / `llm_distill` / `template` — how the judge's critique becomes next-iteration feedback |
| `--single-pass` | off | Disable self-correction (one forward pass) |

---

## 5. Code Structure

```
agentic-canvas-editor/
|
|---- main.py                        # Entry point (mock + live modes)
|---- benchmark.json                 # Case 108 benchmark definition
|---- requirements.txt               # Python dependencies
|---- config.env.example             # Template for API key configuration
|---- evaluate_figma_results.py      # In-loop IF + visual-quality judge harness
|
|---- execution_logs/                # Released logs for all 94 evaluable tasks
|   |---- README.md                  # Log format + what is / isn't included
|   `---- <CaseName>/
|       |---- history.json            # Turn-by-turn agent <-> LLM trace (all iterations)
|       `---- self_correct_history.json  # Per-iteration IF scores, feedback, timing, cost
|
|---- sample_output/
|   `---- case_108_history.json      # One annotated sample log (see Section 8)
|
`---- src/
    |---- config/
    |   |---- __init__.py             # Config loader (load_experiment_config)
    |   `---- expr/
    |       |---- single-figma-slide.yaml      # Model + channel definitions
    |       `---- single-figma-slide_xml.yaml  # XML-ablation variant
    |
    |---- experiments/                # Python agent orchestration
    |   |---- enums.py                # ModelType, Channel, AgentType enums
    |   |---- logger.py               # Structured experiment logger
    |   |---- base_runner.py          # BaseExperiment class, CLI arg parsing
    |   |---- care_router.py          # CARE routing: classify instruction -> context mode
    |   |---- care_context.py         # Context builders (micro/macro/systemic/full)
    |   |---- xml_converter.py        # SceneGraph <-> XML conversion (ablation)
    |   |---- run_figma_slide_mcp_experiment.py          # Single-pass runner
    |   |---- run_figma_slide_agentic_mcp_experiment.py  # Self-correcting runner (IF-judge loop)
    |   `---- run_figma_slide_xml_experiment.py          # XML-representation ablation runner
    |
    |---- mcp_client/                 # TypeScript: agent <-> Figma bridge
    |   |---- package.json
    |   |---- tsconfig.json
    |   `---- src/
    |       |---- app.ts              # Express server entry point
    |       |---- env_loader.ts       # Loads .env / config.env before other imports
    |       |---- types.ts            # Shared TypeScript types
    |       |---- agents/
    |       |   |---- agentInstance.ts        # Abstract agent base class
    |       |   |---- singleFigmaSlideAgent.ts  # Main agent (multi-turn LLM loop)
    |       |   `---- xmlFigmaSlideAgent.ts    # XML-representation agent (ablation)
    |       |---- models/
    |       |   |---- modelInstance.ts # Abstract LLM interface
    |       |   |---- anthropicModel.ts # Claude via Anthropic SDK
    |       |   |---- openaiModel.ts   # GPT via OpenAI SDK
    |       |   |---- googleModel.ts   # Gemini via Google GenAI SDK
    |       |   `---- bedrockModel.ts  # Claude via AWS Bedrock
    |       |---- utils/
    |       |   |---- prompts.ts       # System & user prompt templates
    |       |   |---- xml_prompts.ts   # Prompt templates for the XML ablation
    |       |   |---- xml_tools.ts     # XML tool definitions
    |       |   |---- batch_toggle.ts  # Batch-mode feature flag
    |       |   `---- helpers.ts       # Utility functions
    |       |---- core/
    |       |   |---- session.ts       # MCP session management
    |       |   `---- tools.ts         # Tool registry
    |       `---- routes/
    |           |---- modification.ts      # HTTP routes for agent requests
    |           |---- xml_modification.ts  # HTTP routes for the XML ablation
    |           `---- utility.ts           # Utility routes
    |
    |---- mcp_server/                 # TypeScript: canvas-editing tool implementations
    |   |---- package.json
    |   |---- tsconfig.json
    |   |---- server.ts               # MCP server entry point (WebSocket)
    |   |---- config.ts               # Server configuration
    |   |---- env_loader.ts           # Loads config.env before other imports
    |   |---- types.ts                # Shared types
    |   |---- common/                 # Shared utilities (websocket, math, layout)
    |   `---- tools/
    |       |---- chartTools.ts       # Chart creation and modification
    |       |---- dataChartTools.ts   # Data-driven chart generation
    |       |---- contentTools.ts     # Text and content operations
    |       |---- tableTools.ts       # Table operations
    |       |---- smartArtTools.ts    # SmartArt / diagram layouts
    |       |---- slideTools.ts       # Slide-level operations
    |       |---- importExportTools.ts # JSON import/export (Figma <-> agent)
    |       |---- batchTools.ts       # Batched tool execution
    |       |---- connectionTools.ts  # Channel / connection management
    |       |---- mathTools.ts        # Geometry helpers
    |       `---- unsplashTools.ts    # Stock-image lookup
    |
    `---- figma_plugin/               # Figma Slides plugin (runs inside Figma desktop app)
        |---- manifest.json           # Plugin manifest (editor type: slides, network: ws)
        |---- package.json
        |---- tsconfig.json
        |---- src/
        |   |---- code.ts             # Plugin main thread: receives WS messages, calls Figma API
        |   |---- ui.html             # Plugin UI panel (connection status, logs)
        |   |---- bridge.ts           # WebSocket <-> Figma API message bridge
        |   |---- handlers/           # Per-tool handler functions (chart, text, layout...)
        |   `---- autolayout/         # Auto-layout helpers for Figma frames
        `---- dist/                   # Pre-built plugin (ready to load without npm build)
            |---- code.js
            |---- ui.html
            `---- manifest.json
```

### Key data flow

```
User instruction
      |
      v
[Python: care_router.py]        -- classify instruction -> routing mode
      |
      v
[Python: care_context.py]       -- build compressed canvas context JSON
      |
      v
[Python: run_figma_slide_agentic_mcp_experiment.py]   <--------------------+
      |  HTTP POST /run-agent                                              |
      v                                                                    |
[TypeScript: mcp_client/src/app.ts]                                        |
      |  multi-turn LLM loop (singleFigmaSlideAgent.ts)                    |
      v                                                                    |
[LLM API]  <-->  [MCP tools]  <-->  [mcp_server]                           |
                                          |  WebSocket client              |
                                          v                                |
                               [socket_server (ws://localhost:3055)]       |
                               (central relay hub)                         |
                                          |  WebSocket client              |
                                          v                                |
                               [figma_plugin/src/code.ts]                  |
                               (runs inside Figma Slides)                  |
                                          |  Figma Plugin API              |
                                          v                                |
                                   [Figma Canvas]                          |
      |                                                                    |
      v                                                                    |
[Python: evaluate_figma_results.py]  -- in-loop IF judge scores result     |
      |                                                                    |
      +-- IF < threshold? distill feedback -> next iteration ---------------+
      |
      v   (IF >= threshold, or max-iter reached)
Result JSON  +  history JSON  +  self_correct_history.json
```

---

## 6. Reproducing Paper Results

> **Note**: Full reproduction requires Figma API credentials, LLM API keys, and
> your own Figma Slides decks (the benchmark decks are not bundled here).
> The mock mode lets reviewers verify the pipeline logic without any of these.

### Verify pipeline logic (no credentials needed)

```bash
python main.py --mock
```

### Inspect the released execution logs

`execution_logs/` contains the logs for all **94 evaluable tasks** (Section 8),
and `sample_output/case_108_history.json` is one annotated sample. The cost and
timing numbers reported in the paper are computed directly from the
`self_correct_history.json` files (`totals_usd`, `inference_sec`, `judge_sec`).
For example, to reproduce the mean per-case cost:

```bash
python - <<'EOF'
import json, glob
costs = []
for p in glob.glob("execution_logs/*/self_correct_history.json"):
    costs.append(json.load(open(p))["totals_usd"]["total_cost"])
print(f"{len(costs)} cases, mean total cost ${sum(costs)/len(costs):.3f}/case")
EOF
```

The sample log `sample_output/case_108_history.json` contains the complete,
unmodified turn-by-turn conversation between the agent and the LLM for Case
108, including all tool calls and tool responses.

```bash
python - <<'EOF'
import json
with open("sample_output/case_108_history.json") as f:
    history = json.load(f)
print(f"Total turns: {len(history)}")
for i, msg in enumerate(history):
    role = msg["role"]
    content = msg["content"]
    if isinstance(content, list):
        for c in content:
            if c.get("type") == "text":
                print(f"\n--- Turn {i} [{role}] ---")
                print(c["text"][:500])
                break
EOF
```

### Run with real credentials

```bash
# 1. Fill in config.env (see Section 4a)
# 2. Start MCP services (see Section 4b)
# 3. Connect the Figma Plugin to a Figma Slides file
# 4. Point --eval-file at a benchmark JSON describing your case(s)

python main.py --model claude-sonnet-4-6 --routing dual_llm --max-iter 3
```

Results are saved to `results/figma_slide_benchmark_<model>-ours-agentic/<case>/`:
- `*-history.json` — full agent conversation log
- `*-result.json` — final canvas state and metadata
- `self_correct_history.json` — per-iteration IF scores, feedback, and usage/cost
- `iter_snapshots/iter_N/` — canvas snapshots saved after each iteration

---

## 7. Self-Correction Loop and IF Judge

The agentic runner
(`src/experiments/run_figma_slide_agentic_mcp_experiment.py`) wraps the
single-pass agent in a self-correction loop:

1. **Iteration N.** The agent edits the canvas through MCP tool calls.
2. **IF judge.** `evaluate_figma_results.judge_instruction_following` scores how
   well the *cumulative* canvas state satisfies the instruction (0–5). The judge
   compares the original deck against the current state, exactly as the
   non-agentic baseline is judged.
3. **Stop or continue.** If the score is `>= --threshold` (default `4.0`) or
   `--max-iter` is reached, the loop stops. Otherwise the judge's critique is
   turned into concise actionable feedback (`--feedback-mode`, default
   `llm_distill` distills the critique with a small model) and iteration `N+1`
   runs **on top of the current canvas** (no reset). The Figma plugin's snapshot
   mechanism naturally continues from the previous iteration's state.

Per-iteration token usage and wall-clock for both the agent and the IF judge are
recorded (`self_correct_history.json`, `iter_snapshots/iter_N/`), which is what
the paper's cost/timing tables are computed from.

`evaluate_figma_results.py` is the full evaluation harness; the self-correction
loop only calls its `judge_instruction_following` entry point. The same file also
implements the visual-quality (VQ) metric used in the paper's offline evaluation.

---

## 8. Execution Logs

The benchmark is released **with execution logs**: `execution_logs/` holds one
sub-directory per evaluable task (**94 cases**), produced by the self-correcting
agent with the `claude-sonnet-4-6` backbone (CARE `dual_llm` routing,
`max_iter = 3`). See `execution_logs/README.md` for the full format.

```
execution_logs/<CaseName>/
  history.json                # turn-by-turn agent <-> LLM trace, ALL iterations
  self_correct_history.json   # per-iter IF scores, distilled feedback, timing, cost
```

`history.json` is *what the agent did*; `self_correct_history.json` is *what the
IF judge decided* — the latter records `iters_run`, `final_IF`, per-iteration
`inference_sec` / `judge_sec`, and a `totals_usd` breakdown
(`agent_cost` + `if_judge_cost` + `distill_cost` + `care_router_cost`). Across
the 94 cases the loop ran 1 / 2 / 3 iterations for 61 / 21 / 12 cases (33 cases
triggered at least one self-correction). Heavy reproduction artifacts (raw
provider payloads, per-iteration PNG renders, full canvas-structure dumps) are
intentionally omitted; see `execution_logs/README.md`.

### Annotated sample

`sample_output/case_108_history.json` is one such log produced by running the
agent on Case 108 (GPT backbone). It contains 6 turns:

| Turn | Role | Type | Description |
|------|------|------|-------------|
| 0 | user | user_request | Instruction + slide 2 image (base64) |
| 1 | assistant | agent_request | LLM reasoning + first tool call |
| 2 | tool | tool_response | MCP tool result (canvas state read) |
| 3 | assistant | agent_request | LLM plans chart creation, calls tool |
| 4 | tool | tool_response | Chart and legend created |
| 5 | assistant | agent_request | LLM confirms task completion |

Each message has the schema:
```json
{
  "id": "unique-message-id",
  "timestamp": "2025-XX-XXTXX:XX:XX.XXXZ",
  "type": "user_request | agent_request | tool_response",
  "role": "user | assistant | tool",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image", "mimeType": "image/png", "data": "<base64>" }
  ]
}
```

---

## 9. License

- **Code** in this repository is released under the **Apache License 2.0** — see
  [`LICENSE`](LICENSE).
- The accompanying **benchmark dataset** (released separately) is distributed
  under **CC BY 4.0**. The underlying slide designs originate from the Figma
  Community, whose free files default to CC BY 4.0; attribution to the original
  creators is required when redistributing or building upon the data.
- API keys are not included; `config.env.example` shows only placeholder values.
  Internal service URLs default to `localhost` and cloud project identifiers are
  placeholders — set your own in `config.env` for live mode.

---

## Citation

This work was **accepted at the EMNLP 2026 Industry Track**.

> **Archive URL / DOI:** _to be updated_ (`xxx.archive` — placeholder; the paper
> link will be added once available).

If you use this code or the benchmark, please cite:

```bibtex
@inproceedings{agentic-canvas-editor-2026,
  title     = {Agentic Slide Editing via Structured Canvas Representation with Self-Correction},
  author    = {MIRIDIH},
  booktitle = {Proceedings of the 2026 Conference on Empirical Methods in Natural Language Processing: Industry Track (EMNLP 2026)},
  year      = {2026},
  note      = {Archive URL to be updated},
  url       = {xxx.archive}
}
```

<!-- TODO: fill in author list and final archive/DOI URL once available. -->

For questions about running this code, please open an issue on this repository.
