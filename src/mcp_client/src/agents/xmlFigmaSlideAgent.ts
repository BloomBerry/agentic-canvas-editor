/**
 * XML Ablation Agent
 *
 * Mirrors SingleFigmaSlideAgent but:
 * 1. Wraps tools with MappedTools for XML ID → Figma ID remapping
 * 2. Converts EMU coordinates to pixel parent-relative coordinates
 * 3. Uses XML-specific prompts
 * 4. Re-converts SceneGraph to XML on Turn 2+ context refresh
 */

import { randomUUID } from "crypto";
import {
  AgentMetadata,
  ContentType,
  GenericMessage,
  MessageType,
  RoleType,
  SnapshotStructure,
  ToolResponseMessage,
  UserRequestMessage,
} from "../types";
import { ModelInstance } from "../models/modelInstance";
import { Tools } from "../core/tools";
import { AgentInstance } from "./agentInstance";
import {
  exportSlideImage,
  getAllSlides,
  getSlidePageInfo,
  importJsonToFigma,
  exportJsonFromFigma,
  countSlidesFromExportedJson,
  reduceBase64Image,
  logger,
} from "../utils/helpers";
import { getXmlModePrompt } from "../utils/xml_prompts";
import {
  MappedTools,
  XmlIdMapping,
  scenegraphToXml,
} from "../utils/xml_tools";

export class XmlFigmaSlideAgent extends AgentInstance {
  private mappedTools: MappedTools | null = null;
  /** Real (unmapped) tools — used for import/export operations. */
  private realTools: Tools | null = null;

