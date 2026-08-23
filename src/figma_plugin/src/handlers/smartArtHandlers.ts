// SmartArt Handlers - Bullet Text → Figma SmartArt Diagrams
// text-to-smartart: 불릿 텍스트를 시각적 다이어그램으로 변환
import { nodeIdMap, lookupNode } from "../bridge";

// ============ TYPES ============

interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

type SmartArtType =
  | "basic_block_list"
  | "vertical_block_list"
  | "basic_process"
  | "chevron_process"
  | "org_chart"
  | "basic_venn"
  | "basic_cycle"
  | "basic_matrix";

interface SmartArtStyle {
  colorPalette?:
    | "dark"
    | "colorful"
    | "monochrome"
    | "accent1"
    | "accent2"
    | "accent3"
    | "custom";
  customColors?: RGBA[];
  backgroundColor?: RGBA;
  fontFamily?: string;
  fontSize?: number;
  titleFontSize?: number;
  blockCornerRadius?: number;
  connectorColor?: RGBA;
  connectorWidth?: number;
}

interface SmartArtMetadata {
  smartArtType: SmartArtType;
  bulletText: string;
  style: SmartArtStyle;
  width: number;
  height: number;
}

interface BulletItem {
  text: string;
  level: number;
  children: BulletItem[];
}

interface ParsedBulletTree {
  items: BulletItem[];
  maxDepth: number;
  totalCount: number;
}

// ============ CONSTANTS ============

const SMARTART_DATA_KEY = "smartart_metadata";

const PALETTES: Record<string, RGBA[]> = {
  dark: [
    { r: 0.176, g: 0.224, b: 0.318, a: 1 }, // #2D3951 dark navy
    { r: 0.204, g: 0.255, b: 0.353, a: 1 }, // #34415A slightly lighter
    { r: 0.231, g: 0.286, b: 0.388, a: 1 }, // #3B4963
    { r: 0.192, g: 0.243, b: 0.341, a: 1 }, // #313E57
    { r: 0.216, g: 0.267, b: 0.365, a: 1 }, // #37445D
    { r: 0.165, g: 0.212, b: 0.306, a: 1 }, // #2A364E
    { r: 0.243, g: 0.298, b: 0.400, a: 1 }, // #3E4C66
    { r: 0.196, g: 0.251, b: 0.349, a: 1 }, // #324059
  ],
  colorful: [
    { r: 0.259, g: 0.522, b: 0.957, a: 1 }, // #4285F4 blue
    { r: 0.918, g: 0.263, b: 0.208, a: 1 }, // #EA4335 red
    { r: 0.984, g: 0.737, b: 0.016, a: 1 }, // #FBBC04 yellow
    { r: 0.208, g: 0.659, b: 0.325, a: 1 }, // #34A853 green
    { r: 1.0, g: 0.42, b: 0.176, a: 1 }, // #FF6B2D orange
    { r: 0.541, g: 0.318, b: 0.831, a: 1 }, // #8A51D4 purple
    { r: 0.0, g: 0.737, b: 0.831, a: 1 }, // #00BCD4 cyan
    { r: 0.914, g: 0.118, b: 0.388, a: 1 }, // #E91E63 pink
  ],
  monochrome: [
    { r: 0.2, g: 0.4, b: 0.7, a: 1 },
    { r: 0.35, g: 0.55, b: 0.8, a: 1 },
    { r: 0.5, g: 0.68, b: 0.88, a: 1 },
    { r: 0.65, g: 0.78, b: 0.92, a: 1 },
    { r: 0.78, g: 0.86, b: 0.95, a: 1 },
    { r: 0.88, g: 0.92, b: 0.97, a: 1 },
  ],
  accent1: [
    { r: 0.89, g: 0.26, b: 0.2, a: 1 },
    { r: 0.96, g: 0.4, b: 0.22, a: 1 },
    { r: 1.0, g: 0.6, b: 0.24, a: 1 },
    { r: 1.0, g: 0.76, b: 0.3, a: 1 },
    { r: 1.0, g: 0.88, b: 0.46, a: 1 },
  ],
  accent2: [
    { r: 0.12, g: 0.3, b: 0.52, a: 1 },
    { r: 0.16, g: 0.47, b: 0.7, a: 1 },
    { r: 0.2, g: 0.6, b: 0.8, a: 1 },
    { r: 0.3, g: 0.75, b: 0.78, a: 1 },
    { r: 0.46, g: 0.84, b: 0.74, a: 1 },
  ],
  accent3: [
    { r: 0.36, g: 0.2, b: 0.58, a: 1 },
    { r: 0.54, g: 0.32, b: 0.72, a: 1 },
    { r: 0.72, g: 0.44, b: 0.82, a: 1 },
    { r: 0.86, g: 0.56, b: 0.88, a: 1 },
    { r: 0.94, g: 0.72, b: 0.92, a: 1 },
  ],
};

