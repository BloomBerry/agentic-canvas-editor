import {
  TextContent,
  ImageContent,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ResponseContent } from "../types.js";

export function rgbaToHex(color: any): string {
  if (color.startsWith("#")) {
    return color;
  }

  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);

  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}${
    a === 255 ? "" : a.toString(16).padStart(2, "0")
  }`;
}

export function createSuccessResponse(params: {
  messages: string[];
  images?: { data: string; mimeType: string }[];
  dataItem?: {
    [x: string]: unknown;
  };
}): CallToolResult {
  const content: ResponseContent[] = [];

  params.messages.forEach((text) =>
    content.push({ type: "text", text } satisfies TextContent)
  );

  // Include dataItem as JSON text so Claude can see the data
  if (params.dataItem && Object.keys(params.dataItem).length > 0) {
    content.push({
      type: "text",
      text: JSON.stringify(params.dataItem, null, 2),
    } satisfies TextContent);
  }

  params.images?.forEach(({ data, mimeType }) =>
    content.push({ type: "image", data, mimeType } satisfies ImageContent)
  );

  const responseObject: CallToolResult = {
    content: content as CallToolResult["content"],
    isError: false,
  };
  if (params.dataItem && Object.keys(params.dataItem).length > 0) {
    responseObject.structuredContent = params.dataItem;
  }

  return responseObject;
}

export function createErrorResponse(params: {
  error: unknown;
  context: string;
  dataItem?: {
    [x: string]: unknown;
  };
}): CallToolResult {
  const responseObject: CallToolResult = {
    content: [
      {
        type: "text",
        text: `Error (${params.context}): ${
          params.error instanceof Error
            ? params.error.message
            : String(params.error)
        }`,
      } satisfies TextContent,
    ],
    isError: true,
  };

  if (params.dataItem) {
    responseObject.structuredContent = params.dataItem;
  }

  return responseObject;
}