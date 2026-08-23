// Chart Handlers for Figma Plugin
// Creates interactive charts with pluginData for state management
// Supports both single-series (data) and multi-series (series) input
import { lookupNode } from "../bridge";

// Direct + sourceId fallback.
async function resolveNode(id: string): Promise<BaseNode | null> {
  return await lookupNode(id);
}

interface RGBA {
  r: number;
  g: number;
  b: number;
  a?: number;
}

interface DataPoint {
  label: string;
  value: number;
  color?: RGBA;
}

interface DataSeries {
  name: string;
  data: DataPoint[];
  color?: RGBA;
}

interface ChartStyle {
  backgroundColor?: RGBA;
  showLabels?: boolean;
  showValues?: boolean;
  showLegend?: boolean;
  legendPosition?: "top" | "bottom" | "left" | "right";
  fontFamily?: string;
  fontSize?: number;
}

type ChartType = "bar" | "line" | "pie" | "donut";

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

// Chart metadata stored in pluginData
interface ChartMetadata {
  chartType: ChartType;
  data: DataPoint[];
  series?: DataSeries[];
  title?: string;
  style?: ChartStyle;
  width: number;
  height: number;
  orientation?: "vertical" | "horizontal";
  innerRadius?: number;
  centerLabel?: string;
}

const PLUGIN_DATA_KEY = "chart_metadata";

const SERIES_PALETTE: RGBA[] = [
  { r: 0.918, g: 0.263, b: 0.208, a: 1 }, // #EA4335 red
  { r: 0.259, g: 0.522, b: 0.957, a: 1 }, // #4285F4 blue
  { r: 0.208, g: 0.659, b: 0.325, a: 1 }, // #34A853 green
  { r: 0.984, g: 0.737, b: 0.016, a: 1 }, // #FBBC04 yellow
  { r: 1.0, g: 0.42, b: 0.176, a: 1 },    // #FF6B2D orange
  { r: 0.541, g: 0.318, b: 0.831, a: 1 }, // #8A51D4 purple
  { r: 0.0, g: 0.737, b: 0.831, a: 1 },   // #00BCD4 cyan
  { r: 0.914, g: 0.118, b: 0.388, a: 1 }, // #E91E63 pink
];

// Helper: Get parent node (slide or specified parent)
// Try mapped (imported) ID first via resolveNode to land on the correct imported slide.
async function getParentNode(parentId?: string): Promise<BaseNode & ChildrenMixin> {
  if (parentId) {
    const node = await resolveNode(parentId);
    if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
      return node as FrameNode | PageNode;
    }
  }
  const focusedSlide = (figma.currentPage as any).focusedSlide as SceneNode | null;
  return (focusedSlide as any) || figma.currentPage;
}