const DEFAULTS = {
  blockPadding: 16,
  blockCornerRadius: 8,
  itemSpacing: 16,
  arrowSize: 24,
  chevronPointDepth: 20,
  orgNodeWidth: 160,
  orgNodeHeight: 50,
  orgLevelGap: 60,
  orgSiblingGap: 24,
  vennOverlapRatio: 0.35,
  cycleNodeSize: 80,
  fontSize: 14,
  titleFontSize: 16,
  descFontSize: 12,
};

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };
const DARK_TEXT: RGBA = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
const CONNECTOR_DEFAULT: RGBA = { r: 0.6, g: 0.6, b: 0.6, a: 1 };

// ============ HELPERS ============

function toRGB(c: RGBA): RGB {
  return { r: c.r, g: c.g, b: c.b };
}

function getPalette(style: SmartArtStyle): RGBA[] {
  if (
    style.colorPalette === "custom" &&
    style.customColors &&
    style.customColors.length > 0
  ) {
    return style.customColors;
  }
  return PALETTES[style.colorPalette || "dark"] || PALETTES.dark;
}

function getColor(palette: RGBA[], index: number): RGBA {
  return palette[index % palette.length];
}

function rgbString(c: RGBA): string {
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

function isLightColor(c: RGBA): boolean {
  const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return luminance > 0.5;
}

function textColorFor(bg: RGBA): RGBA {
  return isLightColor(bg) ? DARK_TEXT : WHITE;
}

async function loadFont(
  family: string = "Inter",
  style: string = "Regular"
) {
  try {
    await figma.loadFontAsync({ family, style });
  } catch {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

async function loadFonts(family: string = "Inter") {
  await Promise.all([
    loadFont(family, "Regular"),
    loadFont(family, "Bold"),
  ]);
}

// Direct + sourceId fallback.
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
  const focusedSlide = (figma.currentPage as any).focusedSlide as SceneNode | null;
  return (focusedSlide as any) || figma.currentPage;
}

// ============ BULLET TEXT PARSER ============

function computeIndentLevel(whitespace: string): number {
  let spaces = 0;
  for (const ch of whitespace) {
    if (ch === "\t") spaces += 2;
    else if (ch === " ") spaces += 1;
  }
  return Math.floor(spaces / 2);
}

function parseBulletText(text: string): ParsedBulletTree {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const rootItems: BulletItem[] = [];
  const stack: { item: BulletItem; level: number }[] = [];
  let maxDepth = 0;
  let totalCount = 0;

  for (const line of lines) {
    const leadingWS = line.match(/^(\s*)/)?.[1] || "";
    const indentLevel = computeIndentLevel(leadingWS);

    // Strip bullet marker: "- ", "* ", "1. ", "2) ", etc.
    const content = line
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!content) continue;

    const item: BulletItem = {
      text: content,
      level: indentLevel,
      children: [],
    };
    totalCount++;
    maxDepth = Math.max(maxDepth, indentLevel);

    while (
      stack.length > 0 &&
      stack[stack.length - 1].level >= indentLevel
    ) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootItems.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }
    stack.push({ item, level: indentLevel });
  }

  return { items: rootItems, maxDepth, totalCount };
}

function flattenItems(tree: ParsedBulletTree): string[] {
  const result: string[] = [];
  function walk(items: BulletItem[]) {
    for (const item of items) {
      result.push(item.text);
      walk(item.children);
    }
  }
  walk(tree.items);
  return result;
}

// ============ SHARED RENDERING HELPERS ============

