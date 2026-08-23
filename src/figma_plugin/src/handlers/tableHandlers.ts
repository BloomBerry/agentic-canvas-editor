// Table Handlers - Text/CSV/TSV/Markdown → Figma Table
// text-to-table: 텍스트 데이터를 Frame 기반 테이블로 변환
import { nodeIdMap, lookupNode } from "../bridge";

// ============ TYPES ============

interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

type TextFormat = "csv" | "tsv" | "markdown" | "auto";
type ColumnAlignment = "LEFT" | "CENTER" | "RIGHT";

interface TableStyle {
  headerBackground?: RGBA;
  headerTextColor?: RGBA;
  cellBackground?: RGBA;
  cellTextColor?: RGBA;
  borderColor?: RGBA;
  borderWidth?: number;
  cellPadding?: number;
  fontSize?: number;
  headerFontSize?: number;
  fontFamily?: string;
  minCellWidth?: number;
  minCellHeight?: number;
  stripedRows?: boolean;
  stripedColor?: RGBA;
  cornerRadius?: number;
}

interface TableMetadata {
  text: string;
  format: TextFormat;
  style: TableStyle;
  width: number;
  height?: number;
  alignments: ColumnAlignment[];
  hasHeader: boolean;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
  alignments: ColumnAlignment[];
  hasHeader: boolean;
}

// ============ CONSTANTS ============

const TABLE_DATA_KEY = "table_metadata";

const DEFAULT_STYLE: Required<TableStyle> = {
  headerBackground: { r: 0.957, g: 0.957, b: 0.961, a: 1 },   // #F4F4F5
  headerTextColor: { r: 0.02, g: 0.02, b: 0.02, a: 1 },       // #050505
  cellBackground: { r: 1, g: 1, b: 1, a: 1 },                   // white
  cellTextColor: { r: 0.035, g: 0.035, b: 0.043, a: 1 },       // #09090B
  borderColor: { r: 0.894, g: 0.894, b: 0.906, a: 1 },         // #E4E4E7
  borderWidth: 1,
  cellPadding: 12,
  fontSize: 14,
  headerFontSize: 14,
  fontFamily: "Inter",
  minCellWidth: 80,
  minCellHeight: 40,
  stripedRows: false,
  stripedColor: { r: 0.98, g: 0.98, b: 0.985, a: 1 },         // #FAFAFB
  cornerRadius: 0,
};

// ============ PARSERS ============

function detectFormat(text: string): TextFormat {
  const lines = text.trim().split("\n");
  // Check markdown: lines with pipes
  if (lines.some((l) => l.trim().startsWith("|") && l.trim().endsWith("|"))) {
    return "markdown";
  }
  // Check TSV: tabs present
  if (lines.some((l) => l.includes("\t"))) {
    return "tsv";
  }
  return "csv";
}

function parseCSV(text: string, delimiter: string = ","): string[][] {
  const rows: string[][] = [];
  const lines = text.trim().split("\n");

  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }

  return rows;
}

function parseTSV(text: string): string[][] {
  return parseCSV(text, "\t");
}

function parseMarkdown(text: string): ParsedTable {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const tableLines = lines.filter((l) => l.includes("|"));
  if (tableLines.length === 0) {
    return { headers: [], rows: [], alignments: [], hasHeader: false };
  }

  const parseLine = (line: string): string[] => {
    let trimmed = line;
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map((c) => c.trim());
  };

  // Detect separator line (e.g., |---|:---:|---:|)
  const isSeparator = (line: string): boolean => {
    const cells = parseLine(line);
    return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
  };

  // Find separator index
  let sepIdx = -1;
  for (let i = 0; i < tableLines.length; i++) {
    if (isSeparator(tableLines[i])) {
      sepIdx = i;
      break;
    }
  }

  let headers: string[] = [];
  let dataRows: string[][] = [];
  let alignments: ColumnAlignment[] = [];
  let hasHeader = false;

  if (sepIdx >= 0) {
    // Parse alignments from separator
    const sepCells = parseLine(tableLines[sepIdx]);
    alignments = sepCells.map((c) => {
      const t = c.trim();
      if (t.startsWith(":") && t.endsWith(":")) return "CENTER";
      if (t.endsWith(":")) return "RIGHT";
      return "LEFT";
    });

    // Header = line(s) before separator
    if (sepIdx > 0) {
      headers = parseLine(tableLines[sepIdx - 1]);
      hasHeader = true;
    }

    // Data = lines after separator
    for (let i = sepIdx + 1; i < tableLines.length; i++) {
      if (!isSeparator(tableLines[i])) {
        dataRows.push(parseLine(tableLines[i]));
      }
    }
  } else {
    // No separator: first line = header, rest = data
    headers = parseLine(tableLines[0]);
    hasHeader = true;
    for (let i = 1; i < tableLines.length; i++) {
      dataRows.push(parseLine(tableLines[i]));
    }
    alignments = headers.map(() => "LEFT" as ColumnAlignment);
  }

  return { headers, rows: dataRows, alignments, hasHeader };
}

