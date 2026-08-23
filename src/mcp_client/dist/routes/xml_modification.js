"use strict";
/**
 * XML Ablation: Route handler for /xml-modification endpoint
 *
 * Same as modification.ts but:
 * - Parses xmlIdMapping form field
 * - Uses XML-mode prompts
 * - Creates XmlFigmaSlideAgent instead of SingleFigmaSlideAgent
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runXmlModification = void 0;
const crypto_1 = require("crypto");
const xml_prompts_1 = require("../utils/xml_prompts");
const helpers_1 = require("../utils/helpers");
const types_1 = require("../types");
const session_1 = require("../core/session");
const models_1 = require("../models");
const xmlFigmaSlideAgent_1 = require("../agents/xmlFigmaSlideAgent");
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
const runXmlModification = async (req, res) => {
    try {
        const message = req.body.message;
        const baseJsonString = req.body.baseJsonString;
        const routingMode = req.body.routingMode || "full";
        // XML-specific: parse ID mapping
        let xmlIdMapping = {};
        if (req.body.xmlIdMapping) {
            try {
                xmlIdMapping =
                    typeof req.body.xmlIdMapping === "string"
                        ? JSON.parse(req.body.xmlIdMapping)
                        : req.body.xmlIdMapping;
            }
            catch {
                helpers_1.logger.warn({
                    header: "Failed to parse xmlIdMapping, using empty mapping",
                });
            }
        }
        helpers_1.logger.info({
            header: `[XML] Received ${Object.keys(xmlIdMapping).length} ID mapping entries`,
        });
        // XML context (OOXML XML string)
        const xmlContext = req.body.contextJson ?? "";
        // Selective import
        let targetSlideIndices;
        if (req.body.targetSlideIndices) {
            try {
                targetSlideIndices =
                    typeof req.body.targetSlideIndices === "string"
                        ? JSON.parse(req.body.targetSlideIndices)
                        : req.body.targetSlideIndices;
            }
            catch {
                helpers_1.logger.warn({
                    header: "Failed to parse targetSlideIndices",
                });
            }
        }
        if (!message)
            throw new Error("No instruction provided.");
        const tools = requireTools();
        const metadata = parseMetadata(req.body.metadata);
        // Image (optional)
        let imagePayload;
        if (req.file) {
            const originalBase64Image = (0, helpers_1.base64Encode)(req.file.buffer);
            const mimeType = req.file.mimetype;
            const { base64 } = await (0, helpers_1.reduceBase64Image)(originalBase64Image, mimeType);
            imagePayload = { data: base64, mimeType };
        }
        else {
            helpers_1.logger.info({
                header: "[XML] No image provided — text/XML-only mode",
            });
        }
        // Count slides from base JSON
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
            // default
        }
        // Build XML-mode prompt
        const instruction = (0, xml_prompts_1.getXmlModePrompt)(message, xmlContext, slideCount);
        helpers_1.logger.info({
            header: `[XML] Using XML mode prompt`,
            body: `XML context: ${xmlContext.length} bytes, ${slideCount} slide(s)`,
        });
        const userRequest = buildUserRequest(instruction, imagePayload);
        const agentConfig = {
            agentType: "xml_figma_slide",
            maxTurns: metadata.max_turns,
            maxCalls: metadata.max_calls,
        };
        const modelConfig = {
            modelProvider: metadata.model_provider,
            modelName: metadata.model_name,
            temperature: metadata.temperature,
            inputCost: metadata.input_cost,
            outputCost: metadata.output_cost,
            maxTokens: metadata.max_tokens,
            ...(metadata.thinking_level ? { thinkingLevel: metadata.thinking_level } : {}),
        };
        const agent = new xmlFigmaSlideAgent_1.XmlFigmaSlideAgent(agentConfig);
        const model = (0, models_1.createModel)(modelConfig);
        // Parse imageData
        let imageData;
        if (req.body.imageData) {
            try {
                imageData =
                    typeof req.body.imageData === "string"
                        ? JSON.parse(req.body.imageData)
                        : req.body.imageData;
            }
            catch {
                helpers_1.logger.warn({ header: "Failed to parse imageData" });
            }
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
            xmlIdMapping,
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
                routing_mode: `xml_${routingMode}`,
            },
        });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error in runXmlModification",
            body: error instanceof Error ? error.message : String(error),
        });
        res
            .status(500)
            .json({ status: types_1.ResponseStatus.ERROR, message: String(error) });
    }
};
exports.runXmlModification = runXmlModification;
//# sourceMappingURL=xml_modification.js.map