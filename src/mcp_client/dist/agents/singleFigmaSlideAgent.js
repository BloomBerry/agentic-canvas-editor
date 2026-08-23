"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleFigmaSlideAgent = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../types");
const agentInstance_1 = require("./agentInstance");
const helpers_1 = require("../utils/helpers");
const prompts_1 = require("../utils/prompts");
class SingleFigmaSlideAgent extends agentInstance_1.AgentInstance {
    /**
     * Agentic modification for Figma Slides presentations.
     *
     * Each turn starts with a FRESH context:
     *   Turn 1: original image + prompt
     *   Turn 2+: re-captured image + prompt + previous turn summary
     *
     * This prevents context window overflow from accumulated tool results
     * and avoids paying image tokens for stale images every turn.
     */
    async run(params) {
        helpers_1.logger.info({
            header: "Figma Slide Agent Started",
            body: `Model: ${params.model.modelName}, Provider: ${params.model.modelProvider}, Max Turns: ${this.maxTurns}, Max Calls: ${this.maxCalls}`,
        });
        let turn = 0;
        let cost = 0;
        const formattedMessageContext = [];
        const rawResponses = [];
        const snapshots = [];
        // Step 1: Import the base JSON into Figma Slides.
        // When skipImport=true (agentic self-correction iter ≥ 2), preserve the
        // canvas state from the prior iter (Pattern B) instead of resetting.
        if (params.skipImport) {
            helpers_1.logger.info({
                header: "Skipping base JSON import (skipImport=true)",
                body: "Pattern B: canvas retains state from previous iter",
            });
        }
        else {
            helpers_1.logger.info({ header: "Importing base JSON into Figma Slides..." });
            const importResult = await (0, helpers_1.importJsonToFigma)(params.tools, params.baseJsonString, params.imageData, params.targetSlideIndices);
            helpers_1.logger.info({
                header: "Base JSON imported successfully",
                body: `Created ${importResult.slideCount} slide(s): ${importResult.slideIds.join(", ")}`,
            });
        }
        // Step 2: Get live node structure (import_json may reassign node IDs).
        let liveStructureText = "";
        try {
            liveStructureText = await (0, helpers_1.getLoadedPageStructureDescription)(params.tools);
            helpers_1.logger.info({
                header: "Live page structure captured after import",
                body: `${liveStructureText.length} chars`,
            });
        }
        catch (err) {
            helpers_1.logger.warn({
                header: "Could not get live page structure after import",
                body: err.message,
            });
        }
        // Step 1b: Capture initial Plugin JSON BEFORE any modifications.
        // This provides a Plugin-schema baseline for accurate diff comparison.
        const initialSnapshot = await this.captureSnapshot(params.tools, params.metadata.caseId, 0, // turn 0 = initial state
        []);
        snapshots.push(initialSnapshot);
        helpers_1.logger.info({
            header: "Initial Plugin JSON captured (turn 0)",
            body: "Saved pre-modification state for evaluation baseline",
        });
        // Extract the original prompt text from the request message.
        let originalPromptText = params.requestMessage.content
            .filter((c) => c.type === types_1.ContentType.TEXT)
            .map((c) => c.text)
            .join("\n");
        // Inject live node structure so the LLM uses correct IDs after import.
        if (liveStructureText) {
            const structureSuffix = `\n\n---\nLoaded document structure (use these node IDs in your tool calls):\n${liveStructureText}`;
            originalPromptText += structureSuffix;
            const textItems = params.requestMessage.content.filter((c) => c.type === types_1.ContentType.TEXT);
            if (textItems.length > 0) {
                textItems[textItems.length - 1].text += structureSuffix;
            }
        }
        // Prepare the tool list for the LLM.
        const toolsArray = params.model.formatToolList(Array.from(params.tools.catalogue.values()));
        // Outer loop: each turn gets a fresh API context (context reset).
        // Inner loop: within a turn, LLM can make multiple calls (e.g. focus_slide → modify)
        //             with accumulating context.
        let allToolResults = [];
        let totalLLMCalls = 0;
        const allTurnSummaries = [];
        const allToolRequests = [];
        outer: while (turn < this.maxTurns) {
            turn++;
            // ── Build fresh context for this turn ──
            const apiMessageContext = params.model.createMessageContext();
            const turnToolRequests = [];
            const turnToolResults = [];
            let contextOverflow = false;
            let turnLLMCalls = 0;
            if (turn === 1) {
                apiMessageContext.push(...params.model.formatRequest([params.requestMessage]));
                formattedMessageContext.push(params.requestMessage);
            }
            else {
                // Re-capture images on Turn 2+ if:
                // - The original request included images (CARE mode), OR
                // - The LLM called image tools in previous turns (routing-off mode)
                const hadImageOnTurn1 = params.requestMessage.content.some((c) => c.type === types_1.ContentType.IMAGE);
                const IMAGE_TOOLS = ["export_slide_image", "get_result_image"];
                const usedImageTools = allToolRequests.some((r) => IMAGE_TOOLS.includes(r.name));
                const skipImages = !hadImageOnTurn1 && !usedImageTools;
                const updatedMessage = await this.buildUpdatedMessage(params.tools, originalPromptText, allTurnSummaries.join("\n\n"), skipImages, params.routingMode, params.rawInstruction);
                apiMessageContext.push(...params.model.formatRequest([updatedMessage]));
                formattedMessageContext.push(updatedMessage);
            }
            helpers_1.logger.info({
                header: `Turn ${turn}/${this.maxTurns}`,
                body: turn > 1
                    ? `[Context reset] With re-captured image + action summary:\n${allTurnSummaries.join("\n\n")}`
                    : undefined,
            });
            // ── Inner loop: multiple LLM calls within same context ──
            while (totalLLMCalls < this.maxCalls) {
                totalLLMCalls++;
                turnLLMCalls++;
                helpers_1.logger.info({
                    header: `Turn ${turn} / LLM call ${turnLLMCalls} - requesting tool calls`,
                });
                let modelResponse;
                try {
                    // Pin OpenAI's implicit prompt-cache routing to a stable per-case
                    // key so within-case turns hit the same backend shard. Without it
                    // gpt-5.5 ours achieves 0% cache hit (claude/gemini are OK because
                    // they use explicit/built-in caching). Anthropic/Gemini adapters
                    // ignore unknown options.
                    modelResponse = await params.model.generateResponseWithTool(apiMessageContext, toolsArray, { prompt_cache_key: params.metadata.caseId });
                }
                catch (err) {
                    const errMsg = err?.message ?? String(err);
                    if (errMsg.includes("context window") ||
                        errMsg.includes("token limit") ||
                        errMsg.includes("maximum context length")) {
                        helpers_1.logger.warn({
                            header: `[Context overflow] Turn ${turn} — resetting context for next turn`,
                            body: errMsg,
                        });
                        contextOverflow = true;
                        break;
                    }
                    throw err; // re-throw non-context errors
                }
                rawResponses.push(modelResponse);
                cost += params.model.getCostFromResponse(modelResponse);
                params.model.addToApiMessageContext(modelResponse, apiMessageContext);
                params.model.addToFormattedMessageContext(modelResponse, types_1.MessageType.AGENT_REQUEST, formattedMessageContext);
                const callToolRequests = params.model.formatCallToolRequest(modelResponse);
                // No tool calls → check if LLM dumped tool calls as text (soft overflow)
                if (!callToolRequests || callToolRequests.length === 0) {
                    const outputText = modelResponse.output_text ?? "";
                    const hasTextToolCalls = outputText.includes("focus_slide") ||
                        outputText.includes('"tool_calls"') ||
                        outputText.includes('"function_call"') ||
                        outputText.includes('"recipient_name"') ||
                        outputText.includes('"functions.') ||
                        outputText.includes('"operations"') ||
                        outputText.includes("batch_execute") ||
                        outputText.includes("move_node") ||
                        outputText.includes("resize_node") ||
                        outputText.includes("set_text_content");
                    if (hasTextToolCalls && allToolResults.length > 0) {
                        // Check if this turn already had successful tool calls —
                        // if so, the text is likely an echo/recap, not a real overflow.
                        const turnAllSucceeded = turnToolResults.length > 0 &&
                            !this.detectPartialFailures(turnToolResults);
                        const isEcho = this.isEchoOfPreviousCalls(outputText, turnToolRequests);
                        if (turnAllSucceeded || isEcho) {
                            helpers_1.logger.info({
                                header: `[Soft overflow suppressed] Turn ${turn} — LLM echoed tool calls as text after successful execution`,
                                body: `Turn had ${turnToolResults.length} successful tool call(s). Treating as normal completion.`,
                            });
                            // Not an overflow — just the LLM echoing what it did. Break inner loop normally.
                            break;
                        }
                        helpers_1.logger.warn({
                            header: `[Soft context overflow] Turn ${turn} — LLM returned tool calls as text, not structured`,
                            body: `Treating as context overflow for context reset`,
                        });
                        contextOverflow = true;
                        break;
                    }
                    if (allToolResults.length === 0 && turnToolResults.length === 0) {
                        helpers_1.logger.warn({
                            header: `No tool calls on turn ${turn} — LLM produced nothing`,
                        });
                    }
                    else {
                        helpers_1.logger.info({
                            header: `No more tool calls — LLM finished on turn ${turn}`,
                        });
                    }
                    break;
                }
                // Execute tool calls
                const toolResults = [];
                for (const toolCall of callToolRequests) {
                    toolResults.push(await params.tools.callTool(toolCall));
                }
                turnToolRequests.push(...callToolRequests);
                turnToolResults.push(...toolResults);
                allToolRequests.push(...callToolRequests);
                allToolResults.push(...toolResults);
                // Add results to apiMessageContext (Gemini needs all responses in one message)
                for (const msg of params.model.formatToolResponses(toolResults)) {
                    apiMessageContext.push(msg);
                }
                this.addToolResultsToFormattedContext(toolResults, formattedMessageContext);
                helpers_1.logger.info({
                    header: `Turn ${turn} / LLM call ${turnLLMCalls} completed`,
                    body: `Tool calls: ${toolResults.length}, Turn total: ${turnToolResults.length}`,
                });
            }
            // ── End of turn: build summary, capture snapshot ──
            if (turnToolResults.length > 0) {
                allTurnSummaries.push(`[Turn ${turn}]\n` +
                    this.buildTurnSummary(turnToolRequests, turnToolResults));
                const hasModification = turnToolRequests.some((c) => c.name !== "focus_slide");
                if (hasModification) {
                    const turnSnapshot = await this.captureSnapshot(params.tools, params.metadata.caseId, turn, turnToolResults);
                    snapshots.push(turnSnapshot);
                }
            }
            helpers_1.logger.info({
                header: `Turn ${turn} finished`,
                body: `Turn tool calls: ${turnToolResults.length}, Total: ${allToolResults.length}`,
            });
            // Detect partial failures (direct errors or failed ops inside batch_execute)
            const hasPartialFailures = this.detectPartialFailures(turnToolResults);
            if (hasPartialFailures) {
                helpers_1.logger.warn({
                    header: `[Partial failures] Turn ${turn} had failed operations — will retry on next turn`,
                });
            }
            // Context overflow or partial failures → continue to next turn with fresh context.
            // Otherwise, exit after this turn.
            if (!contextOverflow && !hasPartialFailures) {
                break outer;
            }
            helpers_1.logger.info({
                header: `Continuing to turn ${turn + 1} with context reset`,
                body: contextOverflow ? "Reason: context overflow" : "Reason: partial failures need retry",
            });
        }
        if (turn >= this.maxTurns) {
            helpers_1.logger.warn({ header: `Reached max turns (${this.maxTurns})` });
        }
        // Use the last snapshot for the final result, or capture one if none exist
        let lastSnapshot;
        if (snapshots.length > 0) {
            lastSnapshot = snapshots[snapshots.length - 1];
        }
        else {
            lastSnapshot = await this.captureSnapshot(params.tools, params.metadata.caseId, 0, []);
            snapshots.push(lastSnapshot);
        }
        const resultImageUri = lastSnapshot.image_uri ?? "";
        const resultImageUris = lastSnapshot.image_uris ?? [];
        const pageStructure = lastSnapshot.structure ?? {};
        return {
            case_id: params.metadata.caseId,
            history: formattedMessageContext,
            responses: rawResponses,
            json_structure: pageStructure,
            image_uri: resultImageUri,
            image_uris: resultImageUris,
            turn,
            snapshots,
            cost: cost / 1000,
        };
    }
    /**
     * Build a fresh UserRequestMessage for Turn 2+ with:
     * - Re-exported scene graph JSON (current canvas state)
     * - Re-captured slide images (current canvas state)
     * - Original prompt text (fallback if export fails)
     * - Summary of previous turn results
     */
    async buildUpdatedMessage(tools, originalPromptText, turnSummary, skipImages = false, routingMode, rawInstruction) {
        // Attempt to refresh scene graph context from Figma (skeleton for token efficiency)
        let promptText = originalPromptText;
        if (routingMode && rawInstruction) {
            try {
                const freshJson = await (0, helpers_1.exportJsonFromFigma)(tools);
                const freshSlideCount = (0, helpers_1.countSlidesFromExportedJson)(freshJson);
                // Use skeleton extraction for Turn 2+ to reduce tokens
                const skeleton = (0, helpers_1.extractSkeletonFromExportedJson)(freshJson);
                const skeletonJsonString = JSON.stringify(skeleton);
                helpers_1.logger.info({
                    header: "[Context Refresh] Exported skeleton JSON for Turn 2+",
                    body: `Slides: ${freshSlideCount}, Skeleton size: ${skeletonJsonString.length} bytes`,
                });
                // Always use macro_programmatic prompt for Turn 2+ skeleton context
                promptText = (0, prompts_1.getPromptForMode)("macro_programmatic", rawInstruction, skeletonJsonString, freshSlideCount);
            }
            catch (err) {
                helpers_1.logger.warn({
                    header: "[Context Refresh] Failed to export fresh JSON, using original prompt",
                    body: err.message,
                });
            }
        }
        const continuationRules = `
**IMPORTANT: Continuation Rules**
- The document skeleton above reflects the CURRENT state after previous turns.
- Do NOT re-execute operations that already succeeded (listed in Previous Turn Result).
- Only perform operations that are still INCOMPLETE or FAILED.
- Slide numbers in the original instruction refer to the ORIGINAL slide order, not the current order. Cross-reference with the current document skeleton to identify correct node IDs.
- If all tasks from the instruction are already reflected in the current document state, do not generate any tool calls.`;
        const content = [
            {
                type: types_1.ContentType.TEXT,
                text: `${promptText}\n\n**Previous Turn Result**\n${turnSummary}\n${continuationRules}`,
            },
        ];
        // Re-capture current slide images from Figma (skip in off mode)
        // Resize more aggressively on Turn 2+ to save tokens
        if (!skipImages) {
            const imageUris = await this.captureSlideImages(tools);
            for (const uri of imageUris) {
                let data = uri;
                try {
                    const raw = uri.replace(/^data:image\/\w+;base64,/, "");
                    const reduced = await (0, helpers_1.reduceBase64Image)(raw, "image/png", 512);
                    data = reduced.base64;
                }
                catch {
                    // use original if resize fails
                }
                content.push({
                    type: types_1.ContentType.IMAGE,
                    data,
                    mimeType: "image/png",
                });
            }
        }
        return {
            id: (0, crypto_1.randomUUID)(),
            timestamp: Date.now(),
            type: types_1.MessageType.USER_REQUEST,
            role: types_1.RoleType.USER,
            content,
        };
    }
    /**
     * Capture current slide images from Figma canvas.
     */
    async captureSlideImages(tools) {
        const imageUris = [];
        try {
            const slidesInfo = await (0, helpers_1.getAllSlides)(tools);
            const slideNodes = slidesInfo?.slides ?? slidesInfo ?? [];
            if (Array.isArray(slideNodes) && slideNodes.length > 0) {
                for (const slide of slideNodes) {
                    try {
                        const uri = await (0, helpers_1.exportSlideImage)(tools, slide.id);
                        imageUris.push(uri);
                    }
                    catch (err) {
                        helpers_1.logger.warn({
                            header: `Could not export image for slide ${slide.name ?? slide.id}`,
                            body: err.message,
                        });
                    }
                }
            }
        }
        catch (err) {
            helpers_1.logger.warn({
                header: "Could not get slides list for re-capture",
                body: err.message,
            });
        }
        // Fallback: export current slide
        if (imageUris.length === 0) {
            try {
                const uri = await (0, helpers_1.exportSlideImage)(tools);
                imageUris.push(uri);
            }
            catch (err) {
                helpers_1.logger.warn({
                    header: "Could not export slide image for re-capture",
                    body: err.message,
                });
            }
        }
        return imageUris;
    }
    /**
     * Build a concise summary of tool results for the next turn's context.
     */
    buildTurnSummary(callToolRequests, toolResults) {
        const succeeded = toolResults.filter((r) => !r.isError);
        const failed = toolResults.filter((r) => r.isError);
        let summary = `${succeeded.length}/${toolResults.length} tool calls succeeded.`;
        // List what was executed so the LLM knows what's already done
        summary += "\nExecuted operations:";
        for (const req of callToolRequests) {
            const argJson = JSON.stringify(req.arguments ?? {});
            const argStr = req.name === "batch_execute" ? argJson : argJson.slice(0, 150);
            summary += `\n- ${req.name}(${argStr})`;
        }
        // Surface individual failures inside batch_execute results
        const batchFailures = [];
        for (const result of succeeded) {
            try {
                const text = result.content?.map((c) => c.text).join("") ?? "";
                const parsed = JSON.parse(text);
                if (parsed?.results && Array.isArray(parsed.results)) {
                    for (const op of parsed.results) {
                        if (!op.success && op.error) {
                            batchFailures.push(`${op.command}: ${op.error}`);
                        }
                    }
                }
            }
            catch {
                // not a batch result, skip
            }
        }
        if (batchFailures.length > 0) {
            summary += `\n\nPartial failures inside batch_execute (${batchFailures.length} operations failed):`;
            summary += "\n⚠️ These node IDs may be stale — call get_all_slides to refresh before retrying.";
            for (const bf of batchFailures) {
                summary += `\n- ${bf}`;
            }
        }
        if (failed.length > 0) {
            summary += "\n\nFailed operations (need retry):";
            for (const f of failed) {
                const errorText = f.content
                    ?.map((c) => c.text)
                    .join(" ")
                    .slice(0, 200);
                summary += `\n- ${f.name ?? "unknown"}: ${errorText}`;
            }
        }
        if (failed.length === 0 && batchFailures.length === 0) {
            summary +=
                "\n\nAll operations succeeded. If the task is complete, do not generate any more tool calls.";
        }
        return summary;
    }
    async captureSnapshot(tools, caseId, turn, toolResults) {
        const imageUris = await this.captureSlideImages(tools);
        if (imageUris.length > 0) {
            helpers_1.logger.info({
                header: `[Snapshot turn ${turn}] Exported ${imageUris.length} slide image(s)`,
            });
        }
        let structure = {};
        try {
            structure = await (0, helpers_1.exportJsonFromFigma)(tools);
        }
        catch (err) {
            helpers_1.logger.warn({
                header: "Could not export JSON for snapshot",
                body: err.message,
            });
            try {
                structure = await (0, helpers_1.getSlidePageInfo)(tools);
            }
            catch {
                // ignore
            }
        }
        return {
            case_id: caseId,
            init: turn <= 1,
            turn,
            image_uri: imageUris[0] ?? "",
            image_uris: imageUris,
            structure,
            toolResults,
        };
    }
    /**
     * Add tool results to formatted context for experiment logging only.
     * (API context is managed per-turn in the main loop.)
     */
    addToolResultsToFormattedContext(toolResults, formattedMessageContext) {
        formattedMessageContext.push({
            id: (0, crypto_1.randomUUID)(),
            timestamp: Date.now(),
            role: types_1.RoleType.TOOL,
            type: types_1.MessageType.TOOL_RESPONSE,
            content: toolResults.map((result) => ({
                type: types_1.ContentType.TEXT,
                text: result.content.map((c) => c.text).join("\n"),
            })),
            results: toolResults,
        });
    }
    /**
     * Check whether any tool results contain failures — either direct isError
     * results or partial failures inside batch_execute responses.
     */
    detectPartialFailures(turnToolResults) {
        for (const result of turnToolResults) {
            // Direct tool error
            if (result.isError)
                return true;
            // Check inside batch_execute results for partial failures.
            // Content may have multiple text parts (human message + JSON),
            // so try parsing each part individually instead of joining.
            for (const part of (result.content ?? [])) {
                try {
                    const parsed = JSON.parse(part.text ?? "");
                    if (parsed?.results && Array.isArray(parsed.results)) {
                        if (parsed.results.some((op) => !op.success))
                            return true;
                    }
                }
                catch {
                    // Not a JSON part — skip
                }
            }
        }
        return false;
    }
    /**
     * Check whether text output is just an echo/recap of previously executed
     * tool calls (not a genuine context overflow).
     *
     * Returns true if the text mentions tool names that were already executed
     * in this turn and does NOT introduce new, unexecuted tool names.
     */
    isEchoOfPreviousCalls(outputText, previousRequests) {
        if (previousRequests.length === 0)
            return false;
        // Tool names that appeared in previous requests this turn
        const executedNames = new Set(previousRequests.map((r) => r.name));
        // All known tool-like tokens in the text
        const knownToolPatterns = [
            "batch_execute", "focus_slide", "move_node", "resize_node",
            "set_text_content", "set_text_font", "set_fill_color",
            "set_text_decoration", "create_text", "create_frame",
            "create_rectangle", "delete_node", "delete_slide",
            "reparent_node", "create_table_from_data", "reorder_slides",
        ];
        const mentionedTools = knownToolPatterns.filter((t) => outputText.includes(t));
        if (mentionedTools.length === 0)
            return false;
        // If every mentioned tool was already executed → echo
        const hasNewTool = mentionedTools.some((t) => !executedNames.has(t));
        return !hasNewTool;
    }
}
exports.SingleFigmaSlideAgent = SingleFigmaSlideAgent;
//# sourceMappingURL=singleFigmaSlideAgent.js.map