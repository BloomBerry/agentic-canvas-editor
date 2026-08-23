# Execution Logs

This directory holds the **released execution logs** for the benchmark: one
sub-directory per evaluable task (**94 cases**), produced by the self-correcting
agent (`run_figma_slide_agentic_mcp_experiment.py`).

- **Backbone model:** `claude-sonnet-4-6` (the representative configuration with
  full-benchmark coverage). The other backbones in the paper (`gpt-5.5`,
  `gemini-3.5-flash`) were run on the comparison subset.
- **Routing / loop:** CARE `dual_llm` routing, self-correction with
  `max_iter = 3`. Across the 94 cases the loop ran 1 / 2 / 3 iterations for
  61 / 21 / 12 cases respectively (33 cases triggered at least one correction).

## Per-case files

```
execution_logs/
  <CaseName>/
    history.json                # turn-by-turn agent <-> LLM trace, all iterations
    self_correct_history.json   # self-correction loop record (see below)
```

### `history.json`
An ordered list of turn messages spanning **all** self-correction iterations of
the case. Each message follows the schema documented in the top-level
`README.md`, Section 8 (`user_request` / `agent_request` / `tool_response`,
with text and—where present—base64 slide images). This is *what the agent did*:
its reasoning and every MCP tool call/result.

### `self_correct_history.json`
The per-case self-correction record. This is *what the IF judge decided* and is
the source of the paper's cost/timing tables:

| Field | Meaning |
|---|---|
| `case_name`, `max_iter`, `threshold`, `feedback_mode` | run configuration |
| `iters_run`, `final_IF` | iterations executed and final instruction-following score |
| `history[]` | per-iteration record: `IF`, `inference_sec`, `judge_sec`, distilled `feedback`, token `usage` |
| `care_router_usage` | one-shot CARE router cost/latency |
| `totals_usd` | `agent_cost` + `if_judge_cost` + `distill_cost` + `care_router_cost` = `total_cost` |

## What is **not** included (and why)

To keep the release log-sized, the heavy per-case reproduction artifacts are
omitted: `*-raw-response.json` (~10–20 MB of raw provider payloads with embedded
images), `snapshots/` (per-iteration PNG renders + full canvas structure JSON,
tens of MB), and intermediate `*-structure.json`. These are rendering /
reproduction data, not execution logs; the agent's behavior and the
self-correction decisions are fully captured by the two files above.