// Helper: Convert RGBA to Figma color
function toFigmaColor(color: RGBA): RGB {
  return { r: color.r, g: color.g, b: color.b };
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

// Helper: Get color from data point or default palette
function getColor(dataPoint: DataPoint, index: number, defaultColors: RGBA[]): RGBA {
  if (dataPoint.color) return dataPoint.color;
  return defaultColors[index % defaultColors.length];
}

function getSeriesColor(series: DataSeries, index: number, defaultColors: RGBA[]): RGBA {
  if (series.color) return series.color;
  return defaultColors[index % defaultColors.length];
}

// Helper: Create a marker shape node at the given center position
function createMarkerShape(
  shape: MarkerShape,
  cx: number,
  cy: number,
  size: number,
  fillColor: RGB,
  strokeColor?: RGB,
  strokeWeight?: number
): SceneNode {
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
      const dSize = size * 1.5;
      const rect = figma.createRectangle();
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

// Helper: Load font
async function loadFont(family: string = "Inter", style: string = "Regular"): Promise<void> {
  try {
    await figma.loadFontAsync({ family, style });
  } catch {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

// Helper: Create text node
async function createTextNode(
  text: string,
  x: number,
  y: number,
  fontSize: number = 12,
  color: RGBA = { r: 0, g: 0, b: 0, a: 1 },
  align: "LEFT" | "CENTER" | "RIGHT" = "LEFT"
): Promise<TextNode> {
  await loadFont();
  const textNode = figma.createText();
  textNode.characters = text;
  textNode.fontSize = fontSize;
  textNode.x = x;
  textNode.y = y;
  textNode.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
  textNode.textAlignHorizontal = align;
  return textNode;
}

// Helper: Save chart metadata to pluginData
function saveChartMetadata(node: FrameNode, metadata: ChartMetadata): void {
  node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(metadata));
}

// Helper: Load chart metadata from pluginData
function loadChartMetadata(node: FrameNode): ChartMetadata | null {
  const data = node.getPluginData(PLUGIN_DATA_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data) as ChartMetadata;
  } catch {
    return null;
  }
}

// Helper: Extract unique labels (categories) from series data
function getSeriesLabels(seriesArr: DataSeries[]): string[] {
  const labelsSet = new Set<string>();
  for (const s of seriesArr) {
    for (const d of s.data) {
      labelsSet.add(d.label);
    }
  }
  return Array.from(labelsSet);
}

// Helper: Get value for a series at a given label
function getSeriesValue(series: DataSeries, label: string): number {
  const point = series.data.find((d) => d.label === label);
  return point ? point.value : 0;
}

// ============ RENDER FUNCTIONS (Internal) ============

async function renderBarChartContent(
  chartGroup: FrameNode,
  data: DataPoint[],
  defaultColors: RGBA[],
  width: number,
  height: number,
  title?: string,
  orientation: "vertical" | "horizontal" = "vertical",
  style: ChartStyle = {},
  seriesArr?: DataSeries[]
) {
  // Clear existing children
  for (const child of [...chartGroup.children]) {
    child.remove();
  }

  const padding = 40;
  const titleHeight = title ? 30 : 0;
  const hasMultiSeries = seriesArr && seriesArr.length > 0;
  const showLegend = style.showLegend !== false && hasMultiSeries;
  const legendPos = style.legendPosition || "bottom";
  const legendSize = showLegend ? (legendPos === "left" || legendPos === "right" ? 120 : 30) : 0;
  const chartAreaX = padding + (showLegend && legendPos === "left" ? legendSize : 0);
  const chartAreaY = padding + titleHeight + (showLegend && legendPos === "top" ? legendSize : 0);
  const chartAreaWidth = width - padding * 2 - (showLegend && (legendPos === "left" || legendPos === "right") ? legendSize : 0);
  const chartAreaHeight = height - padding * 2 - titleHeight - (showLegend && (legendPos === "top" || legendPos === "bottom") ? legendSize : 0);
  const barSpacing = 8;

  // Title
  if (title) {
    const titleNode = await createTextNode(
      title, width / 2, padding / 2,
      style.fontSize ? style.fontSize + 4 : 16,
      { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
    );
    titleNode.x = (width - titleNode.width) / 2;
    chartGroup.appendChild(titleNode);
  }

  if (hasMultiSeries) {
    // ===== MULTI-SERIES GROUPED BAR =====
    const labels = getSeriesLabels(seriesArr);
    const seriesCount = seriesArr.length;
    const catCount = labels.length;

    // Find max value across all series
    let maxValue = 0;
    for (const s of seriesArr) {
      for (const d of s.data) {
        maxValue = Math.max(maxValue, d.value);
      }
    }
    if (maxValue === 0) maxValue = 1;

    if (orientation === "vertical") {
      const catStep = chartAreaWidth / catCount;
      const groupPadding = catStep * 0.12;
      const groupW = catStep - groupPadding * 2;
      const barWidth = groupW / seriesCount;

      for (let ci = 0; ci < catCount; ci++) {
        const label = labels[ci];

        for (let si = 0; si < seriesCount; si++) {
          const s = seriesArr[si];
          const val = getSeriesValue(s, label);
          const color = getSeriesColor(s, si, defaultColors);
          const barHeight = (val / maxValue) * chartAreaHeight;

          const bar = figma.createRectangle();
          bar.name = `Bar: ${label}-${s.name}`;
          bar.x = chartAreaX + ci * catStep + groupPadding + si * barWidth;
          bar.y = chartAreaY + chartAreaHeight - barHeight;
          bar.resize(Math.max(barWidth - 1, 1), Math.max(barHeight, 1));
          bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          bar.cornerRadius = 4;
          chartGroup.appendChild(bar);

          if (style.showValues !== false) {
            const valueNode = await createTextNode(
              val.toString(), 0, 0, style.fontSize || 9,
              { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
            );
            valueNode.x = bar.x + (barWidth - 1) / 2 - valueNode.width / 2;
            valueNode.y = bar.y - 13;
            chartGroup.appendChild(valueNode);
          }
        }

        // Category label
        if (style.showLabels !== false) {
          const labelNode = await createTextNode(
            label, 0, 0, style.fontSize || 10,
            { r: 0.4, g: 0.4, b: 0.4, a: 1 }, "CENTER"
          );
          labelNode.x = chartAreaX + ci * catStep + catStep / 2 - labelNode.width / 2;
          labelNode.y = chartAreaY + chartAreaHeight + 5;
          chartGroup.appendChild(labelNode);
        }
      }
    } else {
      // Horizontal grouped bar
      const catStep = chartAreaHeight / catCount;
      const groupPadding = catStep * 0.12;
      const groupH = catStep - groupPadding * 2;
      const barHeight = groupH / seriesCount;
      const labelWidth = 60;

      for (let ci = 0; ci < catCount; ci++) {
        const label = labels[ci];

        for (let si = 0; si < seriesCount; si++) {
          const s = seriesArr[si];
          const val = getSeriesValue(s, label);
          const color = getSeriesColor(s, si, defaultColors);
          const barWidth = (val / maxValue) * (chartAreaWidth - labelWidth);

          const bar = figma.createRectangle();
          bar.name = `Bar: ${label}-${s.name}`;
          bar.x = chartAreaX + labelWidth;
          bar.y = chartAreaY + ci * catStep + groupPadding + si * barHeight;
          bar.resize(Math.max(barWidth, 1), Math.max(barHeight - 1, 1));
          bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          bar.cornerRadius = 4;
          chartGroup.appendChild(bar);

          if (style.showValues !== false) {
            const valueNode = await createTextNode(
              val.toString(), chartAreaX + labelWidth + barWidth + 5,
              bar.y + (barHeight - 1) / 2 - 5,
              style.fontSize || 9, { r: 0.2, g: 0.2, b: 0.2, a: 1 }
            );
            chartGroup.appendChild(valueNode);
          }
        }

        if (style.showLabels !== false) {
          const labelNode = await createTextNode(
            label, chartAreaX,
            chartAreaY + ci * catStep + catStep / 2 - 6,
            style.fontSize || 10, { r: 0.4, g: 0.4, b: 0.4, a: 1 }
          );
          chartGroup.appendChild(labelNode);
        }
      }
    }

    // Legend for multi-series
    if (showLegend) {
      if (legendPos === "left" || legendPos === "right") {
        const lx = legendPos === "left" ? padding : chartAreaX + chartAreaWidth + 16;
        let ly = chartAreaY;
        for (let si = 0; si < seriesCount; si++) {
          const s = seriesArr[si];
          const color = getSeriesColor(s, si, defaultColors);
          const box = figma.createRectangle();
          box.name = `Legend: ${s.name}`;
          box.x = lx;
          box.y = ly;
          box.resize(10, 10);
          box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          box.cornerRadius = 2;
          chartGroup.appendChild(box);
          const legendLabel = await createTextNode(
            s.name, lx + 14, ly - 1,
            style.fontSize || 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          );
          chartGroup.appendChild(legendLabel);
          ly += 20;
        }
      } else {
        let lx = chartAreaX;
        const ly = legendPos === "top"
          ? padding + titleHeight + 5
          : height - padding - legendSize + 5;
        for (let si = 0; si < seriesCount; si++) {
          const s = seriesArr[si];
          const color = getSeriesColor(s, si, defaultColors);
          const box = figma.createRectangle();
          box.name = `Legend: ${s.name}`;
          box.x = lx;
          box.y = ly;
          box.resize(10, 10);
          box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          box.cornerRadius = 2;
          chartGroup.appendChild(box);
          const legendLabel = await createTextNode(
            s.name, lx + 14, ly - 1,
            style.fontSize || 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          );
          chartGroup.appendChild(legendLabel);
          lx += 14 + legendLabel.width + 16;
        }
      }
    }
  } else {
    // ===== SINGLE-SERIES (original behavior) =====
    const maxValue = Math.max(...data.map((d) => d.value));
    const barCount = data.length;

    if (orientation === "vertical") {
      const totalSpacing = barSpacing * (barCount - 1);
      const barWidth = (chartAreaWidth - totalSpacing) / barCount;

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const color = getColor(d, i, defaultColors);
        const barHeight = (d.value / maxValue) * chartAreaHeight;

        const bar = figma.createRectangle();
        bar.name = `Bar: ${d.label}`;
        bar.x = chartAreaX + i * (barWidth + barSpacing);
        bar.y = chartAreaY + chartAreaHeight - barHeight;
        bar.resize(barWidth, barHeight);
        bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
        bar.cornerRadius = 4;
        chartGroup.appendChild(bar);

        if (style.showLabels !== false) {
          const labelNode = await createTextNode(
            d.label, 0, 0, style.fontSize || 10,
            { r: 0.4, g: 0.4, b: 0.4, a: 1 }, "CENTER"
          );
          labelNode.x = chartAreaX + i * (barWidth + barSpacing) + (barWidth - labelNode.width) / 2;
          labelNode.y = chartAreaY + chartAreaHeight + 5;
          chartGroup.appendChild(labelNode);
        }

        if (style.showValues !== false) {
          const valueNode = await createTextNode(
            d.value.toString(), 0, 0, style.fontSize || 10,
            { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
          );
          valueNode.x = chartAreaX + i * (barWidth + barSpacing) + (barWidth - valueNode.width) / 2;
          valueNode.y = chartAreaY + chartAreaHeight - barHeight - 15;
          chartGroup.appendChild(valueNode);
        }
      }
    } else {
      const totalSpacing = barSpacing * (barCount - 1);
      const barHeight = (chartAreaHeight - totalSpacing) / barCount;

      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const color = getColor(d, i, defaultColors);
        const barWidth = (d.value / maxValue) * (chartAreaWidth - 60);

        const bar = figma.createRectangle();
        bar.name = `Bar: ${d.label}`;
        bar.x = chartAreaX + 60;
        bar.y = chartAreaY + i * (barHeight + barSpacing);
        bar.resize(barWidth, barHeight);
        bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
        bar.cornerRadius = 4;
        chartGroup.appendChild(bar);

        if (style.showLabels !== false) {
          const labelNode = await createTextNode(
            d.label, chartAreaX,
            chartAreaY + i * (barHeight + barSpacing) + (barHeight - 12) / 2,
            style.fontSize || 10, { r: 0.4, g: 0.4, b: 0.4, a: 1 }
          );
          chartGroup.appendChild(labelNode);
        }

        if (style.showValues !== false) {
          const valueNode = await createTextNode(
            d.value.toString(), chartAreaX + 60 + barWidth + 5,
            chartAreaY + i * (barHeight + barSpacing) + (barHeight - 12) / 2,
            style.fontSize || 10, { r: 0.2, g: 0.2, b: 0.2, a: 1 }
          );
          chartGroup.appendChild(valueNode);
        }
      }
    }
  }
}

async function renderLineChartContent(
  chartGroup: FrameNode,
  data: DataPoint[],
  defaultColors: RGBA[],
  width: number,
  height: number,
  title?: string,
  style: ChartStyle = {},
  seriesArr?: DataSeries[],
  markerShape: MarkerShape = "circle"
) {
  for (const child of [...chartGroup.children]) {
    child.remove();
  }

  const padding = 50;
  const titleHeight = title ? 30 : 0;
  const hasMultiSeries = seriesArr && seriesArr.length > 0;
  const showLegend = style.showLegend !== false && hasMultiSeries;
  const legendPos = style.legendPosition || "bottom";
  const legendSize = showLegend ? (legendPos === "left" || legendPos === "right" ? 120 : 30) : 0;
  const chartAreaX = padding + (showLegend && legendPos === "left" ? legendSize : 0);
  const chartAreaY = padding + titleHeight + (showLegend && legendPos === "top" ? legendSize : 0);
  const chartAreaWidth = width - padding * 2 - (showLegend && (legendPos === "left" || legendPos === "right") ? legendSize : 0);
  const chartAreaHeight = height - padding * 2 - titleHeight - (showLegend && (legendPos === "top" || legendPos === "bottom") ? legendSize : 0);

  if (title) {
    const titleNode = await createTextNode(
      title, width / 2, padding / 2,
      style.fontSize ? style.fontSize + 4 : 16,
      { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
    );
    titleNode.x = (width - titleNode.width) / 2;
    chartGroup.appendChild(titleNode);
  }

  if (hasMultiSeries) {
    // ===== MULTI-SERIES LINE =====
    const labels = getSeriesLabels(seriesArr);
    const catCount = labels.length;

    // Find global min/max across all series
    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const s of seriesArr) {
      for (const d of s.data) {
        globalMin = Math.min(globalMin, d.value);
        globalMax = Math.max(globalMax, d.value);
      }
    }
    if (globalMin === globalMax) { globalMin -= 1; globalMax += 1; }
    const valueRange = globalMax - globalMin;

    const stepX = chartAreaWidth / (catCount - 1 || 1);

    for (let si = 0; si < seriesArr.length; si++) {
      const s = seriesArr[si];
      const lineColor = getSeriesColor(s, si, defaultColors);

      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < catCount; i++) {
        const val = getSeriesValue(s, labels[i]);
        const px = chartAreaX + i * stepX;
        const py = chartAreaY + chartAreaHeight - ((val - globalMin) / valueRange) * chartAreaHeight;
        points.push({ x: px, y: py });
      }

      // Line SVG
      if (points.length > 1) {
        let pathD = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
          pathD += ` L ${points[i].x} ${points[i].y}`;
        }
        const rgb = `rgb(${Math.round(lineColor.r * 255)},${Math.round(lineColor.g * 255)},${Math.round(lineColor.b * 255)})`;
        const lineSvg = `<svg width="${width}" height="${height}"><path d="${pathD}" fill="none" stroke="${rgb}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
        try {
          const lineNode = figma.createNodeFromSvg(lineSvg);
          lineNode.name = `Line: ${s.name}`;
          lineNode.x = 0;
          lineNode.y = 0;
          lineNode.clipsContent = false;
          chartGroup.appendChild(lineNode);
        } catch (e) {
          console.error("Error creating line:", e);
        }
      }

      // Points
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const point = createMarkerShape(
          markerShape,
          p.x,
          p.y,
          8,
          toFigmaColor(lineColor),
          { r: 1, g: 1, b: 1 },
          1.5
        );
        point.name = `Point: ${s.name}-${labels[i]}`;
        chartGroup.appendChild(point);

        if (style.showValues !== false) {
          const val = getSeriesValue(s, labels[i]);
          const valueNode = await createTextNode(
            val.toString(), 0, 0, style.fontSize || 9,
            { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
          );
          valueNode.x = p.x - valueNode.width / 2;
          valueNode.y = p.y - 18;
          chartGroup.appendChild(valueNode);
        }
      }
    }

    // X-axis labels
    if (style.showLabels !== false) {
      for (let i = 0; i < catCount; i++) {
        const px = chartAreaX + i * stepX;
        const labelNode = await createTextNode(
          labels[i], 0, 0, style.fontSize || 10,
          { r: 0.4, g: 0.4, b: 0.4, a: 1 }, "CENTER"
        );
        labelNode.x = px - labelNode.width / 2;
        labelNode.y = chartAreaY + chartAreaHeight + 5;
        chartGroup.appendChild(labelNode);
      }
    }

    // Legend
    if (showLegend) {
      if (legendPos === "left" || legendPos === "right") {
        const lx = legendPos === "left" ? padding : chartAreaX + chartAreaWidth + 16;
        let ly = chartAreaY;
        for (let si = 0; si < seriesArr.length; si++) {
          const s = seriesArr[si];
          const color = getSeriesColor(s, si, defaultColors);
          const box = figma.createRectangle();
          box.name = `Legend: ${s.name}`;
          box.x = lx;
          box.y = ly;
          box.resize(10, 10);
          box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          box.cornerRadius = 2;
          chartGroup.appendChild(box);
          const legendLabel = await createTextNode(
            s.name, lx + 14, ly - 1,
            style.fontSize || 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          );
          chartGroup.appendChild(legendLabel);
          ly += 20;
        }
      } else {
        let lx = chartAreaX;
        const ly = legendPos === "top"
          ? padding + titleHeight + 5
          : height - padding - legendSize + 5;
        for (let si = 0; si < seriesArr.length; si++) {
          const s = seriesArr[si];
          const color = getSeriesColor(s, si, defaultColors);
          const box = figma.createRectangle();
          box.name = `Legend: ${s.name}`;
          box.x = lx;
          box.y = ly;
          box.resize(10, 10);
          box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          box.cornerRadius = 2;
          chartGroup.appendChild(box);
          const legendLabel = await createTextNode(
            s.name, lx + 14, ly - 1,
            style.fontSize || 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          );
          chartGroup.appendChild(legendLabel);
          lx += 14 + legendLabel.width + 16;
        }
      }
    }
  } else {
    // ===== SINGLE-SERIES (original behavior) =====
    const maxValue = Math.max(...data.map((d) => d.value));
    const minValue = Math.min(...data.map((d) => d.value));
    const valueRange = maxValue - minValue || 1;
    const lineColor = defaultColors[0];

    const points: { x: number; y: number }[] = [];
    const stepX = chartAreaWidth / (data.length - 1 || 1);

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const px = chartAreaX + i * stepX;
      const py = chartAreaY + chartAreaHeight - ((d.value - minValue) / valueRange) * chartAreaHeight;
      points.push({ x: px, y: py });
    }

    if (points.length > 1) {
      let pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x} ${points[i].y}`;
      }

      const lineSvg = `<svg width="${width}" height="${height}">
        <path d="${pathD}" fill="none" stroke="rgb(${Math.round(lineColor.r * 255)},${Math.round(lineColor.g * 255)},${Math.round(lineColor.b * 255)})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>`;

      try {
        const lineNode = figma.createNodeFromSvg(lineSvg);
        lineNode.name = "Line";
        lineNode.x = 0;
        lineNode.y = 0;
        lineNode.clipsContent = false;
        chartGroup.appendChild(lineNode);
      } catch (e) {
        console.error("Error creating line:", e);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const p = points[i];

      const point = createMarkerShape(
        markerShape,
        p.x,
        p.y,
        8,
        toFigmaColor(lineColor)
      );
      point.name = `Point: ${d.label}`;
      chartGroup.appendChild(point);

      if (style.showLabels !== false) {
        const labelNode = await createTextNode(
          d.label, 0, 0, style.fontSize || 10,
          { r: 0.4, g: 0.4, b: 0.4, a: 1 }, "CENTER"
        );
        labelNode.x = p.x - labelNode.width / 2;
        labelNode.y = chartAreaY + chartAreaHeight + 5;
        chartGroup.appendChild(labelNode);
      }

      if (style.showValues !== false) {
        const valueNode = await createTextNode(
          d.value.toString(), 0, 0, style.fontSize || 10,
          { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
        );
        valueNode.x = p.x - valueNode.width / 2;
        valueNode.y = p.y - 18;
        chartGroup.appendChild(valueNode);
      }
    }
  }
}

async function renderPieChartContent(
  chartGroup: FrameNode,
  data: DataPoint[],
  defaultColors: RGBA[],
  size: number,
  title?: string,
  style: ChartStyle = {},
  isDonut: boolean = false,
  innerRadius: number = 0.6,
  centerLabel?: string
) {
  for (const child of [...chartGroup.children]) {
    child.remove();
  }

  const titleHeight = title ? 30 : 0;
  const showLegend = style.showLegend !== false;
  const legendPos = style.legendPosition || "bottom";
  const legendItemH = data.length * 20 + 10;
  const legendSideW = 140;
  const isLegendSide = legendPos === "left" || legendPos === "right";
  const legendH = showLegend && !isLegendSide ? legendItemH : 0;
  const legendW = showLegend && isLegendSide ? legendSideW : 0;
  const totalHeight = size + titleHeight + legendH + 20;
  const totalWidth = size + 40 + legendW;

  chartGroup.resize(totalWidth, totalHeight);

  const chartOffsetX = showLegend && legendPos === "left" ? legendW : 0;
  const centerX = chartOffsetX + (size + 40) / 2;
  const centerY = titleHeight + (showLegend && legendPos === "top" ? legendItemH : 0) + 10 + size / 2;
  const outerRadius = size / 2 - 10;

  if (title) {
    const titleNode = await createTextNode(
      title, 0, 10, style.fontSize ? style.fontSize + 4 : 16,
      { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
    );
    titleNode.x = (size + 40 - titleNode.width) / 2;
    chartGroup.appendChild(titleNode);
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  let currentAngle = -Math.PI / 2;
  const TWO_PI = 2 * Math.PI;
  const normalizeAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const color = getColor(d, i, defaultColors);
    const sliceAngle = (d.value / total) * TWO_PI;
    const endAngle = currentAngle + sliceAngle;

    const ellipse = figma.createEllipse();
    ellipse.resize(outerRadius * 2, outerRadius * 2);
    ellipse.x = centerX - outerRadius;
    ellipse.y = centerY - outerRadius;

    // Figma sweeps clockwise from startingAngle to endingAngle.
    // When start > end after normalization, Figma draws the short arc.
    // To ensure the correct sweep, keep end = start + sliceAngle (unwrapped).
    const normStart = normalizeAngle(currentAngle);
    ellipse.arcData = {
      startingAngle: normStart,
      endingAngle: normStart + sliceAngle,
      innerRadius: isDonut ? innerRadius : 0,
    };
    ellipse.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
    ellipse.name = `Slice: ${d.label}`;
    chartGroup.appendChild(ellipse);

    currentAngle = endAngle;
  }

  if (isDonut && centerLabel) {
    const centerLabelNode = await createTextNode(
      centerLabel, 0, 0, style.fontSize ? style.fontSize + 2 : 14,
      { r: 0.2, g: 0.2, b: 0.2, a: 1 }, "CENTER"
    );
    centerLabelNode.x = centerX - centerLabelNode.width / 2;
    centerLabelNode.y = centerY - centerLabelNode.height / 2;
    chartGroup.appendChild(centerLabelNode);
  }

  if (showLegend) {
    let baseLX: number;
    let baseLY: number;
    if (legendPos === "left") {
      baseLX = 10;
      baseLY = titleHeight + 10;
    } else if (legendPos === "right") {
      baseLX = chartOffsetX + size + 40 + 10;
      baseLY = titleHeight + 10;
    } else if (legendPos === "top") {
      baseLX = chartOffsetX + 10;
      baseLY = titleHeight + 5;
    } else {
      baseLX = chartOffsetX + 10;
      baseLY = titleHeight + size + 20;
    }

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const color = getColor(d, i, defaultColors);

      const colorBox = figma.createRectangle();
      colorBox.name = `Legend: ${d.label}`;
      colorBox.x = baseLX;
      colorBox.y = baseLY + i * 20;
      colorBox.resize(12, 12);
      colorBox.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
      colorBox.cornerRadius = 2;
      chartGroup.appendChild(colorBox);

      const percentage = ((d.value / total) * 100).toFixed(1);
      const labelNode = await createTextNode(
        `${d.label} (${percentage}%)`, baseLX + 20, baseLY + i * 20,
        style.fontSize || 10, { r: 0.3, g: 0.3, b: 0.3, a: 1 }
      );
      chartGroup.appendChild(labelNode);
    }
  }
}

// ============ PUBLIC API FUNCTIONS ============

export async function createBarChart(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  data?: DataPoint[];
  series?: DataSeries[];
  defaultColors?: RGBA[];
  title?: string;
  orientation?: "vertical" | "horizontal";
  barSpacing?: number;
  style?: ChartStyle;
  parentId?: string;
  name?: string;
}) {
  const {
    x, y, width, height,
    data = [],
    series,
    defaultColors = SERIES_PALETTE,
    title,
    orientation = "vertical",
    style = {},
    parentId,
    name = "Bar Chart",
  } = params;

  const parent = await getParentNode(parentId);
  const chartGroup = figma.createFrame();
  chartGroup.name = name;
  chartGroup.x = x;
  chartGroup.y = y;
  chartGroup.resize(width, height);
  // Respect the alpha channel of style.backgroundColor: callers pass
  // {r,g,b,a:0} to request a transparent chart frame, but Figma's SolidPaint
  // only carries RGB on `color` (alpha lives separately as `paint.opacity`),
  // so we must forward `a` into the paint's `opacity` or the frame ends up
  // opaque-white and visually covers the underlying slide.
  chartGroup.fills = style.backgroundColor
    ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (style.backgroundColor as any).a ?? 1,
      }]
    : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];

  const metadata: ChartMetadata = { chartType: "bar", data, series, title, style, width, height, orientation };
  saveChartMetadata(chartGroup, metadata);

  await renderBarChartContent(chartGroup, data, defaultColors, width, height, title, orientation, style, series);
  applyScaleConstraints(chartGroup);
  parent.appendChild(chartGroup);

  const seriesCount = series ? series.length : 1;
  const dataCount = series ? getSeriesLabels(series).length : data.length;
  return { id: chartGroup.id, name: chartGroup.name, chartType: "bar", x, y, width, height, dataCount, seriesCount };
}