async function makeTextNode(
  text: string,
  fontSize: number,
  fontFamily: string,
  color: RGBA,
  bold: boolean = false
): Promise<TextNode> {
  const node = figma.createText();
  node.fontName = { family: fontFamily, style: bold ? "Bold" : "Regular" };
  node.characters = text;
  node.fontSize = fontSize;
  node.fills = [{ type: "SOLID", color: toRGB(color), opacity: color.a ?? 1 }];
  return node;
}

async function createBlock(
  text: string,
  w: number,
  h: number,
  bgColor: RGBA,
  fontSize: number,
  fontFamily: string,
  cornerRadius: number
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.resize(w, h);
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.cornerRadius = cornerRadius;
  frame.fills = [
    { type: "SOLID", color: toRGB(bgColor), opacity: bgColor.a ?? 1 },
  ];

  const tc = textColorFor(bgColor);
  const textNode = await makeTextNode(text, fontSize, fontFamily, tc, true);
  textNode.textAlignHorizontal = "CENTER";
  frame.appendChild(textNode);
  textNode.layoutSizingHorizontal = "FILL";

  return frame;
}

// ============ LAYOUT RENDERERS ============

// --- 1. Basic Block List ---
async function renderBasicBlockList(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree);
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.fontSize || DEFAULTS.fontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;

  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.itemSpacing = DEFAULTS.itemSpacing;
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";

  const availW =
    width - DEFAULTS.blockPadding * 2 - DEFAULTS.itemSpacing * (items.length - 1);
  const blockW = Math.max(100, Math.floor(availW / items.length));
  const blockH = height - DEFAULTS.blockPadding * 2;

  for (let i = 0; i < items.length; i++) {
    const block = await createBlock(
      items[i],
      blockW,
      blockH,
      getColor(palette, i),
      fontSize,
      fontFamily,
      cr
    );
    block.name = `Block ${i + 1}`;
    frame.appendChild(block);
    block.layoutSizingHorizontal = "FILL";
    block.layoutSizingVertical = "FILL";
  }
}

// --- 2. Vertical Block List ---
async function renderVerticalBlockList(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  _height: number,
  style: SmartArtStyle
) {
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const titleFontSize = style.titleFontSize || DEFAULTS.titleFontSize;
  const descFontSize = style.fontSize || DEFAULTS.descFontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;

  frame.layoutMode = "VERTICAL";
  frame.primaryAxisAlignItems = "MIN";
  frame.counterAxisAlignItems = "MIN";
  frame.itemSpacing = 12;
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "HUG";

  for (let i = 0; i < tree.items.length; i++) {
    const item = tree.items[i];
    const color = getColor(palette, i);

    // Block row: accent bar + text area
    const row = figma.createFrame();
    row.name = `Item ${i + 1}`;
    row.layoutMode = "HORIZONTAL";
    row.counterAxisAlignItems = "MIN";
    row.itemSpacing = 12;
    row.fills = [];
    row.layoutSizingVertical = "HUG";

    // Accent bar
    const bar = figma.createRectangle();
    bar.resize(6, 48);
    bar.cornerRadius = 3;
    bar.fills = [{ type: "SOLID", color: toRGB(color) }];
    row.appendChild(bar);

    // Text area
    const textArea = figma.createFrame();
    textArea.layoutMode = "VERTICAL";
    textArea.itemSpacing = 4;
    textArea.fills = [];
    textArea.layoutSizingVertical = "HUG";

    // Title
    const titleNode = await makeTextNode(
      item.text,
      titleFontSize,
      fontFamily,
      DARK_TEXT,
      true
    );
    textArea.appendChild(titleNode);
    titleNode.layoutSizingHorizontal = "FILL";

    // Description (from children)
    if (item.children.length > 0) {
      const desc = item.children.map((c) => c.text).join(", ");
      const descNode = await makeTextNode(
        desc,
        descFontSize,
        fontFamily,
        { r: 0.4, g: 0.4, b: 0.4, a: 1 }
      );
      textArea.appendChild(descNode);
      descNode.layoutSizingHorizontal = "FILL";
    }

    row.appendChild(textArea);
    textArea.layoutSizingHorizontal = "FILL";
    frame.appendChild(row);
    row.layoutSizingHorizontal = "FILL";
  }
}

