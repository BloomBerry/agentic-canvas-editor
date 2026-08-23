// Data Chart Handlers - Excel 테이블 데이터 → Figma 차트 생성
// UChart-like: tabular data input → vector + text frame output
import { nodeIdMap, lookupNode } from "../bridge";

// ============ TYPES & INTERFACES ============

interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface TabularData {
  headers: string[]; // 첫 번째 = 카테고리 열, 나머지 = 데이터 시리즈
  rows: (string | number)[][];
}

interface SeriesData {
  name: string;
  values: number[];
  color: RGBA;
}

type DataChartType =
  | "bar"
  | "line"
  | "pie"
  | "donut"
  | "area"
  | "stacked_bar";

type MarkerShape =
  | "circle"
  | "square"
  | "diamond"
  | "triangle_up"
  | "triangle_down"
  | "star"
  | "pentagon"
  | "hexagon"
  | "x"
  | "plus";

interface ChartOptions {
  title?: string;
  showTitle?: boolean;
  showGrid?: boolean;
  showLabels?: boolean;
  showValues?: boolean;
  showLegend?: boolean;
  showDots?: boolean;
  showAxis?: boolean;
  dotSize?: number;
  markerShape?: MarkerShape;
  legendPosition?: "top" | "bottom" | "left" | "right";
  orientation?: "vertical" | "horizontal";
  xAxisLabel?: string;
  yAxisLabel?: string;
  valueFormat?: "number" | "percent" | "currency";
  currencySymbol?: string;
  decimalPlaces?: number;
  colors?: RGBA[];
  backgroundColor?: RGBA;
  fontFamily?: string;
  fontSize?: number;
  barCornerRadius?: number;
  lineWidth?: number;
  innerRadius?: number; // donut only (0-1)
  centerLabel?: string; // donut only
  stackedValueMode?: "total" | "segment"; // stacked_bar only: "total" = sum on top, "segment" = per-segment labels
}

interface DataChartMetadata {
  chartType: DataChartType;
  data: TabularData;
  options: ChartOptions;
  width: number;
  height: number;
}

// ============ CONSTANTS ============

const DATA_CHART_KEY = "data_chart_metadata";

const DEFAULT_PALETTE: RGBA[] = [
  { r: 0.259, g: 0.522, b: 0.957, a: 1 }, // #4285F4 blue
  { r: 0.918, g: 0.263, b: 0.208, a: 1 }, // #EA4335 red
  { r: 0.984, g: 0.737, b: 0.016, a: 1 }, // #FBBC04 yellow
  { r: 0.208, g: 0.659, b: 0.325, a: 1 }, // #34A853 green
  { r: 1.0, g: 0.42, b: 0.176, a: 1 },    // #FF6B2D orange
  { r: 0.541, g: 0.318, b: 0.831, a: 1 }, // #8A51D4 purple
  { r: 0.0, g: 0.737, b: 0.831, a: 1 },   // #00BCD4 cyan
  { r: 0.914, g: 0.118, b: 0.388, a: 1 }, // #E91E63 pink
];

const CHART_PADDING = { top: 20, right: 20, bottom: 20, left: 20 };
const AXIS_LABEL_FONT_SIZE = 10;
const TITLE_FONT_SIZE = 16;
const VALUE_FONT_SIZE = 9;
const LEGEND_FONT_SIZE = 11;
const TICK_LENGTH = 4;
const GRID_COLOR: RGBA = { r: 0.9, g: 0.9, b: 0.9, a: 1 };
const AXIS_COLOR: RGBA = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
const LABEL_COLOR: RGBA = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
const TITLE_COLOR: RGBA = { r: 0.15, g: 0.15, b: 0.15, a: 1 };

// ============ HELPERS ============

function toRGB(c: RGBA): RGB {
  return { r: c.r, g: c.g, b: c.b };
}

