import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { ResponseData, ResponseStatus } from "../types";
import { globalSession } from "../core/session";
import { logger } from "../utils/helpers";

const validateTools = (res: Response<ResponseData>) => {
  if (!globalSession.state.tools) {
    res.status(400).json({
      status: ResponseStatus.ERROR,
      message: "Tools are not initialized in the session",
    });
    return false;
  }
  return true;
};

export const deleteAllTopLevelNodes = async (
  req: Request,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    if (!validateTools(res)) return;

    const toolCall = globalSession.state.tools!.createToolCall(
      "clear_canvas",
      randomUUID()
    );
    const result = await globalSession.state.tools!.callTool(toolCall);

    if (result.isError) {
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: "Failed to clear canvas",
      });
      return;
    }

    res.json({
      status: ResponseStatus.SUCCESS,
      message: "Canvas cleared successfully",
    });
  } catch (error) {
    logger.error({
      header: "Error in deleteAllTopLevelNodes",
      body: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      status: ResponseStatus.ERROR,
      message: String(error),
    });
  }
};

export const getChannels = async (
  req: Request,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    if (!validateTools(res)) return;

    const getChannelsToolCall = globalSession.state.tools!.createToolCall(
      "get_channels",
      randomUUID()
    );
    const result = await globalSession.state.tools!.callTool(
      getChannelsToolCall
    );

    if (result.isError || !result.content) {
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: "Invalid response from tool",
      });
      return;
    }

    const channelList =
      (result.structuredContent?.availableChannels as Array<string>) || [];
    const currentChannel = result.structuredContent?.currentChannel || null;

    if (!Array.isArray(channelList) || channelList.length === 0) {
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: "No channel information found",
      });
      return;
    }

    res.json({
      status: ResponseStatus.SUCCESS,
      payload: {
        available_channels: channelList,
        current_channel: currentChannel,
      },
    });
  } catch (error) {
    logger.error({
      header: "Error in getChannels",
      body: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      status: ResponseStatus.ERROR,
      message: String(error),
    });
  }
};

export const exportJson = async (
  req: Request,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    if (!validateTools(res)) return;

    const toolCall = globalSession.state.tools!.createToolCall(
      "export_json",
      randomUUID()
    );
    const result = await globalSession.state.tools!.callTool(toolCall);

    if (result.isError) {
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: "Failed to export JSON from Figma",
      });
      return;
    }

    res.json({
      status: ResponseStatus.SUCCESS,
      payload: result.structuredContent ?? {},
    });
  } catch (error) {
    logger.error({
      header: "Error in exportJson",
      body: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      status: ResponseStatus.ERROR,
      message: String(error),
    });
  }
};

export const importJson = async (
  req: Request,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    const jsonString = req.body.jsonString;
    if (!jsonString) {
      res.status(400).json({
        status: ResponseStatus.ERROR,
        message: "jsonString is required in request body",
      });
      return;
    }

    if (!validateTools(res)) return;

    const toolArgs: Record<string, any> = { jsonString };
    // Forward optional imageData (imageRef → base64 PNG mapping)
    if (req.body.imageData && typeof req.body.imageData === "object") {
      toolArgs.imageData = req.body.imageData;
    }

    const toolCall = globalSession.state.tools!.createToolCall(
      "import_json",
      randomUUID(),
      toolArgs
    );
    const result = await globalSession.state.tools!.callTool(toolCall);

    if (result.isError) {
      const errorDetail =
        result.content
          ?.filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; text: string }).text)
          .join("; ") || "Unknown error";
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: `Failed to import JSON into Figma: ${errorDetail}`,
      });
      return;
    }

    res.json({
      status: ResponseStatus.SUCCESS,
      payload: result.structuredContent ?? {},
    });
  } catch (error) {
    logger.error({
      header: "Error in importJson",
      body: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      status: ResponseStatus.ERROR,
      message: String(error),
    });
  }
};

export const selectChannel = async (
  req: Request,
  res: Response<ResponseData>
): Promise<void> => {
  try {
    const channel = (req.query.channel as string) || req.body.channel;

    if (!channel) {
      res.status(400).json({
        status: ResponseStatus.ERROR,
        message: "channel is required",
      });
      return;
    }

    if (!validateTools(res)) return;

    const toolCall = globalSession.state.tools!.createToolCall(
      "select_channel",
      randomUUID(),
      { channel }
    );
    const result = await globalSession.state.tools!.callTool(toolCall);

    if (result.isError || !result.structuredContent?.channel) {
      res.status(500).json({
        status: ResponseStatus.ERROR,
        message: "Invalid response from tool",
      });
      return;
    }

    res.json({
      status: ResponseStatus.SUCCESS,
      message: `Switched to channel: ${result.structuredContent.channel}`,
    });
  } catch (error) {
    logger.error({
      header: "Error in selectChannel",
      body: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      status: ResponseStatus.ERROR,
      message: String(error),
    });
  }
};