// --- 3. Basic Process ---
async function renderBasicProcess(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree);
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.fontSize || DEFAULTS.fontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;
  const connColor = style.connectorColor || CONNECTOR_DEFAULT;

  const arrowGap = 10;

  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.itemSpacing = arrowGap;
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";

  const arrowCount = Math.max(0, items.length - 1);
  const arrowW = DEFAULTS.arrowSize;
  const totalArrowW = arrowCount * arrowW;
  const totalGaps = (items.length + arrowCount - 1) * arrowGap;
  const availW = width - DEFAULTS.blockPadding * 2 - totalArrowW - totalGaps;
  const blockW = Math.max(80, Math.floor(availW / items.length));
  const blockH = height - DEFAULTS.blockPadding * 2;

  for (let i = 0; i < items.length; i++) {
    const block = await createBlock(
      items[i],
      blockW,
      blockH,
      getColor(palette, i),
      fontSize,
      fontFamily,
      cr
    );
    block.name = `Step ${i + 1}`;
    frame.appendChild(block);
    block.layoutSizingHorizontal = "FILL";
    block.layoutSizingVertical = "FILL";

    // Arrow between steps (with gap via itemSpacing)
    if (i < items.length - 1) {
      const arrowH = Math.min(blockH * 0.35, 20);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${arrowW}" height="${arrowH}" viewBox="0 0 ${arrowW} ${arrowH}">
        <polygon points="2,2 ${arrowW - 2},${arrowH / 2} 2,${arrowH - 2}" fill="${rgbString(connColor)}" stroke="${rgbString(connColor)}" stroke-width="1" stroke-linejoin="round"/>
      </svg>`;
      const arrowNode = figma.createNodeFromSvg(svg);
      arrowNode.name = `Arrow ${i + 1}`;
      arrowNode.resize(arrowW, arrowH);
      frame.appendChild(arrowNode);
    }
  }
}

// --- 4. Chevron Process ---
async function renderChevronProcess(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree);
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.fontSize || DEFAULTS.fontSize;
  const pd = DEFAULTS.chevronPointDepth;

  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.itemSpacing = -pd / 2; // overlap for connected look
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";

  const innerH = height - DEFAULTS.blockPadding * 2;
  const totalW = width - DEFAULTS.blockPadding * 2;
  const chevronW = Math.max(
    100,
    Math.floor((totalW + (pd / 2) * (items.length - 1)) / items.length)
  );

  for (let i = 0; i < items.length; i++) {
    const color = getColor(palette, i);
    const isFirst = i === 0;
    const w = chevronW;
    const h = innerH;
    const rgb = rgbString(color);

    // Chevron path: first has flat left, others have notched left
    let path: string;
    if (isFirst) {
      path = `M 0 0 L ${w - pd} 0 L ${w} ${h / 2} L ${w - pd} ${h} L 0 ${h} Z`;
    } else {
      path = `M 0 0 L ${w - pd} 0 L ${w} ${h / 2} L ${w - pd} ${h} L 0 ${h} L ${pd} ${h / 2} Z`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="${path}" fill="${rgb}"/>
    </svg>`;

    // Container for chevron + text overlay
    const container = figma.createFrame();
    container.name = `Chevron ${i + 1}`;
    container.resize(w, h);
    container.fills = [];
    container.clipsContent = false;

    // Add SVG chevron
    const chevronNode = figma.createNodeFromSvg(svg);
    chevronNode.x = 0;
    chevronNode.y = 0;
    chevronNode.resize(w, h);
    container.appendChild(chevronNode);

    // Add text overlay (centered)
    const tc = textColorFor(color);
    const textNode = await makeTextNode(
      items[i],
      fontSize,
      fontFamily,
      tc,
      true
    );
    textNode.textAlignHorizontal = "CENTER";
    textNode.resize(w - pd * 2, fontSize * 2);
    textNode.x = pd;
    textNode.y = (h - fontSize * 2) / 2;
    container.appendChild(textNode);

    frame.appendChild(container);
  }
}