  async run(params: {
    requestMessage: UserRequestMessage;
    tools: Tools;
    model: ModelInstance;
    baseJsonString: string;
    metadata: AgentMetadata;
    imageData?: Record<string, string>;
    targetSlideIndices?: number[];
    routingMode?: string;
    rawInstruction?: string;
    xmlIdMapping?: XmlIdMapping;
  }): Promise<{
    case_id: string;
    history: GenericMessage[];
    responses: any[];
    cost: number;
    json_structure: Object;
    turn: number;
    image_uri: string;
    image_uris: string[];
    snapshots: SnapshotStructure[];
  }> {
    logger.info({
      header: "XML Figma Slide Agent Started",
      body: `Model: ${params.model.modelName}, Provider: ${params.model.modelProvider}, Max Turns: ${this.maxTurns}, Max Calls: ${this.maxCalls}`,
    });

    // Create MappedTools wrapper
    this.realTools = params.tools;
    this.mappedTools = new MappedTools(
      params.tools,
      params.xmlIdMapping ?? {}
    );

    let turn = 0;
    let cost = 0;
    const formattedMessageContext: GenericMessage[] = [];
    const rawResponses: any[] = [];
    const snapshots: SnapshotStructure[] = [];

    // Step 1: Import base JSON into Figma (uses real tools, not mapped)
    logger.info({ header: "Importing base JSON into Figma Slides..." });
    const importResult = await importJsonToFigma(
      params.tools, // real tools for import
      params.baseJsonString,
      params.imageData,
      params.targetSlideIndices
    );
    logger.info({
      header: "Base JSON imported successfully",
      body: `Created ${importResult.slideCount} slide(s): ${importResult.slideIds.join(", ")}`,
    });

    // Step 1a: Update XML ID mapping with post-import Figma node IDs.
    // The initial mapping (from Python xml_converter) references original JSON
    // node IDs. After import_json, Figma assigns new IDs to all nodes.
    // Without this update, Turn 2+ re-export creates different XML IDs for
    // slides (e.g. 101 instead of 16), causing the model to use stale IDs.
    if (importResult.nodeIdMap && Object.keys(importResult.nodeIdMap).length > 0) {
      const currentMapping = this.mappedTools!.getMapping();
      let remapCount = 0;
      for (const entry of Object.values(currentMapping)) {
        const newFigmaId = importResult.nodeIdMap[entry.figmaId];
        if (newFigmaId) {
          entry.figmaId = newFigmaId;
          remapCount++;
        }
        if (entry.parentFigmaId) {
          const newParentId = importResult.nodeIdMap[entry.parentFigmaId];
          if (newParentId) {
            entry.parentFigmaId = newParentId;
          }
        }
      }
      this.mappedTools!.updateMapping(currentMapping);
      logger.info({
        header: "[XML ID Remap] Updated mapping with post-import Figma IDs",
        body: `Remapped ${remapCount}/${Object.keys(currentMapping).length} entries using ${Object.keys(importResult.nodeIdMap).length} import ID mappings`,
      });
    }

    // Step 1b: Capture initial snapshot
    const initialSnapshot = await this.captureSnapshot(
      params.tools,
      params.metadata.caseId,
      0,
      []
    );
    snapshots.push(initialSnapshot);
    logger.info({
      header: "Initial Plugin JSON captured (turn 0)",
      body: "Saved pre-modification state for evaluation baseline",
    });

    const originalPromptText = params.requestMessage.content
      .filter((c) => c.type === ContentType.TEXT)
      .map((c) => (c as { type: ContentType.TEXT; text: string }).text)
      .join("\n");

    // Tool list for LLM — filter out scene-graph-only tools that don't
    // make sense in the flat XML (PresentationML) context.
    const XML_EXCLUDED_TOOLS = new Set([
      // Scene-graph hierarchy tools (XML spTree is flat)
      "reorder_node",        // z-order is determined by XML element order
      "reparent_node",       // no parent hierarchy to change
      "group_nodes",         // no group concept in flat spTree
      "ungroup_nodes",       // no group concept in flat spTree
      // Discovery tools (context already provided in prompt)
      "export_json",         // document structure already in prompt
      "get_page_structure",  // document structure already in prompt
      "get_all_slides",      // slide IDs already in prompt
      "check_connection_status", // connection already established
      // Internal-only tools (LLM should never call these)
      "clear_canvas",        // agent-internal only
      "import_json",         // agent-internal only
      "get_channels",        // connection management, not for LLM
      "select_channel",      // connection management, not for LLM
    ]);
    const filteredTools = Array.from(params.tools.catalogue.values()).filter(
      (tool) => !XML_EXCLUDED_TOOLS.has(tool.name)
    );
    const toolsArray = params.model.formatToolList(filteredTools);

    let allToolResults: any[] = [];
    let totalLLMCalls = 0;
    const allTurnSummaries: string[] = [];
    const allToolRequests: { name: string; arguments?: any }[] = [];

    outer: while (turn < this.maxTurns) {
      turn++;

      const apiMessageContext = params.model.createMessageContext();
      const turnToolRequests: { name: string; arguments?: any }[] = [];
      const turnToolResults: any[] = [];
      let contextOverflow = false;
      let turnLLMCalls = 0;

      if (turn === 1) {
        apiMessageContext.push(
          ...params.model.formatRequest([params.requestMessage])
        );
        formattedMessageContext.push(params.requestMessage);
      } else {
        const hadImageOnTurn1 = params.requestMessage.content.some(
          (c) => c.type === ContentType.IMAGE
        );
        const IMAGE_TOOLS = ["export_slide_image", "get_result_image"];
        const usedImageTools = allToolRequests.some((r) =>
          IMAGE_TOOLS.includes(r.name)
        );
        const skipImages = !hadImageOnTurn1 && !usedImageTools;

        const updatedMessage = await this.buildUpdatedMessage(
          params.tools, // real tools for export
          originalPromptText,
          allTurnSummaries.join("\n\n"),
          skipImages,
          params.rawInstruction
        );
        apiMessageContext.push(
          ...params.model.formatRequest([updatedMessage])
        );
        formattedMessageContext.push(updatedMessage);
      }

      logger.info({
        header: `Turn ${turn}/${this.maxTurns}`,
        body:
          turn > 1
            ? `[Context reset] With re-captured image + action summary:\n${allTurnSummaries.join("\n\n")}`
            : undefined,
      });

      // Inner loop: multiple LLM calls within same context
      while (totalLLMCalls < this.maxCalls) {
        totalLLMCalls++;
        turnLLMCalls++;
        logger.info({
          header: `Turn ${turn} / LLM call ${turnLLMCalls} - requesting tool calls`,
        });

        let modelResponse;
        try {
          modelResponse = await params.model.generateResponseWithTool(
            apiMessageContext,
            toolsArray
          );
        } catch (err: any) {
          const errMsg = err?.message ?? String(err);
          if (
            errMsg.includes("context window") ||
            errMsg.includes("token limit") ||
            errMsg.includes("maximum context length")
          ) {
            logger.warn({
              header: `[Context overflow] Turn ${turn} — resetting context for next turn`,
              body: errMsg,
            });
            contextOverflow = true;
            break;
          }
          throw err;
        }

        rawResponses.push(modelResponse);
        cost += params.model.getCostFromResponse(modelResponse);

        params.model.addToApiMessageContext(modelResponse, apiMessageContext);
        params.model.addToFormattedMessageContext(
          modelResponse,
          MessageType.AGENT_REQUEST,
          formattedMessageContext
        );

        const callToolRequests =
          params.model.formatCallToolRequest(modelResponse);

        if (!callToolRequests || callToolRequests.length === 0) {
          const outputText: string =
            (modelResponse as any).output_text ?? "";
          const hasTextToolCalls =
            outputText.includes("focus_slide") ||
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
            const turnAllSucceeded =
              turnToolResults.length > 0 &&
              !this.detectPartialFailures(turnToolResults);
            const isEcho = this.isEchoOfPreviousCalls(
              outputText,
              turnToolRequests
            );

            if (turnAllSucceeded || isEcho) {
              logger.info({
                header: `[Soft overflow suppressed] Turn ${turn}`,
                body: `Turn had ${turnToolResults.length} successful tool call(s). Treating as normal completion.`,
              });
              break;
            }

            logger.warn({
              header: `[Soft context overflow] Turn ${turn}`,
              body: `Treating as context overflow for context reset`,
            });
            contextOverflow = true;
            break;
          }

          if (allToolResults.length === 0 && turnToolResults.length === 0) {
            logger.warn({
              header: `No tool calls on turn ${turn} — LLM produced nothing`,
            });
          } else {
            logger.info({
              header: `No more tool calls — LLM finished on turn ${turn}`,
            });
          }
          break;
        }

        // Execute tool calls through MappedTools (ID remapping + coord conversion)
        const toolResults = [];
        for (const toolCall of callToolRequests) {
          toolResults.push(await this.mappedTools!.callTool(toolCall));
        }

        turnToolRequests.push(...callToolRequests);
        turnToolResults.push(...toolResults);
        allToolRequests.push(...callToolRequests);
        allToolResults.push(...toolResults);

        for (const msg of params.model.formatToolResponses(toolResults)) {
          apiMessageContext.push(msg);
        }
        this.addToolResultsToFormattedContext(
          toolResults,
          formattedMessageContext
        );

        logger.info({
          header: `Turn ${turn} / LLM call ${turnLLMCalls} completed`,
          body: `Tool calls: ${toolResults.length}, Turn total: ${turnToolResults.length}`,
        });
      }

      // End of turn
      if (turnToolResults.length > 0) {
        allTurnSummaries.push(
          `[Turn ${turn}]\n` +
            this.buildTurnSummary(turnToolRequests, turnToolResults)
        );

        const hasModification = turnToolRequests.some(
          (c) => c.name !== "focus_slide"
        );
        if (hasModification) {
          const turnSnapshot = await this.captureSnapshot(
            params.tools,
            params.metadata.caseId,
            turn,
            turnToolResults
          );
          snapshots.push(turnSnapshot);
        }
      }

      logger.info({
        header: `Turn ${turn} finished`,
        body: `Turn tool calls: ${turnToolResults.length}, Total: ${allToolResults.length}`,
      });

      const hasPartialFailures = this.detectPartialFailures(turnToolResults);
      if (hasPartialFailures) {
        logger.warn({
          header: `[Partial failures] Turn ${turn} had failed operations — will retry on next turn`,
        });
      }

      if (!contextOverflow && !hasPartialFailures) {
        break outer;
      }
      logger.info({
        header: `Continuing to turn ${turn + 1} with context reset`,
        body: contextOverflow
          ? "Reason: context overflow"
          : "Reason: partial failures need retry",
      });
    }