function parseText(text: string, format: TextFormat): ParsedTable {
  const fmt = format === "auto" ? detectFormat(text) : format;

  if (fmt === "markdown") {
    return parseMarkdown(text);
  }

  const raw = fmt === "tsv" ? parseTSV(text) : parseCSV(text);
  if (raw.length === 0) {
    return { headers: [], rows: [], alignments: [], hasHeader: false };
  }

  const headers = raw[0];
  const rows = raw.slice(1);
  const alignments: ColumnAlignment[] = headers.map(() => "LEFT");

  return { headers, rows, alignments, hasHeader: true };
}

// ============ HELPERS ============

function toRGB(c: RGBA): RGB {
  return { r: c.r, g: c.g, b: c.b };
}

function mergeStyle(custom?: TableStyle): Required<TableStyle> {
  return { ...DEFAULT_STYLE, ...custom };
}

async function loadFont(family: string = "Inter", style: string = "Regular") {
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

async function getParentNode(parentId?: string): Promise<BaseNode & ChildrenMixin> {
  if (parentId) {
    const node = await resolveParentId(parentId);
    if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
      return node as FrameNode | PageNode;
    }
  }
  const focusedSlide = (figma.currentPage as any).focusedSlide as SceneNode | null;
  return (focusedSlide as any) || figma.currentPage;
}

// ============ TABLE RENDERER ============

