/**
 * Ablation toggle for the agent's tool-calling strategy. Three modes:
 *
 *   1. BATCH      (default — both env vars unset)
 *      - batch_execute tool is registered server-side.
 *      - Prompts encourage batching N ops into a single batch_execute call.
 *
 *   2. PARALLEL   (DISABLE_BATCH_EXECUTE=1)
 *      - batch_execute tool is NOT registered.
 *      - Prompts encourage emitting N parallel tool_calls in a single response
 *        (relies on the model's native parallel function calling capability).
 *
 *   3. SEQUENTIAL (SEQUENTIAL_MODE=1)
 *      - batch_execute tool is NOT registered.
 *      - Prompts force one tool call per response — the "stop-and-wait"
 *        traditional agent pattern that the ECCV reviewer compares against.
 *      - Multi-turn loop drives progress one operation at a time.
 *
 * Priority when both env vars are set: SEQUENTIAL_MODE wins over
 * DISABLE_BATCH_EXECUTE (sequential is strictly more restrictive).
 *
 * Read once at module load; safe because dotenv (via env_loader.ts) is invoked
 * before any prompt module is imported.
 */
export type AgentMode = "batch" | "parallel" | "sequential";
export declare const AGENT_MODE: AgentMode;
export declare const BATCH_DISABLED: boolean;
export declare const SEQUENTIAL_MODE: boolean;
export declare const PARALLEL_MODE: boolean;
//# sourceMappingURL=batch_toggle.d.ts.map