export async function createLineChart(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  data?: DataPoint[];
  series?: DataSeries[];
  defaultColors?: RGBA[];
  title?: string;
  showPoints?: boolean;
  markerShape?: MarkerShape;
  showArea?: boolean;
  lineColor?: RGBA;
  lineWidth?: number;
  style?: ChartStyle;
  parentId?: string;
  name?: string;
}) {
  const {
    x, y, width, height,
    data = [],
    series,
    defaultColors = SERIES_PALETTE,
    title,
    style = {},
    parentId,
    name = "Line Chart",
    markerShape = "circle",
  } = params;

  const parent = await getParentNode(parentId);
  const chartGroup = figma.createFrame();
  chartGroup.name = name;
  chartGroup.x = x;
  chartGroup.y = y;
  chartGroup.resize(width, height);
  // Respect the alpha channel of style.backgroundColor: callers pass
  // {r,g,b,a:0} to request a transparent chart frame, but Figma's SolidPaint
  // only carries RGB on `color` (alpha lives separately as `paint.opacity`),
  // so we must forward `a` into the paint's `opacity` or the frame ends up
  // opaque-white and visually covers the underlying slide.
  chartGroup.fills = style.backgroundColor
    ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (style.backgroundColor as any).a ?? 1,
      }]
    : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];

  const metadata: ChartMetadata = { chartType: "line", data, series, title, style, width, height };
  saveChartMetadata(chartGroup, metadata);

  await renderLineChartContent(chartGroup, data, defaultColors, width, height, title, style, series, markerShape);
  applyScaleConstraints(chartGroup);
  parent.appendChild(chartGroup);

  const seriesCount = series ? series.length : 1;
  const dataCount = series ? getSeriesLabels(series).length : data.length;
  return { id: chartGroup.id, name: chartGroup.name, chartType: "line", x, y, width, height, dataCount, seriesCount };
}