async function renderTable(
  frame: FrameNode,
  parsed: ParsedTable,
  tableWidth: number,
  style: Required<TableStyle>,
  tableHeight?: number
) {
  // Clear existing children
  for (const child of [...frame.children]) {
    child.remove();
  }

  await loadFonts(style.fontFamily);

  const colCount = Math.max(
    parsed.headers.length,
    ...parsed.rows.map((r) => r.length)
  );
  if (colCount === 0) return;

  const colWidth = Math.max(tableWidth / colCount, style.minCellWidth);
  const actualWidth = colWidth * colCount;

  // Helper: create a single cell frame
  const createCell = async (
    text: string,
    colIdx: number,
    isHeader: boolean,
    rowIdx: number
  ): Promise<FrameNode> => {
    const cell = figma.createFrame();
    cell.name = isHeader ? `Header-${colIdx}` : `Cell-${rowIdx}-${colIdx}`;
    cell.resize(colWidth, style.minCellHeight);
    cell.layoutMode = "HORIZONTAL";
    cell.primaryAxisAlignItems = "CENTER";
    cell.counterAxisAlignItems = "CENTER";
    cell.paddingLeft = style.cellPadding;
    cell.paddingRight = style.cellPadding;
    cell.paddingTop = 8;
    cell.paddingBottom = 8;
    cell.layoutSizingHorizontal = "FIXED"; // will be changed to FILL after appendChild
    cell.layoutSizingVertical = "HUG";

    // Background
    let bgColor: RGBA;
    if (isHeader) {
      bgColor = style.headerBackground;
    } else if (style.stripedRows && rowIdx % 2 === 1) {
      bgColor = style.stripedColor;
    } else {
      bgColor = style.cellBackground;
    }
    cell.fills = [{ type: "SOLID", color: toRGB(bgColor), opacity: bgColor.a ?? 1 }];

    // Text node
    const textNode = figma.createText();
    textNode.characters = text || "";
    textNode.fontSize = isHeader ? style.headerFontSize : style.fontSize;
    textNode.fontName = {
      family: style.fontFamily,
      style: isHeader ? "Bold" : "Regular",
    };
    textNode.fills = [
      {
        type: "SOLID",
        color: toRGB(isHeader ? style.headerTextColor : style.cellTextColor),
      },
    ];

    // Alignment
    const align =
      colIdx < parsed.alignments.length
        ? parsed.alignments[colIdx]
        : "LEFT";
    textNode.textAlignHorizontal = align;

    // Must appendChild BEFORE setting layoutSizing (requires auto-layout parent)
    cell.appendChild(textNode);
    textNode.layoutSizingHorizontal = "FILL";

    // Bottom border
    cell.strokes = [{ type: "SOLID", color: toRGB(style.borderColor) }];
    cell.strokeWeight = style.borderWidth;
    cell.strokeAlign = "INSIDE";
    // Only bottom border via individual strokes
    cell.strokeTopWeight = 0;
    cell.strokeLeftWeight = 0;
    cell.strokeRightWeight = 0;
    cell.strokeBottomWeight = style.borderWidth;

    return cell;
  };

  // Helper: create a row frame
  const createRow = (name: string): FrameNode => {
    const row = figma.createFrame();
    row.name = name;
    row.layoutMode = "HORIZONTAL";
    row.counterAxisAlignItems = "MIN";
    row.layoutSizingHorizontal = "FIXED"; // will be changed to FILL after appendChild
    row.layoutSizingVertical = "HUG";
    row.fills = [];
    row.itemSpacing = 0;
    row.resize(actualWidth, row.height);
    return row;
  };

  // Configure main frame as vertical auto-layout
  // Default row height: distribute total height evenly across all rows
  const totalRows = parsed.rows.length + (parsed.hasHeader && parsed.headers.length > 0 ? 1 : 0);
  const defaultHeight = totalRows * style.minCellHeight;
  const frameHeight = (tableHeight !== undefined && tableHeight > 0) ? tableHeight : defaultHeight;

  frame.layoutMode = "VERTICAL";
  frame.primaryAxisAlignItems = "MIN";
  frame.counterAxisAlignItems = "MIN";
  frame.itemSpacing = 0;
  frame.layoutSizingHorizontal = "FIXED";
  frame.layoutSizingVertical = "FIXED";
  frame.resize(actualWidth, frameHeight);
  frame.clipsContent = true;
  frame.fills = [{ type: "SOLID", color: toRGB(style.cellBackground) }];

  if (style.cornerRadius > 0) {
    frame.cornerRadius = style.cornerRadius;
  }

  // Render header row
  if (parsed.hasHeader && parsed.headers.length > 0) {
    const headerRow = createRow("Header Row");
    for (let c = 0; c < colCount; c++) {
      const text = c < parsed.headers.length ? parsed.headers[c] : "";
      const cell = await createCell(text, c, true, -1);
      headerRow.appendChild(cell);
      cell.layoutSizingHorizontal = "FILL";
      cell.layoutSizingVertical = "FILL";
    }
    frame.appendChild(headerRow);
    headerRow.layoutSizingHorizontal = "FILL";
    headerRow.layoutSizingVertical = "FILL";
  }

  // Render data rows
  for (let r = 0; r < parsed.rows.length; r++) {
    const rowFrame = createRow(`Row ${r}`);
    for (let c = 0; c < colCount; c++) {
      const text = c < parsed.rows[r].length ? parsed.rows[r][c] : "";
      const cell = await createCell(text, c, false, r);
      rowFrame.appendChild(cell);
      cell.layoutSizingHorizontal = "FILL";
      cell.layoutSizingVertical = "FILL";
    }
    frame.appendChild(rowFrame);
    rowFrame.layoutSizingHorizontal = "FILL";
    rowFrame.layoutSizingVertical = "FILL";
  }
}

// ============ PUBLIC API ============