// --- 5. Org Chart ---
async function renderOrgChart(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.fontSize || DEFAULTS.fontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;
  const connColor = style.connectorColor || CONNECTOR_DEFAULT;
  const connWidth = style.connectorWidth || 2;

  const nw = DEFAULTS.orgNodeWidth;
  const nh = DEFAULTS.orgNodeHeight;
  const levelGap = DEFAULTS.orgLevelGap;
  const sibGap = DEFAULTS.orgSiblingGap;

  // No auto-layout for org chart - use absolute positioning
  frame.layoutMode = "NONE";
  frame.fills = [];

  // Compute subtree widths
  interface NodeLayout {
    item: BulletItem;
    x: number;
    y: number;
    subtreeWidth: number;
    children: NodeLayout[];
  }

  function computeWidth(item: BulletItem): number {
    if (item.children.length === 0) return nw;
    let total = 0;
    for (let i = 0; i < item.children.length; i++) {
      if (i > 0) total += sibGap;
      total += computeWidth(item.children[i]);
    }
    return Math.max(nw, total);
  }

  function layoutTree(
    item: BulletItem,
    cx: number,
    y: number,
    depth: number
  ): NodeLayout {
    const sw = computeWidth(item);
    const childLayouts: NodeLayout[] = [];

    if (item.children.length > 0) {
      let startX = cx - sw / 2;
      for (const child of item.children) {
        const cw = computeWidth(child);
        const childCx = startX + cw / 2;
        childLayouts.push(
          layoutTree(child, childCx, y + nh + levelGap, depth + 1)
        );
        startX += cw + sibGap;
      }
    }

    return {
      item,
      x: cx - nw / 2,
      y,
      subtreeWidth: sw,
      children: childLayouts,
    };
  }

  // Layout all root items side by side
  let totalWidth = 0;
  for (let i = 0; i < tree.items.length; i++) {
    if (i > 0) totalWidth += sibGap * 2;
    totalWidth += computeWidth(tree.items[i]);
  }

  const layouts: NodeLayout[] = [];
  let startX = width / 2 - totalWidth / 2;
  for (const rootItem of tree.items) {
    const sw = computeWidth(rootItem);
    layouts.push(layoutTree(rootItem, startX + sw / 2, DEFAULTS.blockPadding, 0));
    startX += sw + sibGap * 2;
  }

  // Render nodes and connectors
  let colorIdx = 0;
  async function renderNode(layout: NodeLayout, depth: number) {
    const color = getColor(palette, colorIdx++);

    const block = await createBlock(
      layout.item.text,
      nw,
      nh,
      color,
      fontSize,
      fontFamily,
      cr
    );
    block.name = layout.item.text;
    block.x = layout.x;
    block.y = layout.y;
    frame.appendChild(block);

    // Draw connectors to children
    if (layout.children.length > 0) {
      const parentCx = layout.x + nw / 2;
      const parentBottom = layout.y + nh;
      const midY = parentBottom + levelGap / 2;

      const childCxs = layout.children.map((c) => c.x + nw / 2);
      const minCx = Math.min(...childCxs);
      const maxCx = Math.max(...childCxs);

      // SVG connector lines
      const svgW = Math.max(maxCx - minCx + connWidth * 2, connWidth * 2);
      const svgH = levelGap;
      const offsetX = layout.children.length > 1 ? minCx : parentCx - connWidth;

      let paths = "";
      const sw = connWidth;
      const rgb = rgbString(connColor);

      // Vertical line from parent down to midY
      const localPCx = parentCx - offsetX;
      paths += `<line x1="${localPCx}" y1="0" x2="${localPCx}" y2="${svgH / 2}" stroke="${rgb}" stroke-width="${sw}"/>`;

      // Horizontal line across children
      if (layout.children.length > 1) {
        const localMin = minCx - offsetX;
        const localMax = maxCx - offsetX;
        paths += `<line x1="${localMin}" y1="${svgH / 2}" x2="${localMax}" y2="${svgH / 2}" stroke="${rgb}" stroke-width="${sw}"/>`;
      }

      // Vertical lines down to each child
      for (const ccx of childCxs) {
        const localCcx = ccx - offsetX;
        paths += `<line x1="${localCcx}" y1="${svgH / 2}" x2="${localCcx}" y2="${svgH}" stroke="${rgb}" stroke-width="${sw}"/>`;
      }

      const connSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">${paths}</svg>`;
      const connNode = figma.createNodeFromSvg(connSvg);
      connNode.name = "Connector";
      connNode.x = offsetX;
      connNode.y = parentBottom;
      frame.appendChild(connNode);

      for (const child of layout.children) {
        await renderNode(child, depth + 1);
      }
    }
  }

  for (const layout of layouts) {
    await renderNode(layout, 0);
  }
}

