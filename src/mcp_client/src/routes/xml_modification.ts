/**
 * XML Ablation: Route handler for /xml-modification endpoint
 *
 * Same as modification.ts but:
 * - Parses xmlIdMapping form field
 * - Uses XML-mode prompts
 * - Creates XmlFigmaSlideAgent instead of SingleFigmaSlideAgent
 */

import { Response } from "express";
import { randomUUID } from "crypto";
import { getXmlModePrompt } from "../utils/xml_prompts";
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
import { globalSession } from "../core/session";
import { createModel } from "../models";
import { XmlFigmaSlideAgent } from "../agents/xmlFigmaSlideAgent";
import { XmlIdMapping } from "../utils/xml_tools";

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

export const runXmlModification = async (
  req: MulterRequest,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    const message = req.body.message;
    const baseJsonString = req.body.baseJsonString;
    const routingMode: string = req.body.routingMode || "full";

    // XML-specific: parse ID mapping
    let xmlIdMapping: XmlIdMapping = {};
    if (req.body.xmlIdMapping) {
      try {
        xmlIdMapping =
          typeof req.body.xmlIdMapping === "string"
            ? JSON.parse(req.body.xmlIdMapping)
            : req.body.xmlIdMapping;
      } catch {
        logger.warn({
          header: "Failed to parse xmlIdMapping, using empty mapping",
        });
      }
    }
    logger.info({
      header: `[XML] Received ${Object.keys(xmlIdMapping).length} ID mapping entries`,
    });

    // XML context (OOXML XML string)
    const xmlContext: string = req.body.contextJson ?? "";

    // Selective import
    let targetSlideIndices: number[] | undefined;
    if (req.body.targetSlideIndices) {
      try {
        targetSlideIndices =
          typeof req.body.targetSlideIndices === "string"
            ? JSON.parse(req.body.targetSlideIndices)
            : req.body.targetSlideIndices;
      } catch {
        logger.warn({
          header: "Failed to parse targetSlideIndices",
        });
      }
    }

    if (!message) throw new Error("No instruction provided.");
    const tools = requireTools();
    const metadata = parseMetadata(req.body.metadata);

    // Image (optional)
    let imagePayload: { data: string; mimeType: string } | undefined;
    if (req.file) {
      const originalBase64Image = base64Encode(req.file.buffer);
      const mimeType = req.file.mimetype;
      const { base64 } = await reduceBase64Image(originalBase64Image, mimeType);
      imagePayload = { data: base64, mimeType };
    } else {
      logger.info({
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
          } else if (t === "SECTION") {
            count += (child.children || []).filter(
              (c: any) => c.type === "FRAME" || c.type === "SLIDE"
            ).length;
          } else if (t === "FRAME") {
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
      // default
    }

    // Build XML-mode prompt
    const instruction = getXmlModePrompt(message, xmlContext, slideCount);

    logger.info({
      header: `[XML] Using XML mode prompt`,
      body: `XML context: ${xmlContext.length} bytes, ${slideCount} slide(s)`,
    });

    const userRequest = buildUserRequest(instruction, imagePayload);

    const agentConfig = {
      agentType: "xml_figma_slide" as AgentType,
      maxTurns: metadata.max_turns,
      maxCalls: metadata.max_calls,
    };
    const modelConfig = {
      modelProvider: metadata.model_provider as ModelProvider,
      modelName: metadata.model_name,
      temperature: metadata.temperature,
      inputCost: metadata.input_cost,
      outputCost: metadata.output_cost,
      maxTokens: metadata.max_tokens,
      ...(metadata.thinking_level ? { thinkingLevel: metadata.thinking_level } : {}),
    };

    const agent = new XmlFigmaSlideAgent(agentConfig);
    const model = createModel(modelConfig);

    // Parse imageData
    let imageData: Record<string, string> | undefined;
    if (req.body.imageData) {
      try {
        imageData =
          typeof req.body.imageData === "string"
            ? JSON.parse(req.body.imageData)
            : req.body.imageData;
      } catch {
        logger.warn({ header: "Failed to parse imageData" });
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
        routing_mode: `xml_${routingMode}`,
      },
    });
  } catch (error) {
    logger.error({
      header: "Error in runXmlModification",
      body: error instanceof Error ? error.message : String(error),
    });
    res
      .status(500)
      .json({ status: ResponseStatus.ERROR, message: String(error) });
  }
};