export async function createTable(params: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text: string;
  format?: TextFormat;
  hasHeader?: boolean;
  style?: TableStyle;
  parentId?: string;
  name?: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 600,
    height,
    text,
    format = "auto",
    style: customStyle,
    parentId,
    name,
  } = params;

  const style = mergeStyle(customStyle);
  const parsed = parseText(text, format);

  if (parsed.headers.length === 0 && parsed.rows.length === 0) {
    throw new Error("No table data found in the provided text.");
  }

  // Override hasHeader if explicitly set
  if (params.hasHeader !== undefined) {
    parsed.hasHeader = params.hasHeader;
  }

  const parent = await getParentNode(parentId);

  const frame = figma.createFrame();
  frame.name = name || "Table";
  frame.x = x;
  frame.y = y;

  // Save metadata
  const metadata: TableMetadata = {
    text,
    format,
    style,
    width,
    height,
    alignments: parsed.alignments,
    hasHeader: parsed.hasHeader,
  };
  frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));

  await renderTable(frame, parsed, width, style, height);
  parent.appendChild(frame);

  return {
    id: frame.id,
    name: frame.name,
    x,
    y,
    width: frame.width,
    height: frame.height,
    columns: parsed.headers.length || (parsed.rows[0]?.length ?? 0),
    rows: parsed.rows.length,
    hasHeader: parsed.hasHeader,
    format: format === "auto" ? detectFormat(text) : format,
  };
}

export async function updateTable(params: {
  tableId: string;
  text?: string;
  format?: TextFormat;
  style?: TableStyle;
}) {
  const { tableId, text, format, style: customStyle } = params;
  const node = await figma.getNodeByIdAsync(tableId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Table not found: ${tableId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(TABLE_DATA_KEY);
  if (!raw) throw new Error(`No table metadata found for: ${tableId}`);

  const metadata: TableMetadata = JSON.parse(raw);

  if (text !== undefined) metadata.text = text;
  if (format !== undefined) metadata.format = format;
  if (customStyle) metadata.style = { ...metadata.style, ...customStyle };

  const style = mergeStyle(metadata.style);
  const parsed = parseText(metadata.text, metadata.format);
  parsed.hasHeader = metadata.hasHeader;
  if (metadata.alignments.length > 0) {
    parsed.alignments = metadata.alignments;
  }

  frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));
  await renderTable(frame, parsed, metadata.width, style, metadata.height);

  return {
    id: tableId,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    columns: parsed.headers.length || (parsed.rows[0]?.length ?? 0),
    rows: parsed.rows.length,
    updated: true,
  };
}

export async function createTableFromData(params: {
  x?: number;
  y?: number;
  width?: number;
  headers: string[];
  rows: string[][];
  alignments?: ColumnAlignment[];
  style?: TableStyle;
  parentId?: string;
  name?: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 600,
    headers,
    rows,
    alignments,
    style: customStyle,
    parentId,
    name,
  } = params;

  const style = mergeStyle(customStyle);

  const parsed: ParsedTable = {
    headers,
    rows,
    alignments: alignments || headers.map(() => "LEFT" as ColumnAlignment),
    hasHeader: headers.length > 0,
  };

  const parent = await getParentNode(parentId);

  const frame = figma.createFrame();
  frame.name = name || "Table";
  frame.x = x;
  frame.y = y;

  // Construct CSV text for metadata storage
  const csvLines: string[] = [];
  if (headers.length > 0) csvLines.push(headers.join(","));
  for (const row of rows) csvLines.push(row.join(","));
  const csvText = csvLines.join("\n");

  const metadata: TableMetadata = {
    text: csvText,
    format: "csv",
    style,
    width,
    alignments: parsed.alignments,
    hasHeader: parsed.hasHeader,
  };
  frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));

  await renderTable(frame, parsed, width, style);
  parent.appendChild(frame);

  return {
    id: frame.id,
    name: frame.name,
    x,
    y,
    width: frame.width,
    height: frame.height,
    columns: headers.length,
    rows: rows.length,
    hasHeader: true,
  };
}

export async function getTableInfo(params: { tableId: string }) {
  const { tableId } = params;
  const node = await figma.getNodeByIdAsync(tableId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Table not found: ${tableId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(TABLE_DATA_KEY);
  if (!raw) throw new Error(`No table metadata found for: ${tableId}`);

  const metadata: TableMetadata = JSON.parse(raw);
  const parsed = parseText(metadata.text, metadata.format);

  return {
    id: tableId,
    name: frame.name,
    width: frame.width,
    height: frame.height,
    format: metadata.format,
    columns: parsed.headers.length || (parsed.rows[0]?.length ?? 0),
    rows: parsed.rows.length,
    hasHeader: metadata.hasHeader,
    headers: parsed.headers,
    data: parsed.rows,
    alignments: metadata.alignments,
    style: metadata.style,
  };
}