export async function createPieChart(params: {
  x: number;
  y: number;
  size: number;
  data: DataPoint[];
  defaultColors?: RGBA[];
  title?: string;
  startAngle?: number;
  style?: ChartStyle;
  parentId?: string;
  name?: string;
}) {
  const { x, y, size, data, defaultColors = SERIES_PALETTE, title, style = {}, parentId, name = "Pie Chart" } = params;

  const parent = await getParentNode(parentId);
  const chartGroup = figma.createFrame();
  chartGroup.name = name;
  chartGroup.x = x;
  chartGroup.y = y;
  // Respect the alpha channel of style.backgroundColor: callers pass
  // {r,g,b,a:0} to request a transparent chart frame, but Figma's SolidPaint
  // only carries RGB on `color` (alpha lives separately as `paint.opacity`),
  // so we must forward `a` into the paint's `opacity` or the frame ends up
  // opaque-white and visually covers the underlying slide.
  chartGroup.fills = style.backgroundColor
    ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (style.backgroundColor as any).a ?? 1,
      }]
    : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];

  const metadata: ChartMetadata = { chartType: "pie", data, title, style, width: size, height: size };
  saveChartMetadata(chartGroup, metadata);

  await renderPieChartContent(chartGroup, data, defaultColors, size, title, style, false);
  applyScaleConstraints(chartGroup);
  parent.appendChild(chartGroup);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  return { id: chartGroup.id, name: chartGroup.name, chartType: "pie", x, y, size, dataCount: data.length, total };
}