// --- 6. Basic Venn ---
async function renderBasicVenn(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree).slice(0, 3); // max 3
  if (items.length < 2) {
    throw new Error("Venn diagram requires at least 2 items.");
  }
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.titleFontSize || DEFAULTS.titleFontSize;

  frame.layoutMode = "NONE";
  frame.fills = [];

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  const overlap = radius * DEFAULTS.vennOverlapRatio;

  // Position circles
  let positions: { x: number; y: number }[];
  if (items.length === 2) {
    positions = [
      { x: cx - radius + overlap, y: cy },
      { x: cx + radius - overlap, y: cy },
    ];
  } else {
    // Equilateral triangle
    const dist = radius - overlap;
    positions = [
      { x: cx, y: cy - dist * 0.7 },
      { x: cx - dist * 0.8, y: cy + dist * 0.5 },
      { x: cx + dist * 0.8, y: cy + dist * 0.5 },
    ];
  }

  for (let i = 0; i < items.length; i++) {
    const color = getColor(palette, i);
    const pos = positions[i];

    const ellipse = figma.createEllipse();
    ellipse.resize(radius * 2, radius * 2);
    ellipse.x = pos.x - radius;
    ellipse.y = pos.y - radius;
    ellipse.fills = [
      { type: "SOLID", color: toRGB(color), opacity: 0.55 },
    ];
    ellipse.name = items[i];
    frame.appendChild(ellipse);

    // Label
    const tc = textColorFor(color);
    const label = await makeTextNode(items[i], fontSize, fontFamily, DARK_TEXT, true);
    label.textAlignHorizontal = "CENTER";
    label.x = pos.x - 50;
    label.y = pos.y - fontSize / 2;
    label.resize(100, fontSize * 1.5);
    frame.appendChild(label);
  }
}

