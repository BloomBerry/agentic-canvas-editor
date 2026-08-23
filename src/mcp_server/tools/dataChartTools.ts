import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";

const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1).optional(),
});

// Tabular data input (Excel-like: headers + rows)
const TabularDataSchema = z.object({
  headers: z
    .array(z.string())
    .describe("Column headers. First column = category labels, remaining columns = data series names."),
  rows: z
    .array(z.array(z.union([z.string(), z.number()])))
    .describe("Data rows. First value = category label (string), remaining values = numeric data for each series."),
});

// Chart options
const ChartOptionsSchema = z.object({
  title: z.string().optional().describe("Chart title text"),
  showTitle: z.boolean().optional().describe("Show/hide title (default: true if title provided)"),
  showGrid: z.boolean().optional().describe("Show horizontal grid lines (default: false)"),
  showLabels: z.boolean().optional().describe("Show category labels on X-axis (default: true)"),
  showValues: z.boolean().optional().describe("Show value labels on data points (default: false)"),
  showLegend: z.boolean().optional().describe("Show legend for multi-series (default: true)"),
  showDots: z.boolean().optional().describe("Show data point dots on line/area charts (default: true)"),
  showAxis: z.boolean().optional().describe("Show X/Y axis lines with ticks (default: true)"),
  dotSize: z.number().optional().describe("Dot radius in px for line/area charts (default: 6)"),
  markerShape: z
    .enum(["circle", "square", "diamond", "triangle_up", "triangle_down", "star", "pentagon", "hexagon", "x", "plus"])
    .optional()
    .describe("Marker shape for line/area chart data points (default: circle)"),
  legendPosition: z.enum(["top", "bottom", "left", "right"]).optional().describe("Legend placement (default: bottom)"),
  orientation: z.enum(["vertical", "horizontal"]).optional().describe("Bar orientation (default: vertical)"),
  xAxisLabel: z.string().optional().describe("X-axis label text"),
  yAxisLabel: z.string().optional().describe("Y-axis label text"),
  valueFormat: z.enum(["number", "percent", "currency"]).optional().describe("Value display format (default: number)"),
  currencySymbol: z.string().optional().describe("Currency symbol for 'currency' format (default: $)"),
  decimalPlaces: z.number().optional().describe("Decimal places for value labels (default: 0)"),
  colors: z.array(ColorSchema).optional().describe("Custom color palette for series (overrides default 8-color palette)"),
  backgroundColor: ColorSchema.optional().describe("Chart background color (default: white)"),
  fontFamily: z.string().optional().describe("Font family (default: Inter)"),
  fontSize: z.number().optional().describe("Base font size (default: 10)"),
  barCornerRadius: z.number().optional().describe("Bar corner radius (default: 3)"),
  lineWidth: z.number().optional().describe("Line stroke width for line/area charts (default: 2)"),
  innerRadius: z.number().min(0).max(1).optional().describe("Donut inner radius ratio 0-1 (default: 0.6)"),
  centerLabel: z.string().optional().describe("Center label for donut chart"),
  stackedValueMode: z.enum(["total", "segment"]).optional().describe("Value label mode for stacked_bar charts: 'total' = show sum on top (default), 'segment' = show each segment's value inside its bar"),
});

export function registerDataChartTools(server: McpServer) {
  // Create Data Chart
  server.tool(
    "create_data_chart",
    "Create a rich chart from tabular (Excel-like) data. Supports: bar (grouped multi-series), stacked_bar, line (multi-series with dots), area (filled line), pie, donut. Features: axis labels, grid lines, legend, value formatting, custom colors. Data format: headers array (first = categories, rest = series names) + rows array (first value = category label, rest = numeric values).",
    {
      x: z.number().optional().describe("X coordinate (default: 0)"),
      y: z.number().optional().describe("Y coordinate (default: 0)"),
      width: z.number().optional().describe("Chart width (default: 600)"),
      height: z.number().optional().describe("Chart height (default: 400)"),
      chartType: z
        .enum(["bar", "line", "pie", "donut", "area", "stacked_bar"])
        .describe("Chart type"),
      data: TabularDataSchema.describe("Tabular data with headers and rows"),
      options: ChartOptionsSchema.optional().describe("Chart styling and display options"),
      parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
      name: z.string().optional().describe("Name for the chart frame"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_data_chart", params);
        return createSuccessResponse({
          messages: [
            `Created ${result.chartType} chart "${result.name}" (${result.id}) - ${result.categories} categories, ${result.series} series`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_data_chart" });
      }
    }
  );

  // Update Data Chart
  server.tool(
    "update_data_chart",
    "Update an existing data chart with new tabular data and/or options. The chart will be re-rendered while preserving its type and position.",
    {
      chartId: z.string().describe("ID of the chart to update"),
      data: TabularDataSchema.optional().describe("New tabular data"),
      options: ChartOptionsSchema.optional().describe("Updated chart options (merged with existing)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("update_data_chart", params);
        return createSuccessResponse({
          messages: [`Updated data chart "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "update_data_chart" });
      }
    }
  );

  // Change Data Chart Type
  server.tool(
    "change_data_chart_type",
    "Change the type of an existing data chart created by create_data_chart. Supports: bar, line, pie, donut, area, stacked_bar. Data is preserved and chart is re-rendered.",
    {
      chartId: z.string().describe("ID of the chart to modify"),
      newType: z
        .enum(["bar", "line", "pie", "donut", "area", "stacked_bar"])
        .describe("New chart type"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("change_data_chart_type", params);
        return createSuccessResponse({
          messages: [`Changed chart type from "${result.oldType}" to "${result.newType}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "change_data_chart_type" });
      }
    }
  );

  // Get Data Chart Info
  server.tool(
    "get_data_chart_info",
    "Get the current data, chart type, and options of an existing data chart.",
    {
      chartId: z.string().describe("ID of the chart to inspect"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_data_chart_info", params);
        return createSuccessResponse({
          messages: [`Data chart "${result.name}" (type: ${result.chartType})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_data_chart_info" });
      }
    }
  );
}
