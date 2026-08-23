import { Response } from "express";
import { randomUUID } from "crypto";
import {
  getFigmaSlideModificationPrompt,
  getMinimalPrompt,
  getPromptForMode,
} from "../utils/prompts";
import { base64Encode, logger, reduceBase64Image } from "../utils/helpers";
import {
  AgentType,
  ContentType,
  MessageType,
  ModelProvider,
  MulterRequest,
  ResponseData,
  ResponseStatus,
  RoleType,
  UserRequestMessage,
} from "../types";
import { createAgent } from "../agents";
import { globalSession } from "../core/session";
import { createModel } from "../models";
import { SingleFigmaSlideAgent } from "../agents/singleFigmaSlideAgent";

type ModificationMetadata = {
  case_id: string;
  model_provider: string;
  model_name: string;
  agent_type: string;
  temperature: number;
  input_cost: number;
  output_cost: number;
  max_tokens: number;
  max_turns: number;
  max_calls?: number;
  max_retries?: number;
  thinking_level?: string;
};

const requireTools = () => {
  const tools = globalSession.state.tools;
  if (!tools) throw new Error("Tools are not loaded in the session.");
  return tools;
};

const parseMetadata = (raw: string): ModificationMetadata => {
  const metadata = JSON.parse(raw) as ModificationMetadata;
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

const getConfigFromMetadata = (metadata: ModificationMetadata) => ({
  agentConfig: {
    agentType: metadata.agent_type as AgentType,
    maxTurns: metadata.max_turns,
    maxCalls: metadata.max_calls,
    maxRetries: metadata.max_retries,
  },
  modelConfig: {
    modelProvider: metadata.model_provider as ModelProvider,
    modelName: metadata.model_name,
    temperature: metadata.temperature,
    inputCost: metadata.input_cost,
    outputCost: metadata.output_cost,
    maxTokens: metadata.max_tokens,
    ...(metadata.thinking_level ? { thinkingLevel: metadata.thinking_level } : {}),
  },
});

const buildUserRequest = (
  instruction: string,
  image?: { data: string; mimeType: string }
): UserRequestMessage => {
  const content: UserRequestMessage["content"] = [
    { type: ContentType.TEXT, text: instruction },
  ];
  if (image) {
    content.push({
      type: ContentType.IMAGE,
      data: image.data,
      mimeType: image.mimeType,
    });
  }
  return {
    id: randomUUID(),
    timestamp: Date.now(),
    type: MessageType.USER_REQUEST,
    role: RoleType.USER,
    content,
  };
};

export const runModification = async (
  req: MulterRequest,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    const message = req.body.message;
    const baseJsonString = req.body.baseJsonString;
    // CARE routing fields (optional – backward-compatible)
    const contextJson: string | undefined = req.body.contextJson;
    const routingMode: string = req.body.routingMode || "full";
    // Selective import: 0-based slide indices that will be modified
    let targetSlideIndices: number[] | undefined;
    if (req.body.targetSlideIndices) {
      try {
        targetSlideIndices = typeof req.body.targetSlideIndices === 'string'
          ? JSON.parse(req.body.targetSlideIndices)
          : req.body.targetSlideIndices;
      } catch {
        logger.warn({ header: "Failed to parse targetSlideIndices, skipping selective import" });
      }
    }

    if (!message) throw new Error("No instruction provided.");
    const tools = requireTools();
    const metadata = parseMetadata(req.body.metadata);

    // Image is optional — CARE router may decide images are not needed
    let imagePayload: { data: string; mimeType: string } | undefined;
    if (req.file) {
      const originalBase64Image = base64Encode(req.file.buffer);
      const mimeType = req.file.mimetype;
      const { base64 } = await reduceBase64Image(
        originalBase64Image,
        mimeType
      );
      imagePayload = { data: base64, mimeType };
    } else {
      logger.info({
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
          } else if (t === "SECTION") {
            count += (child.children || []).filter(
              (c: any) => c.type === "FRAME" || c.type === "SLIDE"
            ).length;
          } else if (t === "FRAME") {
            // Could be a direct slide, or a wrapper (e.g. Presentation > SLIDE_ROW > SLIDE)
            const inner = (child.children || []).filter(
              (c: any) => c.type === "SLIDE" || c.type === "SLIDE_ROW"
            );
            if (inner.length > 0) {
              for (const row of child.children || []) {
                if (row.type === "SLIDE") count++;
                else if (row.type === "SLIDE_ROW") {
                  count += (row.children || []).filter(
                    (c: any) => c.type === "SLIDE" || c.type === "FRAME"
                  ).length;
                }
              }
            } else {
              count++;
            }
          } else if (t === "SLIDE_ROW") {
            count += (child.children || []).filter(
              (c: any) => c.type === "SLIDE" || c.type === "FRAME"
            ).length;
          }
        }
        slideCount = count || 1;
      }
    } catch {
      // Use default slide count.
    }

    // Build the LLM prompt – use CARE-optimised context when available
    let instruction: string;
    if (routingMode === "off") {
      logger.info({
        header: "[CARE] Off mode — minimal prompt, LLM discovers context via tools",
      });
      instruction = getMinimalPrompt(message, slideCount);
    } else if (contextJson) {
      // Use CARE-prepared context (normalised bbox) for all modes including FULL.
      // For FULL mode, contextJson contains the same document but with
      // absoluteBoundingBox values normalised to slide-relative (0,0)-based coords.
      const effectiveMode = routingMode === "full" ? "full" : routingMode;
      logger.info({
        header: `[CARE] Using ${effectiveMode} mode prompt`,
        body: `contextJson size: ${contextJson.length} bytes`,
      });
      instruction = getPromptForMode(
        effectiveMode,
        message,
        contextJson,
        slideCount
      );
    } else {
      instruction = getFigmaSlideModificationPrompt(
        message,
        baseJsonString,
        slideCount
      );
    }

    const userRequest = buildUserRequest(instruction, imagePayload);

    const { agentConfig, modelConfig } = getConfigFromMetadata(metadata);
    const agent = createAgent(agentConfig) as SingleFigmaSlideAgent;
    const model = createModel(modelConfig);

    // Parse imageData if provided (imageRef → base64 PNG mapping)
    let imageData: Record<string, string> | undefined;
    if (req.body.imageData) {
      try {
        imageData =
          typeof req.body.imageData === "string"
            ? JSON.parse(req.body.imageData)
            : req.body.imageData;
      } catch {
        logger.warn({ header: "Failed to parse imageData, skipping" });
      }
    }

    // Agentic self-correction: skipImport=true preserves canvas state from
    // the prior iter (Pattern B). Sent as form field "skipImport" = "true".
    const skipImport = String(req.body.skipImport ?? "").toLowerCase() === "true";
    if (skipImport) {
      logger.info({ header: "skipImport=true (Pattern B; canvas state preserved)" });
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
      status: ResponseStatus.SUCCESS,
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
  } catch (error) {
    logger.error({
      header: "Error in runModification",
      body: error instanceof Error ? error.message : String(error),
    });
    res
      .status(500)
      .json({ status: ResponseStatus.ERROR, message: String(error) });
  }
};
