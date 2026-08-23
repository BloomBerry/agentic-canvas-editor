// Image Handlers for Figma Plugin
// Downloads and inserts images from base64 data
import { lookupNode } from "../bridge";

// ============ HELPERS ============

// Direct getNodeByIdAsync, with sourceId pluginData fallback.
async function resolveParentId(id: string): Promise<BaseNode | null> {
  return await lookupNode(id);
}

async function getParentNode(
  parentId?: string
): Promise<BaseNode & ChildrenMixin> {
  if (parentId) {
    const node = await resolveParentId(parentId);
    if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
      return node as FrameNode | PageNode;
    }
  }
  const focusedSlide = (figma.currentPage as any).focusedSlide as
    | SceneNode
    | null;
  return (focusedSlide as any) || figma.currentPage;
}

// Base64 decoder — safe for Figma plugin sandbox (no atob dependency)
const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function base64ToBytes(base64: string): Uint8Array {
  // Strip padding
  let len = base64.length;
  while (len > 0 && base64[len - 1] === "=") len--;

  const outputLen = (len * 3) >> 2;
  const bytes = new Uint8Array(outputLen);
  let p = 0;

  for (let i = 0; i < len; ) {
    const c0 = B64_LOOKUP[base64.charCodeAt(i++)];
    const c1 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;
    const c2 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;
    const c3 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;

    bytes[p++] = (c0 << 2) | (c1 >> 4);
    if (p < outputLen) bytes[p++] = ((c1 & 0xf) << 4) | (c2 >> 2);
    if (p < outputLen) bytes[p++] = ((c2 & 0x3) << 6) | c3;
  }

  return bytes;
}

// ============ PUBLIC API ============

export async function insertImage(params: {
  imageBase64: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  originalWidth?: number;
  originalHeight?: number;
  name?: string;
  parentId?: string;
  photographerName?: string;
  photographerUsername?: string;
}) {
  const {
    imageBase64,
    x = 0,
    y = 0,
    width,
    height,
    originalWidth,
    originalHeight,
    name = "Image",
    parentId,
    photographerName,
    photographerUsername,
  } = params;

  const parent = await getParentNode(parentId);

  // Decode base64 to bytes and create Figma image
  const bytes = base64ToBytes(imageBase64);
  const image = figma.createImage(bytes);

  // Calculate display dimensions (maintain aspect ratio)
  let w = width || 400;
  let h = height || 300;

  if (originalWidth && originalHeight) {
    const aspectRatio = originalHeight / originalWidth;
    if (width && !height) {
      h = Math.round(w * aspectRatio);
    } else if (height && !width) {
      w = Math.round(h / aspectRatio);
    } else if (!width && !height) {
      // Auto-size: scale down to max 800px wide
      w = Math.min(originalWidth, 800);
      h = Math.round(w * aspectRatio);
    }
  }

  const hasAttribution = photographerName && photographerUsername;

  if (hasAttribution) {
    // Create a wrapper frame with auto-layout (image + attribution)
    const wrapper = figma.createFrame();
    wrapper.name = name;
    wrapper.x = x;
    wrapper.y = y;
    wrapper.layoutMode = "VERTICAL";
    wrapper.primaryAxisSizingMode = "AUTO";
    wrapper.counterAxisSizingMode = "AUTO";
    wrapper.itemSpacing = 4;
    wrapper.fills = [];

    // Image rectangle
    const rect = figma.createRectangle();
    rect.name = "Photo";
    rect.resize(w, h);
    rect.fills = [
      {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: "FILL",
      },
    ];
    wrapper.appendChild(rect);

    // Attribution text: "Photo by [Name] on Unsplash"
    const profileUrl = `https://unsplash.com/@${photographerUsername}?utm_source=figma_slides_mcp&utm_medium=referral`;
    const unsplashUrl = `https://unsplash.com/?utm_source=figma_slides_mcp&utm_medium=referral`;
    const attributionStr = `Photo by ${photographerName} on Unsplash`;

    const attrText = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    attrText.fontName = { family: "Inter", style: "Regular" };
    attrText.fontSize = 10;
    attrText.characters = attributionStr;
    attrText.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    attrText.name = "Attribution";

    // Store URLs in pluginData for reference
    attrText.setPluginData("photographerUrl", profileUrl);
    attrText.setPluginData("unsplashUrl", unsplashUrl);

    // Underline the photographer name portion
    const nameStart = "Photo by ".length;
    const nameEnd = nameStart + photographerName.length;
    attrText.setRangeTextDecoration(nameStart, nameEnd, "UNDERLINE");

    // Underline "Unsplash"
    const unsplashStart = attributionStr.indexOf("Unsplash");
    const unsplashEnd = unsplashStart + "Unsplash".length;
    attrText.setRangeTextDecoration(unsplashStart, unsplashEnd, "UNDERLINE");

    wrapper.appendChild(attrText);
    parent.appendChild(wrapper);

    return {
      id: wrapper.id,
      name: wrapper.name,
      x,
      y,
      width: w,
      height: h,
      attribution: attributionStr,
      photographerUrl: profileUrl,
      unsplashUrl: unsplashUrl,
    };
  } else {
    // No attribution — plain image
    const rect = figma.createRectangle();
    rect.name = name;
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);
    rect.fills = [
      {
        type: "IMAGE",
        imageHash: image.hash,
        scaleMode: "FILL",
      },
    ];

    parent.appendChild(rect);

    return {
      id: rect.id,
      name: rect.name,
      x,
      y,
      width: w,
      height: h,
    };
  }
}