// --- 7. Basic Cycle ---
async function renderBasicCycle(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree);
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.fontSize || DEFAULTS.fontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;
  const connColor = style.connectorColor || CONNECTOR_DEFAULT;

  frame.layoutMode = "NONE";
  frame.fills = [];

  const cx = width / 2;
  const cy = height / 2;
  const nodeSize = DEFAULTS.cycleNodeSize;
  const radius = Math.min(width, height) / 2 - nodeSize - 10;

  // Position items on circle
  for (let i = 0; i < items.length; i++) {
    const angle = (2 * Math.PI * i) / items.length - Math.PI / 2;
    const nx = cx + radius * Math.cos(angle) - nodeSize / 2;
    const ny = cy + radius * Math.sin(angle) - nodeSize / 2;
    const color = getColor(palette, i);

    const block = await createBlock(
      items[i],
      nodeSize,
      nodeSize,
      color,
      fontSize - 2,
      fontFamily,
      cr
    );
    block.name = items[i];
    block.x = nx;
    block.y = ny;
    frame.appendChild(block);
  }

  // Draw arrows between consecutive items
  if (items.length >= 2) {
    const arrowRadius = radius * 0.72;
    let arrowPaths = "";
    const rgb = rgbString(connColor);

    for (let i = 0; i < items.length; i++) {
      const a1 =
        (2 * Math.PI * i) / items.length -
        Math.PI / 2 +
        0.3 / items.length * Math.PI;
      const a2 =
        (2 * Math.PI * ((i + 1) % items.length)) / items.length -
        Math.PI / 2 -
        0.3 / items.length * Math.PI;

      const x1 = cx + arrowRadius * Math.cos(a1);
      const y1 = cy + arrowRadius * Math.sin(a1);
      const x2 = cx + arrowRadius * Math.cos(a2);
      const y2 = cy + arrowRadius * Math.sin(a2);

      // Control point pushed outward
      const midA = (a1 + a2) / 2;
      const ctrlR = arrowRadius * 1.15;
      const ctrlX = cx + ctrlR * Math.cos(midA);
      const ctrlY = cy + ctrlR * Math.sin(midA);

      arrowPaths += `<path d="M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}" fill="none" stroke="${rgb}" stroke-width="2"/>`;

      // Arrowhead
      const headSize = 6;
      const endAngle = Math.atan2(y2 - ctrlY, x2 - ctrlX);
      const hx1 = x2 - headSize * Math.cos(endAngle - Math.PI / 6);
      const hy1 = y2 - headSize * Math.sin(endAngle - Math.PI / 6);
      const hx2 = x2 - headSize * Math.cos(endAngle + Math.PI / 6);
      const hy2 = y2 - headSize * Math.sin(endAngle + Math.PI / 6);
      arrowPaths += `<polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${rgb}"/>`;
    }

    const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${arrowPaths}</svg>`;
    const arrowNode = figma.createNodeFromSvg(arrowSvg);
    arrowNode.name = "Cycle Arrows";
    arrowNode.x = 0;
    arrowNode.y = 0;
    // Move arrows behind blocks
    frame.insertChild(0, arrowNode);
  }
}

// --- 8. Basic Matrix ---
async function renderBasicMatrix(
  frame: FrameNode,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  const items = flattenItems(tree).slice(0, 4);
  while (items.length < 4) items.push("");
  const palette = getPalette(style);
  const fontFamily = style.fontFamily || "Inter";
  const fontSize = style.titleFontSize || DEFAULTS.titleFontSize;
  const cr = style.blockCornerRadius ?? DEFAULTS.blockCornerRadius;
  const gap = 6;

  frame.layoutMode = "VERTICAL";
  frame.primaryAxisAlignItems = "CENTER";
  frame.counterAxisAlignItems = "CENTER";
  frame.itemSpacing = gap;
  frame.paddingLeft = DEFAULTS.blockPadding;
  frame.paddingRight = DEFAULTS.blockPadding;
  frame.paddingTop = DEFAULTS.blockPadding;
  frame.paddingBottom = DEFAULTS.blockPadding;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";

  const cellW = (width - DEFAULTS.blockPadding * 2 - gap) / 2;
  const cellH = (height - DEFAULTS.blockPadding * 2 - gap) / 2;

  for (let row = 0; row < 2; row++) {
    const rowFrame = figma.createFrame();
    rowFrame.name = `Row ${row + 1}`;
    rowFrame.layoutMode = "HORIZONTAL";
    rowFrame.itemSpacing = gap;
    rowFrame.fills = [];

    for (let col = 0; col < 2; col++) {
      const idx = row * 2 + col;
      const block = await createBlock(
        items[idx],
        cellW,
        cellH,
        getColor(palette, idx),
        fontSize,
        fontFamily,
        cr
      );
      block.name = `Cell ${idx + 1}`;
      rowFrame.appendChild(block);
      block.layoutSizingHorizontal = "FILL";
      block.layoutSizingVertical = "FILL";
    }

    frame.appendChild(rowFrame);
    rowFrame.layoutSizingHorizontal = "FILL";
    rowFrame.layoutSizingVertical = "FILL";
  }
}

// ============ RENDER DISPATCHER ============

async function renderSmartArt(
  frame: FrameNode,
  smartArtType: SmartArtType,
  tree: ParsedBulletTree,
  width: number,
  height: number,
  style: SmartArtStyle
) {
  // Clear existing children
  for (const child of [...frame.children]) {
    child.remove();
  }

  await loadFonts(style.fontFamily || "Inter");

  switch (smartArtType) {
    case "basic_block_list":
      await renderBasicBlockList(frame, tree, width, height, style);
      break;
    case "vertical_block_list":
      await renderVerticalBlockList(frame, tree, width, height, style);
      break;
    case "basic_process":
      await renderBasicProcess(frame, tree, width, height, style);
      break;
    case "chevron_process":
      await renderChevronProcess(frame, tree, width, height, style);
      break;
    case "org_chart":
      await renderOrgChart(frame, tree, width, height, style);
      break;
    case "basic_venn":
      await renderBasicVenn(frame, tree, width, height, style);
      break;
    case "basic_cycle":
      await renderBasicCycle(frame, tree, width, height, style);
      break;
    case "basic_matrix":
      await renderBasicMatrix(frame, tree, width, height, style);
      break;
    default:
      throw new Error(`Unknown SmartArt type: ${smartArtType}`);
  }
}

// ============ PUBLIC API ============

export async function createSmartArt(params: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  smartArtType: SmartArtType;
  bulletText: string;
  style?: SmartArtStyle;
  parentId?: string;
  name?: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 800,
    height = 400,
    smartArtType,
    bulletText,
    style = {},
    parentId,
    name,
  } = params;

  const tree = parseBulletText(bulletText);
  if (tree.totalCount === 0) {
    throw new Error("No items found in the provided bullet text.");
  }

  const parent = await getParentNode(parentId);

  const frame = figma.createFrame();
  frame.name = name || `SmartArt-${smartArtType}`;
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.clipsContent = true;
  frame.fills = style.backgroundColor
    ? [
        {
          type: "SOLID",
          color: toRGB(style.backgroundColor),
          opacity: style.backgroundColor.a ?? 1,
        },
      ]
    : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

  const metadata: SmartArtMetadata = {
    smartArtType,
    bulletText,
    style,
    width,
    height,
  };
  frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));

  await renderSmartArt(frame, smartArtType, tree, width, height, style);
  parent.appendChild(frame);

  return {
    id: frame.id,
    name: frame.name,
    smartArtType,
    x,
    y,
    width,
    height,
    itemCount: tree.totalCount,
    maxDepth: tree.maxDepth,
  };
}

export async function updateSmartArt(params: {
  smartArtId: string;
  bulletText?: string;
  style?: SmartArtStyle;
}) {
  const { smartArtId, bulletText, style: customStyle } = params;
  const node = await figma.getNodeByIdAsync(smartArtId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`SmartArt not found: ${smartArtId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(SMARTART_DATA_KEY);
  if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);

  const metadata: SmartArtMetadata = JSON.parse(raw);

  if (bulletText !== undefined) metadata.bulletText = bulletText;
  if (customStyle) metadata.style = { ...metadata.style, ...customStyle };

  const tree = parseBulletText(metadata.bulletText);
  if (tree.totalCount === 0) {
    throw new Error("No items found in the provided bullet text.");
  }

  frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));
  await renderSmartArt(
    frame,
    metadata.smartArtType,
    tree,
    metadata.width,
    metadata.height,
    metadata.style
  );

  return {
    id: smartArtId,
    name: frame.name,
    smartArtType: metadata.smartArtType,
    width: frame.width,
    height: frame.height,
    itemCount: tree.totalCount,
    updated: true,
  };
}