export async function createDonutChart(params: {
  x: number;
  y: number;
  size: number;
  data: DataPoint[];
  defaultColors?: RGBA[];
  title?: string;
  innerRadius?: number;
  startAngle?: number;
  centerLabel?: string;
  style?: ChartStyle;
  parentId?: string;
  name?: string;
}) {
  const { x, y, size, data, defaultColors = SERIES_PALETTE, title, innerRadius = 0.6, centerLabel, style = {}, parentId, name = "Donut Chart" } = params;

  const parent = await getParentNode(parentId);
  const chartGroup = figma.createFrame();
  chartGroup.name = name;
  chartGroup.x = x;
  chartGroup.y = y;
  // Respect the alpha channel of style.backgroundColor: callers pass
  // {r,g,b,a:0} to request a transparent chart frame, but Figma's SolidPaint
  // only carries RGB on `color` (alpha lives separately as `paint.opacity`),
  // so we must forward `a` into the paint's `opacity` or the frame ends up
  // opaque-white and visually covers the underlying slide.
  chartGroup.fills = style.backgroundColor
    ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (style.backgroundColor as any).a ?? 1,
      }]
    : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];

  const metadata: ChartMetadata = { chartType: "donut", data, title, style, width: size, height: size, innerRadius, centerLabel };
  saveChartMetadata(chartGroup, metadata);

  await renderPieChartContent(chartGroup, data, defaultColors, size, title, style, true, innerRadius, centerLabel);
  applyScaleConstraints(chartGroup);
  parent.appendChild(chartGroup);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  return { id: chartGroup.id, name: chartGroup.name, chartType: "donut", x, y, size, dataCount: data.length, total };
}

