"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runModification = void 0;
const crypto_1 = require("crypto");
const prompts_1 = require("../utils/prompts");
const helpers_1 = require("../utils/helpers");
const types_1 = require("../types");
const agents_1 = require("../agents");
const session_1 = require("../core/session");
const models_1 = require("../models");
const requireTools = () => {
    const tools = session_1.globalSession.state.tools;
    if (!tools)
        throw new Error("Tools are not loaded in the session.");
    return tools;
};
const parseMetadata = (raw) => {
    const metadata = JSON.parse(raw);
    if (typeof metadata.case_id !== "string")
        throw new Error("Missing or invalid value for 'case_id'");
    if (typeof metadata.model_provider !== "string")
        throw new Error("Missing or invalid value for 'model_provider'");
    if (typeof metadata.model_name !== "string")
        throw new Error("Missing or invalid value for 'model_name'");
    if (typeof metadata.agent_type !== "string")
        throw new Error("Missing or invalid value for 'agent_type'");
    if (typeof metadata.temperature !== "number")
        throw new Error("Missing or invalid value for 'temperature'");
    if (typeof metadata.input_cost !== "number")
        throw new Error("Missing or invalid value for 'input_cost'");
    if (typeof metadata.output_cost !== "number")
        throw new Error("Missing or invalid value for 'output_cost'");
    if (typeof metadata.max_turns !== "number")
        throw new Error("Missing or invalid value for 'max_turns'");
    if (typeof metadata.max_tokens !== "number")
        throw new Error("Missing or invalid value for 'max_tokens'");
    return metadata;
};
const getConfigFromMetadata = (metadata) => ({
    agentConfig: {
        agentType: metadata.agent_type,
        maxTurns: metadata.max_turns,
        maxCalls: metadata.max_calls,
        maxRetries: metadata.max_retries,
    },
    modelConfig: {
        modelProvider: metadata.model_provider,
        modelName: metadata.model_name,
        temperature: metadata.temperature,
        inputCost: metadata.input_cost,
        outputCost: metadata.output_cost,
        maxTokens: metadata.max_tokens,
        ...(metadata.thinking_level ? { thinkingLevel: metadata.thinking_level } : {}),
    },
});
const buildUserRequest = (instruction, image) => {
    const content = [
        { type: types_1.ContentType.TEXT, text: instruction },
    ];
    if (image) {
        content.push({
            type: types_1.ContentType.IMAGE,
            data: image.data,
            mimeType: image.mimeType,
        });
    }
    return {
        id: (0, crypto_1.randomUUID)(),
        timestamp: Date.now(),
        type: types_1.MessageType.USER_REQUEST,
        role: types_1.RoleType.USER,
        content,
    };
};
const runModification = async (req, res) => {
    try {
        const message = req.body.message;
        const baseJsonString = req.body.baseJsonString;
        // CARE routing fields (optional – backward-compatible)
        const contextJson = req.body.contextJson;
        const routingMode = req.body.routingMode || "full";
        // Selective import: 0-based slide indices that will be modified
        let targetSlideIndices;
        if (req.body.targetSlideIndices) {
            try {
                targetSlideIndices = typeof req.body.targetSlideIndices === 'string'
                    ? JSON.parse(req.body.targetSlideIndices)
                    : req.body.targetSlideIndices;
            }
            catch {
                helpers_1.logger.warn({ header: "Failed to parse targetSlideIndices, skipping selective import" });
            }
        }
        if (!message)
            throw new Error("No instruction provided.");
        const tools = requireTools();
        const metadata = parseMetadata(req.body.metadata);
        // Image is optional — CARE router may decide images are not needed
        let imagePayload;
        if (req.file) {
            const originalBase64Image = (0, helpers_1.base64Encode)(req.file.buffer);
            const mimeType = req.file.mimetype;
            const { base64 } = await (0, helpers_1.reduceBase64Image)(originalBase64Image, mimeType);
            imagePayload = { data: base64, mimeType };
        }
        else {
            helpers_1.logger.info({
                header: "[CARE] No image provided — text/JSON-only mode",
            });
        }
        // Count slides from baseJsonString (best-effort).
        // doc.document.children are CANVAS nodes (typically 1).
        // Actual slides live inside: CANVAS > SECTION > FRAME, or CANVAS > FRAME.
        let slideCount = 1;
        try {
            const doc = JSON.parse(baseJsonString);
            const canvas = doc?.document?.children?.[0];
            if (canvas?.children) {
                let count = 0;
                for (const child of canvas.children) {
                    const t = child.type;
                    if (t === "SLIDE") {
                        count++;
                    }
                    else if (t === "SECTION") {
                        count += (child.children || []).filter((c) => c.type === "FRAME" || c.type === "SLIDE").length;
                    }
                    else if (t === "FRAME") {
                        // Could be a direct slide, or a wrapper (e.g. Presentation > SLIDE_ROW > SLIDE)
                        const inner = (child.children || []).filter((c) => c.type === "SLIDE" || c.type === "SLIDE_ROW");
                        if (inner.length > 0) {
                            for (const row of child.children || []) {
                                if (row.type === "SLIDE")
                                    count++;
                                else if (row.type === "SLIDE_ROW") {
                                    count += (row.children || []).filter((c) => c.type === "SLIDE" || c.type === "FRAME").length;
                                }
                            }
                        }
                        else {
                            count++;
                        }
                    }
                    else if (t === "SLIDE_ROW") {
                        count += (child.children || []).filter((c) => c.type === "SLIDE" || c.type === "FRAME").length;
                    }
                }
                slideCount = count || 1;
            }
        }
        catch {
            // Use default slide count.
        }
        // Build the LLM prompt – use CARE-optimised context when available
        let instruction;
        if (routingMode === "off") {
            helpers_1.logger.info({
                header: "[CARE] Off mode — minimal prompt, LLM discovers context via tools",
            });
            instruction = (0, prompts_1.getMinimalPrompt)(message, slideCount);
        }
        else if (contextJson) {
            // Use CARE-prepared context (normalised bbox) for all modes including FULL.
            // For FULL mode, contextJson contains the same document but with
            // absoluteBoundingBox values normalised to slide-relative (0,0)-based coords.
            const effectiveMode = routingMode === "full" ? "full" : routingMode;
            helpers_1.logger.info({
                header: `[CARE] Using ${effectiveMode} mode prompt`,
                body: `contextJson size: ${contextJson.length} bytes`,
            });
            instruction = (0, prompts_1.getPromptForMode)(effectiveMode, message, contextJson, slideCount);
        }
        else {
            instruction = (0, prompts_1.getFigmaSlideModificationPrompt)(message, baseJsonString, slideCount);
        }
        const userRequest = buildUserRequest(instruction, imagePayload);
        const { agentConfig, modelConfig } = getConfigFromMetadata(metadata);
        const agent = (0, agents_1.createAgent)(agentConfig);
        const model = (0, models_1.createModel)(modelConfig);
        // Parse imageData if provided (imageRef → base64 PNG mapping)
        let imageData;
        if (req.body.imageData) {
            try {
                imageData =
                    typeof req.body.imageData === "string"
                        ? JSON.parse(req.body.imageData)
                        : req.body.imageData;
            }
            catch {
                helpers_1.logger.warn({ header: "Failed to parse imageData, skipping" });
            }
        }
        // Agentic self-correction: skipImport=true preserves canvas state from
        // the prior iter (Pattern B). Sent as form field "skipImport" = "true".
        const skipImport = String(req.body.skipImport ?? "").toLowerCase() === "true";
        if (skipImport) {
            helpers_1.logger.info({ header: "skipImport=true (Pattern B; canvas state preserved)" });
        }
        const result = await agent.run({
            requestMessage: userRequest,
            tools,
            model,
            baseJsonString,
            metadata: { caseId: metadata.case_id },
            imageData,
            targetSlideIndices,
            routingMode,
            rawInstruction: message,
            skipImport,
        });
        res.json({
            status: types_1.ResponseStatus.SUCCESS,
            message: "Generation successful",
            payload: {
                history: result.history,
                responses: result.responses,
                cost: result.cost,
                json_structure: result.json_structure,
                image_uri: result.image_uri,
                image_uris: result.image_uris,
                case_id: result.case_id,
                snapshots: result.snapshots,
                turn: result.turn,
                routing_mode: routingMode,
            },
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in runModification",
            body: error instanceof Error ? error.message : String(error),
        });
        res
            .status(500)
            .json({ status: types_1.ResponseStatus.ERROR, message: String(error) });
    }
};
exports.runModification = runModification;
//# sourceMappingURL=modification.js.map