export async function changeSmartArtType(params: {
  smartArtId: string;
  newType: SmartArtType;
}) {
  const { smartArtId, newType } = params;
  const node = await figma.getNodeByIdAsync(smartArtId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`SmartArt not found: ${smartArtId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(SMARTART_DATA_KEY);
  if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);

  const metadata: SmartArtMetadata = JSON.parse(raw);
  const oldType = metadata.smartArtType;
  metadata.smartArtType = newType;

  const tree = parseBulletText(metadata.bulletText);

  frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));
  await renderSmartArt(
    frame,
    newType,
    tree,
    metadata.width,
    metadata.height,
    metadata.style
  );

  // Update frame name
  frame.name = frame.name.replace(oldType, newType);

  return {
    id: smartArtId,
    name: frame.name,
    oldType,
    newType,
    itemCount: tree.totalCount,
  };
}

export async function getSmartArtInfo(params: { smartArtId: string }) {
  const { smartArtId } = params;
  const node = await figma.getNodeByIdAsync(smartArtId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`SmartArt not found: ${smartArtId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(SMARTART_DATA_KEY);
  if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);

  const metadata: SmartArtMetadata = JSON.parse(raw);
  const tree = parseBulletText(metadata.bulletText);

  return {
    id: smartArtId,
    name: frame.name,
    smartArtType: metadata.smartArtType,
    width: frame.width,
    height: frame.height,
    bulletText: metadata.bulletText,
    style: metadata.style,
    itemCount: tree.totalCount,
    maxDepth: tree.maxDepth,
    items: tree.items.map((item) => ({
      text: item.text,
      children: item.children.map((c) => c.text),
    })),
  };
}