// ============ INTERACTIVE FUNCTIONS ============

export async function getChartData(params: { chartId: string }) {
  const { chartId } = params;
  const node = await resolveNode(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const metadata = loadChartMetadata(node as FrameNode);
  if (!metadata) {
    throw new Error(`No chart metadata found for: ${chartId}`);
  }

  return {
    id: chartId,
    name: node.name,
    ...metadata,
  };
}

export async function updateChartData(params: {
  chartId: string;
  data?: DataPoint[];
  series?: DataSeries[];
  defaultColors?: RGBA[];
  title?: string;
}) {
  const { chartId, data, series, defaultColors = SERIES_PALETTE, title } = params;
  const node = await resolveNode(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const chartFrame = node as FrameNode;
  const metadata = loadChartMetadata(chartFrame);

  if (!metadata) {
    throw new Error(`No chart metadata found. Use get_chart_data first to verify this is a chart.`);
  }

  // Update metadata
  if (data) metadata.data = data;
  if (series !== undefined) metadata.series = series;
  if (title !== undefined) metadata.title = title;
  saveChartMetadata(chartFrame, metadata);

  const effectiveData = metadata.data || [];
  const effectiveSeries = metadata.series;

  // Re-render based on chart type
  const { chartType, width, height, style = {}, orientation, innerRadius, centerLabel } = metadata;

  switch (chartType) {
    case "bar":
      await renderBarChartContent(chartFrame, effectiveData, defaultColors, width, height, metadata.title, orientation, style, effectiveSeries);
      break;
    case "line":
      await renderLineChartContent(chartFrame, effectiveData, defaultColors, width, height, metadata.title, style, effectiveSeries, "circle");
      break;
    case "pie":
      await renderPieChartContent(chartFrame, effectiveData, defaultColors, width, metadata.title, style, false);
      break;
    case "donut":
      await renderPieChartContent(chartFrame, effectiveData, defaultColors, width, metadata.title, style, true, innerRadius, centerLabel);
      break;
  }
  applyScaleConstraints(chartFrame);

  const dataCount = effectiveSeries ? getSeriesLabels(effectiveSeries).length : effectiveData.length;
  return { id: chartId, name: chartFrame.name, chartType, dataCount, updated: true };
}

export async function changeChartType(params: {
  chartId: string;
  newType: ChartType;
  defaultColors?: RGBA[];
}) {
  const { chartId, newType, defaultColors = SERIES_PALETTE } = params;
  const node = await resolveNode(chartId);

  if (!node || node.type !== "FRAME") {
    throw new Error(`Chart not found: ${chartId}`);
  }

  const chartFrame = node as FrameNode;
  const metadata = loadChartMetadata(chartFrame);

  if (!metadata) {
    throw new Error(`No chart metadata found for: ${chartId}`);
  }

  const oldType = metadata.chartType;
  metadata.chartType = newType;

  // Update name to reflect new type
  const typeNames: Record<ChartType, string> = {
    bar: "Bar Chart",
    line: "Line Chart",
    pie: "Pie Chart",
    donut: "Donut Chart",
  };
  chartFrame.name = typeNames[newType];

  // Adjust size for pie/donut vs bar/line
  if ((newType === "pie" || newType === "donut") && (oldType === "bar" || oldType === "line")) {
    metadata.width = Math.min(metadata.width, metadata.height);
    metadata.height = metadata.width;
  } else if ((newType === "bar" || newType === "line") && (oldType === "pie" || oldType === "donut")) {
    metadata.width = 400;
    metadata.height = 300;
    chartFrame.resize(400, 300);
  }

  saveChartMetadata(chartFrame, metadata);

  const { data, series, width, height, title, style = {}, orientation, innerRadius, centerLabel } = metadata;

  switch (newType) {
    case "bar":
      chartFrame.resize(width, height);
      await renderBarChartContent(chartFrame, data, defaultColors, width, height, title, orientation, style, series);
      break;
    case "line":
      chartFrame.resize(width, height);
      await renderLineChartContent(chartFrame, data, defaultColors, width, height, title, style, series, "circle");
      break;
    case "pie":
      await renderPieChartContent(chartFrame, data, defaultColors, width, title, style, false);
      break;
    case "donut":
      await renderPieChartContent(chartFrame, data, defaultColors, width, title, style, true, innerRadius ?? 0.6, centerLabel);
      break;
  }
  applyScaleConstraints(chartFrame);

  return { id: chartId, name: chartFrame.name, oldType, newType, changed: true };
}