async function loadFont(family: string = "Inter", style: string = "Regular") {
  try {
    await figma.loadFontAsync({ family, style });
  } catch {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

async function makeText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: RGBA,
  align: "LEFT" | "CENTER" | "RIGHT" = "LEFT",
  fontFamily?: string
): Promise<TextNode> {
  await loadFont(fontFamily);
  const node = figma.createText();
  node.characters = text;
  node.fontSize = fontSize;
  node.x = x;
  node.y = y;
  node.fills = [{ type: "SOLID", color: toRGB(color) }];
  node.textAlignHorizontal = align;
  return node;
}

function formatValue(
  val: number,
  fmt?: "number" | "percent" | "currency",
  symbol?: string,
  decimals?: number
): string {
  const d = decimals ?? 0;
  switch (fmt) {
    case "percent":
      return `${val.toFixed(d)}%`;
    case "currency":
      return `${symbol || "$"}${val.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
    default:
      return d > 0 ? val.toFixed(d) : val.toLocaleString();
  }
}

/**
 * Create a marker shape node at the given position.
 * Supports: circle, square, diamond, triangle_up, triangle_down, star, pentagon, hexagon, x, plus
 */
function createMarker(
  shape: MarkerShape,
  cx: number,
  cy: number,
  size: number,
  fillColor: RGB,
  strokeColor?: RGB,
  strokeWeight?: number
): SceneNode {
  // Scale up all markers for better visibility
  const s = size * 1.3;
  const half = s / 2;

  switch (shape) {
    case "square": {
      const rect = figma.createRectangle();
      rect.resize(s, s);
      rect.x = cx - half;
      rect.y = cy - half;
      rect.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        rect.strokes = [{ type: "SOLID", color: strokeColor }];
        rect.strokeWeight = strokeWeight ?? 0;
      }
      return rect;
    }

    case "diamond": {
      const rect = figma.createRectangle();
      const dSize = size * 1.5;
      rect.resize(dSize, dSize);
      rect.rotation = 45;
      rect.x = cx - dSize * 0.35;
      rect.y = cy - dSize * 0.5;
      rect.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        rect.strokes = [{ type: "SOLID", color: strokeColor }];
        rect.strokeWeight = strokeWeight ?? 0;
      }
      return rect;
    }

    case "triangle_up": {
      const poly = figma.createPolygon();
      poly.pointCount = 3;
      poly.resize(s, s);
      poly.x = cx - half;
      poly.y = cy - half;
      poly.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        poly.strokes = [{ type: "SOLID", color: strokeColor }];
        poly.strokeWeight = strokeWeight ?? 0;
      }
      return poly;
    }

    case "triangle_down": {
      const poly = figma.createPolygon();
      poly.pointCount = 3;
      poly.resize(s, s);
      poly.rotation = 180;
      poly.x = cx + half;
      poly.y = cy + half;
      poly.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        poly.strokes = [{ type: "SOLID", color: strokeColor }];
        poly.strokeWeight = strokeWeight ?? 0;
      }
      return poly;
    }

    case "star": {
      const star = figma.createStar();
      star.pointCount = 5;
      star.innerRadius = 0.4;
      star.resize(s, s);
      star.x = cx - half;
      star.y = cy - half;
      star.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        star.strokes = [{ type: "SOLID", color: strokeColor }];
        star.strokeWeight = strokeWeight ?? 0;
      }
      return star;
    }

    case "pentagon": {
      const poly = figma.createPolygon();
      poly.pointCount = 5;
      poly.resize(s, s);
      poly.x = cx - half;
      poly.y = cy - half;
      poly.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        poly.strokes = [{ type: "SOLID", color: strokeColor }];
        poly.strokeWeight = strokeWeight ?? 0;
      }
      return poly;
    }

    case "hexagon": {
      const poly = figma.createPolygon();
      poly.pointCount = 6;
      poly.resize(s, s);
      poly.x = cx - half;
      poly.y = cy - half;
      poly.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        poly.strokes = [{ type: "SOLID", color: strokeColor }];
        poly.strokeWeight = strokeWeight ?? 0;
      }
      return poly;
    }

    case "x": {
      const pad = s * 0.15;
      const sw = Math.max(1.5, s * 0.2);
      const r = Math.round;
      const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
      const svgStr = `<svg width="${s}" height="${s}"><line x1="${pad}" y1="${pad}" x2="${s - pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${s - pad}" y1="${pad}" x2="${pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
      const node = figma.createNodeFromSvg(svgStr);
      node.x = cx - half;
      node.y = cy - half;
      return node;
    }

    case "plus": {
      const mid = s / 2;
      const pad = s * 0.1;
      const sw = Math.max(1.5, s * 0.2);
      const r = Math.round;
      const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
      const svgStr = `<svg width="${s}" height="${s}"><line x1="${mid}" y1="${pad}" x2="${mid}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${pad}" y1="${mid}" x2="${s - pad}" y2="${mid}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
      const node = figma.createNodeFromSvg(svgStr);
      node.x = cx - half;
      node.y = cy - half;
      return node;
    }

    case "circle":
    default: {
      const ellipse = figma.createEllipse();
      ellipse.resize(s, s);
      ellipse.x = cx - half;
      ellipse.y = cy - half;
      ellipse.fills = [{ type: "SOLID", color: fillColor }];
      if (strokeColor) {
        ellipse.strokes = [{ type: "SOLID", color: strokeColor }];
        ellipse.strokeWeight = strokeWeight ?? 0;
      }
      return ellipse;
    }
  }
}

function parseTabularData(data: TabularData, colors?: RGBA[]): { categories: string[]; series: SeriesData[] } {
  const palette = colors && colors.length > 0 ? colors : DEFAULT_PALETTE;
  const categories = data.rows.map((row) => String(row[0]));
  const series: SeriesData[] = [];

  for (let col = 1; col < data.headers.length; col++) {
    series.push({
      name: data.headers[col],
      values: data.rows.map((row) => Number(row[col]) || 0),
      color: palette[(col - 1) % palette.length],
    });
  }

  return { categories, series };
}

function computeNiceTicks(min: number, max: number, targetCount: number = 5): number[] {
  if (min === max) return [min];
  const range = max - min;
  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceStep: number;
  if (residual <= 1.5) niceStep = magnitude;
  else if (residual <= 3) niceStep = 2 * magnitude;
  else if (residual <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
    ticks.push(Math.round(v * 1e10) / 1e10);
  }
  return ticks;
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

// ============ SHARED RENDER COMPONENTS ============

interface ChartLayout {
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
}

function computeLayout(
  width: number,
  height: number,
  opts: ChartOptions
): ChartLayout {
  const showTitle = opts.showTitle !== false && !!opts.title;
  const showLegend = opts.showLegend !== false;
  const showAxis = opts.showAxis !== false;
  const legendPos = opts.legendPosition || "bottom";
  const horizontal = opts.orientation === "horizontal";

  let top = CHART_PADDING.top;
  let bottom = CHART_PADDING.bottom;
  let left = CHART_PADDING.left;
  let right = CHART_PADDING.right;

  if (showTitle) top += TITLE_FONT_SIZE + 12;

  if (showAxis) {
    if (horizontal) {
      // Horizontal: Y-axis = category labels (need wider left), X-axis = value ticks
      left += 80; // category labels on Y-axis
      bottom += AXIS_LABEL_FONT_SIZE + 8; // value ticks on X-axis
      if (opts.yAxisLabel) left += AXIS_LABEL_FONT_SIZE + 6;
      if (opts.xAxisLabel) bottom += AXIS_LABEL_FONT_SIZE + 6;
    } else {
      bottom += AXIS_LABEL_FONT_SIZE + 8; // x-axis labels
      left += 40; // y-axis value labels
      if (opts.xAxisLabel) bottom += AXIS_LABEL_FONT_SIZE + 6;
      if (opts.yAxisLabel) left += AXIS_LABEL_FONT_SIZE + 6;
    }
  }

  if (showLegend) {
    if (legendPos === "bottom") bottom += LEGEND_FONT_SIZE + 16;
    else if (legendPos === "top") top += LEGEND_FONT_SIZE + 16;
    else if (legendPos === "left") left += 120;
    else if (legendPos === "right") right += 120;
  }

  return {
    plotX: left,
    plotY: top,
    plotW: Math.max(width - left - right, 40),
    plotH: Math.max(height - top - bottom, 40),
  };
}

async function renderTitle(
  frame: FrameNode,
  width: number,
  opts: ChartOptions
) {
  if (opts.showTitle === false || !opts.title) return;
  const fontSize = opts.fontSize ? opts.fontSize + 4 : TITLE_FONT_SIZE;
  const node = await makeText(
    opts.title,
    0,
    CHART_PADDING.top,
    fontSize,
    TITLE_COLOR,
    "CENTER",
    opts.fontFamily
  );
  node.x = (width - node.width) / 2;
  node.name = "Title";
  frame.appendChild(node);
}

async function renderAxis(
  frame: FrameNode,
  layout: ChartLayout,
  categories: string[],
  ticks: number[],
  opts: ChartOptions
) {
  if (opts.showAxis === false) return;

  const fontSize = opts.fontSize || AXIS_LABEL_FONT_SIZE;

  // Y-axis line
  const yAxisLine = figma.createRectangle();
  yAxisLine.name = "Y-Axis";
  yAxisLine.x = layout.plotX;
  yAxisLine.y = layout.plotY;
  yAxisLine.resize(1, layout.plotH);
  yAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
  frame.appendChild(yAxisLine);

  // X-axis line
  const xAxisLine = figma.createRectangle();
  xAxisLine.name = "X-Axis";
  xAxisLine.x = layout.plotX;
  xAxisLine.y = layout.plotY + layout.plotH;
  xAxisLine.resize(layout.plotW, 1);
  xAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
  frame.appendChild(xAxisLine);

  // Y-axis tick labels
  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  for (const tick of ticks) {
    const ratio = (tick - tickMin) / tickRange;
    const yPos = layout.plotY + layout.plotH - ratio * layout.plotH;

    // Tick mark
    const tickMark = figma.createRectangle();
    tickMark.name = `Tick-${tick}`;
    tickMark.x = layout.plotX - TICK_LENGTH;
    tickMark.y = yPos;
    tickMark.resize(TICK_LENGTH, 1);
    tickMark.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
    frame.appendChild(tickMark);

    // Tick label
    const label = await makeText(
      formatValue(tick, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "RIGHT",
      opts.fontFamily
    );
    label.x = layout.plotX - TICK_LENGTH - 4 - label.width;
    label.y = yPos - label.height / 2;
    label.name = `YLabel-${tick}`;
    frame.appendChild(label);
  }

  // X-axis category labels
  const catStep = layout.plotW / categories.length;
  for (let i = 0; i < categories.length; i++) {
    const cx = layout.plotX + i * catStep + catStep / 2;
    const label = await makeText(
      categories[i],
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    label.x = cx - label.width / 2;
    label.y = layout.plotY + layout.plotH + 6;
    label.name = `XLabel-${categories[i]}`;
    frame.appendChild(label);
  }

  // X-axis name
  if (opts.xAxisLabel) {
    const xLabel = await makeText(
      opts.xAxisLabel,
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    xLabel.x = layout.plotX + layout.plotW / 2 - xLabel.width / 2;
    xLabel.y = layout.plotY + layout.plotH + 6 + fontSize + 6;
    xLabel.name = "X-Axis Label";
    frame.appendChild(xLabel);
  }

  // Y-axis name (rendered horizontally, placed to the left)
  if (opts.yAxisLabel) {
    const yLabel = await makeText(
      opts.yAxisLabel,
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    yLabel.x = CHART_PADDING.left;
    yLabel.y = layout.plotY + layout.plotH / 2 - yLabel.height / 2;
    yLabel.rotation = 90;
    yLabel.name = "Y-Axis Label";
    frame.appendChild(yLabel);
  }
}

async function renderGrid(
  frame: FrameNode,
  layout: ChartLayout,
  ticks: number[],
  opts: ChartOptions
) {
  if (!opts.showGrid) return;

  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  for (const tick of ticks) {
    const ratio = (tick - tickMin) / tickRange;
    const yPos = layout.plotY + layout.plotH - ratio * layout.plotH;

    const gridLine = figma.createRectangle();
    gridLine.name = `Grid-${tick}`;
    gridLine.x = layout.plotX;
    gridLine.y = yPos;
    gridLine.resize(layout.plotW, 1);
    gridLine.fills = [{ type: "SOLID", color: toRGB(GRID_COLOR) }];
    gridLine.opacity = 0.7;
    frame.appendChild(gridLine);
  }
}

// Horizontal orientation: vertical grid lines + swapped axes
async function renderAxisHorizontal(
  frame: FrameNode,
  layout: ChartLayout,
  categories: string[],
  ticks: number[],
  opts: ChartOptions
) {
  if (opts.showAxis === false) return;

  const fontSize = opts.fontSize || AXIS_LABEL_FONT_SIZE;

  // Y-axis line (left)
  const yAxisLine = figma.createRectangle();
  yAxisLine.name = "Y-Axis";
  yAxisLine.x = layout.plotX;
  yAxisLine.y = layout.plotY;
  yAxisLine.resize(1, layout.plotH);
  yAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
  frame.appendChild(yAxisLine);

  // X-axis line (bottom)
  const xAxisLine = figma.createRectangle();
  xAxisLine.name = "X-Axis";
  xAxisLine.x = layout.plotX;
  xAxisLine.y = layout.plotY + layout.plotH;
  xAxisLine.resize(layout.plotW, 1);
  xAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
  frame.appendChild(xAxisLine);

  // Y-axis: category labels (on the left side)
  const catCount = categories.length;
  const catStep = layout.plotH / catCount;
  for (let i = 0; i < catCount; i++) {
    const cy = layout.plotY + i * catStep + catStep / 2;
    const label = await makeText(
      categories[i],
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "RIGHT",
      opts.fontFamily
    );
    label.x = layout.plotX - 6 - label.width;
    label.y = cy - label.height / 2;
    label.name = `YLabel-${categories[i]}`;
    frame.appendChild(label);
  }

  // X-axis: value tick labels (on the bottom)
  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  for (const tick of ticks) {
    const ratio = (tick - tickMin) / tickRange;
    const xPos = layout.plotX + ratio * layout.plotW;

    // Tick mark
    const tickMark = figma.createRectangle();
    tickMark.name = `Tick-${tick}`;
    tickMark.x = xPos;
    tickMark.y = layout.plotY + layout.plotH;
    tickMark.resize(1, TICK_LENGTH);
    tickMark.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
    frame.appendChild(tickMark);

    // Tick label
    const label = await makeText(
      formatValue(tick, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    label.x = xPos - label.width / 2;
    label.y = layout.plotY + layout.plotH + TICK_LENGTH + 2;
    label.name = `XLabel-${tick}`;
    frame.appendChild(label);
  }

  // X-axis label (value axis)
  if (opts.xAxisLabel) {
    const xLabel = await makeText(
      opts.xAxisLabel,
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    xLabel.x = layout.plotX + layout.plotW / 2 - xLabel.width / 2;
    xLabel.y = layout.plotY + layout.plotH + TICK_LENGTH + 2 + fontSize + 6;
    xLabel.name = "X-Axis Label";
    frame.appendChild(xLabel);
  }

  // Y-axis label (category axis)
  if (opts.yAxisLabel) {
    const yLabel = await makeText(
      opts.yAxisLabel,
      0,
      0,
      fontSize,
      LABEL_COLOR,
      "CENTER",
      opts.fontFamily
    );
    yLabel.x = CHART_PADDING.left;
    yLabel.y = layout.plotY + layout.plotH / 2 - yLabel.height / 2;
    yLabel.rotation = 90;
    yLabel.name = "Y-Axis Label";
    frame.appendChild(yLabel);
  }
}

async function renderGridHorizontal(
  frame: FrameNode,
  layout: ChartLayout,
  ticks: number[],
  opts: ChartOptions
) {
  if (!opts.showGrid) return;

  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  for (const tick of ticks) {
    const ratio = (tick - tickMin) / tickRange;
    const xPos = layout.plotX + ratio * layout.plotW;

    const gridLine = figma.createRectangle();
    gridLine.name = `Grid-${tick}`;
    gridLine.x = xPos;
    gridLine.y = layout.plotY;
    gridLine.resize(1, layout.plotH);
    gridLine.fills = [{ type: "SOLID", color: toRGB(GRID_COLOR) }];
    gridLine.opacity = 0.7;
    frame.appendChild(gridLine);
  }
}

async function renderLegend(
  frame: FrameNode,
  series: SeriesData[],
  width: number,
  height: number,
  layout: ChartLayout,
  opts: ChartOptions
) {
  if (opts.showLegend === false || series.length <= 1) return;

  const pos = opts.legendPosition || "bottom";
  const fontSize = opts.fontSize || LEGEND_FONT_SIZE;
  const boxSize = 10;
  const gap = 8;

  if (pos === "bottom") {
    let curX = layout.plotX;
    const legendY = height - CHART_PADDING.bottom - fontSize - 4;

    for (const s of series) {
      const box = figma.createRectangle();
      box.name = `Legend-Box-${s.name}`;
      box.x = curX;
      box.y = legendY + (fontSize - boxSize) / 2;
      box.resize(boxSize, boxSize);
      box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
      box.cornerRadius = 2;
      frame.appendChild(box);

      const label = await makeText(
        s.name,
        curX + boxSize + 4,
        legendY,
        fontSize,
        LABEL_COLOR,
        "LEFT",
        opts.fontFamily
      );
      label.name = `Legend-${s.name}`;
      frame.appendChild(label);

      curX += boxSize + 4 + label.width + gap + 8;
    }
  } else if (pos === "top") {
    const showTitle = opts.showTitle !== false && !!opts.title;
    let curX = layout.plotX;
    const legendY = showTitle
      ? CHART_PADDING.top + TITLE_FONT_SIZE + 12
      : CHART_PADDING.top;

    for (const s of series) {
      const box = figma.createRectangle();
      box.name = `Legend-Box-${s.name}`;
      box.x = curX;
      box.y = legendY + (fontSize - boxSize) / 2;
      box.resize(boxSize, boxSize);
      box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
      box.cornerRadius = 2;
      frame.appendChild(box);

      const label = await makeText(
        s.name,
        curX + boxSize + 4,
        legendY,
        fontSize,
        LABEL_COLOR,
        "LEFT",
        opts.fontFamily
      );
      label.name = `Legend-${s.name}`;
      frame.appendChild(label);

      curX += boxSize + 4 + label.width + gap + 8;
    }
  } else if (pos === "left") {
    const legendX = CHART_PADDING.left;
    let curY = layout.plotY;

    for (const s of series) {
      const box = figma.createRectangle();
      box.name = `Legend-Box-${s.name}`;
      box.x = legendX;
      box.y = curY + (fontSize - boxSize) / 2;
      box.resize(boxSize, boxSize);
      box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
      box.cornerRadius = 2;
      frame.appendChild(box);

      const label = await makeText(
        s.name,
        legendX + boxSize + 4,
        curY,
        fontSize,
        LABEL_COLOR,
        "LEFT",
        opts.fontFamily
      );
      label.name = `Legend-${s.name}`;
      frame.appendChild(label);

      curY += fontSize + 8;
    }
  } else if (pos === "right") {
    const legendX = layout.plotX + layout.plotW + 16;
    let curY = layout.plotY;

    for (const s of series) {
      const box = figma.createRectangle();
      box.name = `Legend-Box-${s.name}`;
      box.x = legendX;
      box.y = curY + (fontSize - boxSize) / 2;
      box.resize(boxSize, boxSize);
      box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
      box.cornerRadius = 2;
      frame.appendChild(box);

      const label = await makeText(
        s.name,
        legendX + boxSize + 4,
        curY,
        fontSize,
        LABEL_COLOR,
        "LEFT",
        opts.fontFamily
      );
      label.name = `Legend-${s.name}`;
      frame.appendChild(label);

      curY += fontSize + 8;
    }
  }
}

// ============ CHART RENDERERS ============

async function renderBarChart(
  frame: FrameNode,
  categories: string[],
  series: SeriesData[],
  width: number,
  height: number,
  opts: ChartOptions
) {
  const horizontal = opts.orientation === "horizontal";
  const layout = computeLayout(width, height, opts);

  const allValues = series.flatMap((s) => s.values);
  const maxVal = Math.max(...allValues, 0);
  const ticks = computeNiceTicks(0, maxVal);
  const tickMax = ticks[ticks.length - 1];

  if (horizontal) {
    await renderGridHorizontal(frame, layout, ticks, opts);
    await renderAxisHorizontal(frame, layout, categories, ticks, opts);
  } else {
    await renderGrid(frame, layout, ticks, opts);
    await renderAxis(frame, layout, categories, ticks, opts);
  }
  await renderTitle(frame, width, opts);

  const catCount = categories.length;
  const seriesCount = series.length;
  const cornerR = opts.barCornerRadius ?? 3;

  if (horizontal) {
    // Horizontal: categories on Y-axis, bars extend rightward
    const catStep = layout.plotH / catCount;
    const groupPadding = catStep * 0.15;
    const groupH = catStep - groupPadding * 2;
    const barH = groupH / seriesCount;

    for (let ci = 0; ci < catCount; ci++) {
      for (let si = 0; si < seriesCount; si++) {
        const val = series[si].values[ci];
        const barW = (val / tickMax) * layout.plotW;

        const bar = figma.createRectangle();
        bar.name = `Bar-${categories[ci]}-${series[si].name}`;
        bar.x = layout.plotX;
        bar.y = layout.plotY + ci * catStep + groupPadding + si * barH;
        bar.resize(Math.max(barW, 1), Math.max(barH - 2, 1));
        bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
        bar.cornerRadius = cornerR;
        frame.appendChild(bar);

        // Value label (to the right of the bar)
        if (opts.showValues) {
          const valText = formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces);
          const valNode = await makeText(valText, 0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "LEFT", opts.fontFamily);
          valNode.x = layout.plotX + barW + 4;
          valNode.y = layout.plotY + ci * catStep + groupPadding + si * barH + (barH - 2) / 2 - VALUE_FONT_SIZE / 2;
          valNode.name = `Val-${categories[ci]}-${series[si].name}`;
          frame.appendChild(valNode);
        }
      }
    }
  } else {
    // Vertical (default): categories on X-axis, bars extend upward
    const catStep = layout.plotW / catCount;
    const groupPadding = catStep * 0.15;
    const groupW = catStep - groupPadding * 2;
    const barW = groupW / seriesCount;

    for (let ci = 0; ci < catCount; ci++) {
      for (let si = 0; si < seriesCount; si++) {
        const val = series[si].values[ci];
        const barH = (val / tickMax) * layout.plotH;

        const bar = figma.createRectangle();
        bar.name = `Bar-${categories[ci]}-${series[si].name}`;
        bar.x = layout.plotX + ci * catStep + groupPadding + si * barW;
        bar.y = layout.plotY + layout.plotH - barH;
        bar.resize(Math.max(barW - 2, 1), Math.max(barH, 1));
        bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
        bar.cornerRadius = cornerR;
        frame.appendChild(bar);

        // Value label (above the bar)
        if (opts.showValues) {
          const valText = formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces);
          const valNode = await makeText(valText, 0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "CENTER", opts.fontFamily);
          valNode.x = layout.plotX + ci * catStep + groupPadding + si * barW + (barW - 2) / 2 - valNode.width / 2;
          valNode.y = layout.plotY + layout.plotH - barH - VALUE_FONT_SIZE - 3;
          valNode.name = `Val-${categories[ci]}-${series[si].name}`;
          frame.appendChild(valNode);
        }
      }
    }
  }

  await renderLegend(frame, series, width, height, layout, opts);
}

async function renderStackedBarChart(
  frame: FrameNode,
  categories: string[],
  series: SeriesData[],
  width: number,
  height: number,
  opts: ChartOptions
) {
  const horizontal = opts.orientation === "horizontal";
  const layout = computeLayout(width, height, opts);

  // Compute stacked max
  const catCount = categories.length;
  let stackMax = 0;
  for (let ci = 0; ci < catCount; ci++) {
    let sum = 0;
    for (const s of series) sum += s.values[ci];
    stackMax = Math.max(stackMax, sum);
  }
  const ticks = computeNiceTicks(0, stackMax);
  const tickMax = ticks[ticks.length - 1];

  if (horizontal) {
    await renderGridHorizontal(frame, layout, ticks, opts);
    await renderAxisHorizontal(frame, layout, categories, ticks, opts);
  } else {
    await renderGrid(frame, layout, ticks, opts);
    await renderAxis(frame, layout, categories, ticks, opts);
  }
  await renderTitle(frame, width, opts);

  const cornerR = opts.barCornerRadius ?? 3;
  const segmentMode = opts.stackedValueMode === "segment";

  if (horizontal) {
    // Horizontal stacked: categories on Y-axis, segments extend rightward
    const catStep = layout.plotH / catCount;
    const barPadding = catStep * 0.2;
    const barH = catStep - barPadding * 2;

    for (let ci = 0; ci < catCount; ci++) {
      let xOffset = 0;
      for (let si = 0; si < series.length; si++) {
        const val = series[si].values[ci];
        const segW = (val / tickMax) * layout.plotW;

        const bar = figma.createRectangle();
        bar.name = `Stack-${categories[ci]}-${series[si].name}`;
        bar.x = layout.plotX + xOffset;
        bar.y = layout.plotY + ci * catStep + barPadding;
        bar.resize(Math.max(segW, 1), Math.max(barH, 1));
        bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
        if (si === series.length - 1) bar.cornerRadius = cornerR;
        frame.appendChild(bar);

        // Per-segment value label
        if (opts.showValues && segmentMode && val > 0 && segW > VALUE_FONT_SIZE * 2) {
          const segLabel = await makeText(
            formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
            0, 0, VALUE_FONT_SIZE,
            { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            "CENTER", opts.fontFamily
          );
          segLabel.x = layout.plotX + xOffset + segW / 2 - segLabel.width / 2;
          segLabel.y = layout.plotY + ci * catStep + barPadding + barH / 2 - VALUE_FONT_SIZE / 2;
          segLabel.name = `SegVal-${categories[ci]}-${series[si].name}`;
          frame.appendChild(segLabel);
        }

        xOffset += segW;
      }

      // Total value label (to the right)
      if (opts.showValues && !segmentMode) {
        let total = 0;
        for (const s of series) total += s.values[ci];
        const valNode = await makeText(
          formatValue(total, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
          0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "LEFT", opts.fontFamily
        );
        valNode.x = layout.plotX + xOffset + 4;
        valNode.y = layout.plotY + ci * catStep + barPadding + barH / 2 - VALUE_FONT_SIZE / 2;
        valNode.name = `Val-${categories[ci]}`;
        frame.appendChild(valNode);
      }
    }
  } else {
    // Vertical stacked (default)
    const catStep = layout.plotW / catCount;
    const barPadding = catStep * 0.2;
    const barW = catStep - barPadding * 2;

    for (let ci = 0; ci < catCount; ci++) {
      let yOffset = 0;
      for (let si = 0; si < series.length; si++) {
        const val = series[si].values[ci];
        const barH = (val / tickMax) * layout.plotH;

        const bar = figma.createRectangle();
        bar.name = `Stack-${categories[ci]}-${series[si].name}`;
        bar.x = layout.plotX + ci * catStep + barPadding;
        bar.y = layout.plotY + layout.plotH - yOffset - barH;
        bar.resize(Math.max(barW, 1), Math.max(barH, 1));
        bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
        if (si === series.length - 1) bar.cornerRadius = cornerR;
        frame.appendChild(bar);

        // Per-segment value label
        if (opts.showValues && segmentMode && val > 0 && barH > VALUE_FONT_SIZE + 2) {
          const segLabel = await makeText(
            formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
            0, 0, VALUE_FONT_SIZE,
            { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            "CENTER", opts.fontFamily
          );
          segLabel.x = layout.plotX + ci * catStep + barPadding + barW / 2 - segLabel.width / 2;
          segLabel.y = layout.plotY + layout.plotH - yOffset - barH / 2 - VALUE_FONT_SIZE / 2;
          segLabel.name = `SegVal-${categories[ci]}-${series[si].name}`;
          frame.appendChild(segLabel);
        }

        yOffset += barH;
      }

      // Total value label on top
      if (opts.showValues && !segmentMode) {
        let total = 0;
        for (const s of series) total += s.values[ci];
        const valNode = await makeText(
          formatValue(total, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
          0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "CENTER", opts.fontFamily
        );
        valNode.x = layout.plotX + ci * catStep + barPadding + barW / 2 - valNode.width / 2;
        valNode.y = layout.plotY + layout.plotH - yOffset - VALUE_FONT_SIZE - 3;
        valNode.name = `Val-${categories[ci]}`;
        frame.appendChild(valNode);
      }
    }
  }

  await renderLegend(frame, series, width, height, layout, opts);
}

async function renderLineChart(
  frame: FrameNode,
  categories: string[],
  series: SeriesData[],
  width: number,
  height: number,
  opts: ChartOptions
) {
  const layout = computeLayout(width, height, opts);

  const allValues = series.flatMap((s) => s.values);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 0);
  const ticks = computeNiceTicks(minVal >= 0 ? 0 : minVal, maxVal);
  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  await renderGrid(frame, layout, ticks, opts);
  await renderAxis(frame, layout, categories, ticks, opts);
  await renderTitle(frame, width, opts);

  const catCount = categories.length;
  const stepX = catCount > 1 ? layout.plotW / (catCount - 1) : layout.plotW / 2;

  const showDots = opts.showDots !== false;
  const dotSize = opts.dotSize || 6;
  const lineW = opts.lineWidth || 2;

  for (const s of series) {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < catCount; i++) {
      const ratio = (s.values[i] - tickMin) / tickRange;
      const px = layout.plotX + (catCount > 1 ? i * stepX : layout.plotW / 2);
      const py = layout.plotY + layout.plotH - ratio * layout.plotH;
      points.push({ x: px, y: py });
    }

    // Line via SVG
    if (points.length > 1) {
      let pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x} ${points[i].y}`;
      }
      const rgb = `rgb(${Math.round(s.color.r * 255)},${Math.round(s.color.g * 255)},${Math.round(s.color.b * 255)})`;
      const svg = `<svg width="${width}" height="${height}"><path d="${pathD}" fill="none" stroke="${rgb}" stroke-width="${lineW}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
      try {
        const lineNode = figma.createNodeFromSvg(svg);
        lineNode.name = `Line-${s.name}`;
        lineNode.x = 0;
        lineNode.y = 0;
        lineNode.clipsContent = false;
        frame.appendChild(lineNode);
      } catch (e) {
        console.error("SVG line error:", e);
      }
    }

    // Dots
    if (showDots) {
      const markerShape = opts.markerShape || "circle";
      for (let i = 0; i < points.length; i++) {
        const dot = createMarker(
          markerShape,
          points[i].x,
          points[i].y,
          dotSize,
          toRGB(s.color),
          { r: 1, g: 1, b: 1 },
          1.5
        );
        dot.name = `Dot-${s.name}-${categories[i]}`;
        frame.appendChild(dot);
      }
    }

    // Value labels
    if (opts.showValues) {
      for (let i = 0; i < points.length; i++) {
        const valNode = await makeText(
          formatValue(s.values[i], opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
          0,
          0,
          VALUE_FONT_SIZE,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        valNode.x = points[i].x - valNode.width / 2;
        valNode.y = points[i].y - dotSize / 2 - VALUE_FONT_SIZE - 3;
        valNode.name = `Val-${s.name}-${categories[i]}`;
        frame.appendChild(valNode);
      }
    }
  }

  await renderLegend(frame, series, width, height, layout, opts);
}

async function renderAreaChart(
  frame: FrameNode,
  categories: string[],
  series: SeriesData[],
  width: number,
  height: number,
  opts: ChartOptions
) {
  const layout = computeLayout(width, height, opts);

  const allValues = series.flatMap((s) => s.values);
  const minVal = Math.min(...allValues, 0);
  const maxVal = Math.max(...allValues, 0);
  const ticks = computeNiceTicks(minVal >= 0 ? 0 : minVal, maxVal);
  const tickMin = ticks[0];
  const tickMax = ticks[ticks.length - 1];
  const tickRange = tickMax - tickMin || 1;

  await renderGrid(frame, layout, ticks, opts);
  await renderAxis(frame, layout, categories, ticks, opts);
  await renderTitle(frame, width, opts);

  const catCount = categories.length;
  const stepX = catCount > 1 ? layout.plotW / (catCount - 1) : layout.plotW / 2;
  const showDots = opts.showDots !== false;
  const dotSize = opts.dotSize || 5;
  const lineW = opts.lineWidth || 2;
  const baseY = layout.plotY + layout.plotH;

  for (const s of series) {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < catCount; i++) {
      const ratio = (s.values[i] - tickMin) / tickRange;
      const px = layout.plotX + (catCount > 1 ? i * stepX : layout.plotW / 2);
      const py = layout.plotY + layout.plotH - ratio * layout.plotH;
      points.push({ x: px, y: py });
    }

    // Area fill (SVG polygon)
    if (points.length > 1) {
      let areaD = `M ${points[0].x} ${baseY} L ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        areaD += ` L ${points[i].x} ${points[i].y}`;
      }
      areaD += ` L ${points[points.length - 1].x} ${baseY} Z`;

      const rgb = `rgb(${Math.round(s.color.r * 255)},${Math.round(s.color.g * 255)},${Math.round(s.color.b * 255)})`;
      const areaSvg = `<svg width="${width}" height="${height}"><path d="${areaD}" fill="${rgb}" fill-opacity="0.2" /><path d="M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}" fill="none" stroke="${rgb}" stroke-width="${lineW}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
      try {
        const areaNode = figma.createNodeFromSvg(areaSvg);
        areaNode.name = `Area-${s.name}`;
        areaNode.x = 0;
        areaNode.y = 0;
        areaNode.clipsContent = false;
        frame.appendChild(areaNode);
      } catch (e) {
        console.error("SVG area error:", e);
      }
    }

    // Dots
    if (showDots) {
      const markerShape = opts.markerShape || "circle";
      for (let i = 0; i < points.length; i++) {
        const dot = createMarker(
          markerShape,
          points[i].x,
          points[i].y,
          dotSize,
          toRGB(s.color)
        );
        dot.name = `Dot-${s.name}-${categories[i]}`;
        frame.appendChild(dot);
      }
    }
  }

  await renderLegend(frame, series, width, height, layout, opts);
}

async function renderPieOrDonutChart(
  frame: FrameNode,
  categories: string[],
  series: SeriesData[],
  width: number,
  height: number,
  opts: ChartOptions,
  isDonut: boolean
) {
  // Pie/donut uses the first series only
  const values = series.length > 0 ? series[0].values : [];
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return;

  const showTitle = opts.showTitle !== false && !!opts.title;
  const showLegend = opts.showLegend !== false;
  const titleH = showTitle ? TITLE_FONT_SIZE + 16 : 0;
  const legendH = showLegend ? categories.length * 20 + 10 : 0;

  const chartSize = Math.min(
    width - CHART_PADDING.left - CHART_PADDING.right,
    height - CHART_PADDING.top - CHART_PADDING.bottom - titleH - legendH
  );
  const outerR = chartSize / 2;
  const innerR = isDonut ? outerR * (opts.innerRadius ?? 0.6) : 0;
  const cx = width / 2;
  const cy = CHART_PADDING.top + titleH + outerR;

  await renderTitle(frame, width, opts);

  let currentAngle = -Math.PI / 2;
  const palette = opts.colors && opts.colors.length > 0 ? opts.colors : DEFAULT_PALETTE;
  const TWO_PI = 2 * Math.PI;
  const normalizeAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
  const donutRatio = isDonut ? (opts.innerRadius ?? 0.6) : 0;

  for (let i = 0; i < values.length; i++) {
    const sliceAngle = (values[i] / total) * TWO_PI;
    const endAngle = currentAngle + sliceAngle;
    const color = palette[i % palette.length];

    const ellipse = figma.createEllipse();
    ellipse.resize(outerR * 2, outerR * 2);
    ellipse.x = cx - outerR;
    ellipse.y = cy - outerR;
    const normStart = normalizeAngle(currentAngle);
    ellipse.arcData = {
      startingAngle: normStart,
      endingAngle: normStart + sliceAngle,
      innerRadius: donutRatio,
    };
    ellipse.fills = [{ type: "SOLID", color: toRGB(color) }];
    ellipse.name = `Slice-${categories[i]}`;
    frame.appendChild(ellipse);

    // Value/percent label at mid-angle
    if (opts.showValues !== false) {
      const midAngle = currentAngle + sliceAngle / 2;
      const labelR = isDonut ? (outerR + innerR) / 2 : outerR * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      const pct = ((values[i] / total) * 100).toFixed(1);
      const valNode = await makeText(
        `${pct}%`,
        0,
        0,
        VALUE_FONT_SIZE,
        { r: 1, g: 1, b: 1, a: 1 },
        "CENTER",
        opts.fontFamily
      );
      valNode.x = lx - valNode.width / 2;
      valNode.y = ly - valNode.height / 2;
      valNode.name = `Val-${categories[i]}`;
      frame.appendChild(valNode);
    }

    currentAngle = endAngle;
  }

  // Donut center label
  if (isDonut && opts.centerLabel) {
    const centerNode = await makeText(
      opts.centerLabel,
      0,
      0,
      opts.fontSize ? opts.fontSize + 2 : 14,
      TITLE_COLOR,
      "CENTER",
      opts.fontFamily
    );
    centerNode.x = cx - centerNode.width / 2;
    centerNode.y = cy - centerNode.height / 2;
    centerNode.name = "Center Label";
    frame.appendChild(centerNode);
  }

  // Legend
  if (showLegend) {
    const legendY = cy + outerR + 16;
    for (let i = 0; i < categories.length; i++) {
      const color = palette[i % palette.length];
      const pct = ((values[i] / total) * 100).toFixed(1);

      const box = figma.createRectangle();
      box.name = `Legend-Box-${categories[i]}`;
      box.x = CHART_PADDING.left;
      box.y = legendY + i * 20;
      box.resize(10, 10);
      box.fills = [{ type: "SOLID", color: toRGB(color) }];
      box.cornerRadius = 2;
      frame.appendChild(box);

      const label = await makeText(
        `${categories[i]}: ${formatValue(values[i], opts.valueFormat, opts.currencySymbol, opts.decimalPlaces)} (${pct}%)`,
        CHART_PADDING.left + 16,
        legendY + i * 20 - 1,
        opts.fontSize || LEGEND_FONT_SIZE,
        LABEL_COLOR,
        "LEFT",
        opts.fontFamily
      );
      label.name = `Legend-${categories[i]}`;
      frame.appendChild(label);
    }
  }
}

// Set SCALE constraints on direct children so chart scales when frame is resized
// Non-recursive: SVG wrapper frames and their inner vectors scale naturally with their parent
function applyScaleConstraints(parent: FrameNode) {
  for (const child of parent.children) {
    if ("constraints" in child) {
      (child as any).constraints = { horizontal: "SCALE", vertical: "SCALE" };
    }
  }
}

// ============ MAIN RENDER DISPATCHER ============

async function renderChart(
  frame: FrameNode,
  chartType: DataChartType,
  data: TabularData,
  width: number,
  height: number,
  opts: ChartOptions
) {
  // Clear children
  for (const child of [...frame.children]) {
    child.remove();
  }

  const { categories, series } = parseTabularData(data, opts.colors);

  switch (chartType) {
    case "bar":
      await renderBarChart(frame, categories, series, width, height, opts);
      break;
    case "stacked_bar":
      await renderStackedBarChart(frame, categories, series, width, height, opts);
      break;
    case "line":
      await renderLineChart(frame, categories, series, width, height, opts);
      break;
    case "area":
      await renderAreaChart(frame, categories, series, width, height, opts);
      break;
    case "pie":
      await renderPieOrDonutChart(frame, categories, series, width, height, opts, false);
      break;
    case "donut":
      await renderPieOrDonutChart(frame, categories, series, width, height, opts, true);
      break;
    default:
      throw new Error(`Unknown chart type: ${chartType}`);
  }
}

// ============ PUBLIC API ============

export async function createDataChart(params: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  chartType: DataChartType;
  data: TabularData;
  options?: ChartOptions;
  parentId?: string;
  name?: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 600,
    height = 400,
    chartType,
    data,
    options = {},
    parentId,
    name,
  } = params;

  const parent = await getParentNode(parentId);

  const frame = figma.createFrame();
  frame.name = name || `DataChart-${chartType}`;
  frame.x = x;
  frame.y = y;
  frame.resize(width, height);
  frame.clipsContent = true;
  frame.fills = options.backgroundColor
    ? [{ type: "SOLID", color: toRGB(options.backgroundColor) }]
    : [];

  const metadata: DataChartMetadata = { chartType, data, options, width, height };
  frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));

  await renderChart(frame, chartType, data, width, height, options);
  applyScaleConstraints(frame);
  parent.appendChild(frame);

  return {
    id: frame.id,
    name: frame.name,
    chartType,
    x,
    y,
    width,
    height,
    categories: data.rows.length,
    series: data.headers.length - 1,
  };
}

export async function updateDataChart(params: {
  chartId: string;
  data?: TabularData;
  options?: ChartOptions;
}) {
  const { chartId, data, options } = params;
  let node: BaseNode | null = null;

  node = await figma.getNodeByIdAsync(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(DATA_CHART_KEY);
  if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);

  const metadata: DataChartMetadata = JSON.parse(raw);
  if (data) metadata.data = data;
  if (options) metadata.options = { ...metadata.options, ...options };

  frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));
  await renderChart(
    frame,
    metadata.chartType,
    metadata.data,
    metadata.width,
    metadata.height,
    metadata.options
  );
  applyScaleConstraints(frame);

  return {
    id: chartId,
    name: frame.name,
    chartType: metadata.chartType,
    updated: true,
  };
}

export async function changeDataChartType(params: {
  chartId: string;
  newType: DataChartType;
}) {
  const { chartId, newType } = params;
  let node: BaseNode | null = null;

  node = await figma.getNodeByIdAsync(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(DATA_CHART_KEY);
  if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);

  const metadata: DataChartMetadata = JSON.parse(raw);
  const oldType = metadata.chartType;
  metadata.chartType = newType;
  frame.name = `DataChart-${newType}`;

  frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));
  await renderChart(
    frame,
    newType,
    metadata.data,
    metadata.width,
    metadata.height,
    metadata.options
  );
  applyScaleConstraints(frame);

  return { id: chartId, name: frame.name, oldType, newType, changed: true };
}

export async function getDataChartInfo(params: { chartId: string }) {
  const { chartId } = params;
  let node: BaseNode | null = null;

  node = await figma.getNodeByIdAsync(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const frame = node as FrameNode;
  const raw = frame.getPluginData(DATA_CHART_KEY);
  if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);

  const metadata: DataChartMetadata = JSON.parse(raw);
  return {
    id: chartId,
    name: frame.name,
    ...metadata,
  };
}