    if (turn >= this.maxTurns) {
      logger.warn({ header: `Reached max turns (${this.maxTurns})` });
    }

    let lastSnapshot: SnapshotStructure;
    if (snapshots.length > 0) {
      lastSnapshot = snapshots[snapshots.length - 1];
    } else {
      lastSnapshot = await this.captureSnapshot(
        params.tools,
        params.metadata.caseId,
        0,
        []
      );
      snapshots.push(lastSnapshot);
    }

    return {
      case_id: params.metadata.caseId,
      history: formattedMessageContext,
      responses: rawResponses,
      json_structure: lastSnapshot.structure ?? {},
      image_uri: lastSnapshot.image_uri ?? "",
      image_uris: lastSnapshot.image_uris ?? [],
      turn,
      snapshots,
      cost: cost / 1000,
    };
  }

  // ── Turn 2+ context refresh: re-export SceneGraph → convert to XML ──

  private async buildUpdatedMessage(
    tools: Tools,
    originalPromptText: string,
    turnSummary: string,
    skipImages = false,
    rawInstruction?: string
  ): Promise<UserRequestMessage> {
    let promptText = originalPromptText;

    if (rawInstruction) {
      try {
        const freshJson = await exportJsonFromFigma(tools);
        const freshSlideCount = countSlidesFromExportedJson(freshJson);

        // Re-convert to XML with stable IDs (reuse previous mapping)
        const prevMapping = this.mappedTools!.getMapping();
        const { xml, mapping } = scenegraphToXml(freshJson, prevMapping);
        this.mappedTools!.updateMapping(mapping);

        logger.info({
          header: "[XML Context Refresh] Re-exported and converted to XML for Turn 2+",
          body: `Slides: ${freshSlideCount}, XML size: ${xml.length} bytes, Mappings: ${Object.keys(mapping).length}`,
        });

        promptText = getXmlModePrompt(rawInstruction, xml, freshSlideCount);
      } catch (err) {
        logger.warn({
          header: "[XML Context Refresh] Failed, using original prompt",
          body: (err as Error).message,
        });
      }
    }

    const continuationRules = `
**IMPORTANT: Continuation Rules**
- The presentation XML above reflects the CURRENT state after previous turns.
- Do NOT re-execute operations that already succeeded (listed in Previous Turn Result).
- Only perform operations that are still INCOMPLETE or FAILED.
- If all tasks from the instruction are already reflected in the current state, do not generate any tool calls.`;

    const content: UserRequestMessage["content"] = [
      {
        type: ContentType.TEXT,
        text: `${promptText}\n\n**Previous Turn Result**\n${turnSummary}\n${continuationRules}`,
      },
    ];

    if (!skipImages) {
      const imageUris = await this.captureSlideImages(tools);
      for (const uri of imageUris) {
        let data = uri;
        try {
          const raw = uri.replace(/^data:image\/\w+;base64,/, "");
          const reduced = await reduceBase64Image(raw, "image/png", 512);
          data = reduced.base64;
        } catch {
          // use original
        }
        content.push({
          type: ContentType.IMAGE,
          data,
          mimeType: "image/png",
        });
      }
    }

    return {
      id: randomUUID(),
      timestamp: Date.now(),
      type: MessageType.USER_REQUEST,
      role: RoleType.USER,
      content,
    };
  }

  // ── Helper methods (mirrored from SingleFigmaSlideAgent) ──

  private async captureSlideImages(tools: Tools): Promise<string[]> {
    const imageUris: string[] = [];
    try {
      const slidesInfo = await getAllSlides(tools);
      const slideNodes: { id: string; name: string }[] =
        slidesInfo?.slides ?? slidesInfo ?? [];
      if (Array.isArray(slideNodes) && slideNodes.length > 0) {
        for (const slide of slideNodes) {
          try {
            const uri = await exportSlideImage(tools, slide.id);
            imageUris.push(uri);
          } catch (err) {
            logger.warn({
              header: `Could not export image for slide ${slide.name ?? slide.id}`,
              body: (err as Error).message,
            });
          }
        }
      }
    } catch (err) {
      logger.warn({
        header: "Could not get slides list for re-capture",
        body: (err as Error).message,
      });
    }
    if (imageUris.length === 0) {
      try {
        const uri = await exportSlideImage(tools);
        imageUris.push(uri);
      } catch (err) {
        logger.warn({
          header: "Could not export slide image for re-capture",
          body: (err as Error).message,
        });
      }
    }
    return imageUris;
  }

  private buildTurnSummary(
    callToolRequests: { name: string; arguments?: any }[],
    toolResults: any[]
  ): string {
    const succeeded = toolResults.filter((r) => !r.isError);
    const failed = toolResults.filter((r) => r.isError);

    let summary = `${succeeded.length}/${toolResults.length} tool calls succeeded.`;
    summary += "\nExecuted operations:";
    for (const req of callToolRequests) {
      const argJson = JSON.stringify(req.arguments ?? {});
      const argStr =
        req.name === "batch_execute" ? argJson : argJson.slice(0, 150);
      summary += `\n- ${req.name}(${argStr})`;
    }

    const batchFailures: string[] = [];
    for (const result of succeeded) {
      try {
        const text = result.content?.map((c: any) => c.text).join("") ?? "";
        const parsed = JSON.parse(text);
        if (parsed?.results && Array.isArray(parsed.results)) {
          for (const op of parsed.results) {
            if (!op.success && op.error) {
              batchFailures.push(`${op.command}: ${op.error}`);
            }
          }
        }
      } catch {
        // not a batch result
      }
    }

    if (batchFailures.length > 0) {
      summary += `\n\nPartial failures inside batch_execute (${batchFailures.length} operations failed):`;
      for (const bf of batchFailures) {
        summary += `\n- ${bf}`;
      }
    }

    if (failed.length > 0) {
      summary += "\n\nFailed operations (need retry):";
      for (const f of failed) {
        const errorText = f.content
          ?.map((c: any) => c.text)
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

  private async captureSnapshot(
    tools: Tools,
    caseId: string,
    turn: number,
    toolResults: any[]
  ): Promise<SnapshotStructure> {
    const imageUris = await this.captureSlideImages(tools);
    if (imageUris.length > 0) {
      logger.info({
        header: `[Snapshot turn ${turn}] Exported ${imageUris.length} slide image(s)`,
      });
    }

    let structure: Object = {};
    try {
      structure = await exportJsonFromFigma(tools);
    } catch (err) {
      logger.warn({
        header: "Could not export JSON for snapshot",
        body: (err as Error).message,
      });
      try {
        structure = await getSlidePageInfo(tools);
      } catch {
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

  private addToolResultsToFormattedContext(
    toolResults: any[],
    formattedMessageContext: GenericMessage[]
  ): void {
    formattedMessageContext.push({
      id: randomUUID(),
      timestamp: Date.now(),
      role: RoleType.TOOL,
      type: MessageType.TOOL_RESPONSE,
      content: toolResults.map((result) => ({
        type: ContentType.TEXT,
        text: result.content.map((c: any) => c.text).join("\n"),
      })),
      results: toolResults,
    } as ToolResponseMessage);
  }

  private detectPartialFailures(turnToolResults: any[]): boolean {
    for (const result of turnToolResults) {
      if (result.isError) return true;
      for (const part of result.content ?? []) {
        try {
          const parsed = JSON.parse((part as any).text ?? "");
          if (parsed?.results && Array.isArray(parsed.results)) {
            if (parsed.results.some((op: any) => !op.success)) return true;
          }
        } catch {
          // Not JSON
        }
      }
    }
    return false;
  }

  private isEchoOfPreviousCalls(
    outputText: string,
    previousRequests: { name: string; arguments?: any }[]
  ): boolean {
    if (previousRequests.length === 0) return false;
    const executedNames = new Set(previousRequests.map((r) => r.name));
    const knownToolPatterns = [
      "batch_execute", "focus_slide", "move_node", "resize_node",
      "set_text_content", "set_text_font", "set_fill_color",
      "set_text_decoration", "create_text", "create_frame",
      "create_rectangle", "delete_node", "delete_slide",
      "reparent_node", "create_table_from_data", "reorder_slides",
    ];
    const mentionedTools = knownToolPatterns.filter((t) =>
      outputText.includes(t)
    );
    if (mentionedTools.length === 0) return false;
    const hasNewTool = mentionedTools.some((t) => !executedNames.has(t));
    return !hasNewTool;
  }
}
