import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
// Common schema for RGBA color
const ColorSchema = z.object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1).optional(),
});
// Common schema for chart data point
const DataPointSchema = z.object({
    label: z.string().describe("Label for this data point"),
    value: z.number().describe("Numeric value"),
    color: ColorSchema.optional().describe("Optional custom color for this data point"),
});
// Schema for multi-series data (e.g., grouped bar chart, multi-line chart)
const DataSeriesSchema = z.object({
    name: z.string().describe("Name of the data series (shown in legend)"),
    data: z.array(DataPointSchema).describe("Data points for this series"),
    color: ColorSchema.optional().describe("Optional color for the entire series"),
});
// Common schema for chart styling
const ChartStyleSchema = z.object({
    backgroundColor: z
        .object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
    })
        .optional()
        .describe("Background color of the chart"),
    showLabels: z.boolean().optional().describe("Show data labels (default: true)"),
    showValues: z.boolean().optional().describe("Show values on chart (default: true)"),
    showLegend: z.boolean().optional().describe("Show legend (default: true)"),
    legendPosition: z.enum(["top", "bottom", "left", "right"]).optional().describe("Legend placement (default: bottom)"),
    fontFamily: z.string().optional().describe("Font family for text (default: Inter)"),
    fontSize: z.number().optional().describe("Base font size (default: 12)"),
});
// Default color palette for charts
const DEFAULT_COLORS = [
    { r: 0.259, g: 0.522, b: 0.957, a: 1 }, // Blue
    { r: 0.914, g: 0.263, b: 0.208, a: 1 }, // Red
    { r: 0.984, g: 0.737, b: 0.02, a: 1 }, // Yellow
    { r: 0.204, g: 0.659, b: 0.325, a: 1 }, // Green
    { r: 0.608, g: 0.349, b: 0.714, a: 1 }, // Purple
    { r: 1, g: 0.596, b: 0, a: 1 }, // Orange
    { r: 0, g: 0.737, b: 0.831, a: 1 }, // Cyan
    { r: 0.914, g: 0.118, b: 0.388, a: 1 }, // Pink
];
export function registerChartTools(server) {
    // Create Bar Chart
    server.tool("create_bar_chart", "Create a bar chart (vertical or horizontal). Supports single-series (data) or multi-series grouped bar (series). For multi-series, each series becomes a grouped bar with its own color and legend entry.", {
        x: z.number().describe("X coordinate for the chart"),
        y: z.number().describe("Y coordinate for the chart"),
        width: z.number().describe("Width of the chart"),
        height: z.number().describe("Height of the chart"),
        data: z.array(DataPointSchema).optional().describe("Single-series data points (use this OR series, not both)"),
        series: z.array(DataSeriesSchema).optional().describe("Multi-series data for grouped bar chart. Each series has a name and array of data points sharing the same labels."),
        title: z.string().optional().describe("Chart title"),
        orientation: z
            .enum(["vertical", "horizontal"])
            .optional()
            .describe("Bar orientation (default: vertical)"),
        barSpacing: z.number().optional().describe("Spacing between bars (default: 8)"),
        style: ChartStyleSchema.optional().describe("Chart styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the chart group"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_bar_chart", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Created bar chart "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_bar_chart" });
        }
    });
    // Create Line Chart
    server.tool("create_line_chart", "Create a line chart. Supports single-series (data) or multi-series (series) with multiple colored lines and legend.", {
        x: z.number().describe("X coordinate for the chart"),
        y: z.number().describe("Y coordinate for the chart"),
        width: z.number().describe("Width of the chart"),
        height: z.number().describe("Height of the chart"),
        data: z.array(DataPointSchema).optional().describe("Single-series data points (use this OR series, not both)"),
        series: z.array(DataSeriesSchema).optional().describe("Multi-series data for multi-line chart. Each series becomes a separate colored line with legend entry."),
        title: z.string().optional().describe("Chart title"),
        showPoints: z.boolean().optional().describe("Show data points (default: true)"),
        markerShape: z
            .enum(["circle", "square", "diamond", "triangle_up", "triangle_down", "star", "pentagon", "hexagon", "x", "plus"])
            .optional()
            .describe("Marker shape for data points (default: circle)"),
        showArea: z.boolean().optional().describe("Fill area under line (default: false)"),
        lineColor: z
            .object({
            r: z.number().min(0).max(1),
            g: z.number().min(0).max(1),
            b: z.number().min(0).max(1),
            a: z.number().min(0).max(1).optional(),
        })
            .optional()
            .describe("Line color"),
        lineWidth: z.number().optional().describe("Line stroke width (default: 2)"),
        style: ChartStyleSchema.optional().describe("Chart styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the chart group"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_line_chart", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Created line chart "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_line_chart" });
        }
    });
    // Create Pie Chart
    server.tool("create_pie_chart", "Create a pie chart with the provided data", {
        x: z.number().describe("X coordinate for the chart"),
        y: z.number().describe("Y coordinate for the chart"),
        size: z.number().describe("Diameter of the pie chart"),
        data: z.array(DataPointSchema).describe("Array of data points with labels and values"),
        title: z.string().optional().describe("Chart title"),
        startAngle: z.number().optional().describe("Start angle in degrees (default: -90, top)"),
        style: ChartStyleSchema.optional().describe("Chart styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the chart group"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_pie_chart", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Created pie chart "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_pie_chart" });
        }
    });
    // Create Donut Chart
    server.tool("create_donut_chart", "Create a donut chart (pie chart with hole in center) with the provided data", {
        x: z.number().describe("X coordinate for the chart"),
        y: z.number().describe("Y coordinate for the chart"),
        size: z.number().describe("Outer diameter of the donut chart"),
        data: z.array(DataPointSchema).describe("Array of data points with labels and values"),
        title: z.string().optional().describe("Chart title"),
        innerRadius: z
            .number()
            .min(0.1)
            .max(0.9)
            .optional()
            .describe("Inner radius ratio (0.1-0.9, default: 0.6)"),
        startAngle: z.number().optional().describe("Start angle in degrees (default: -90, top)"),
        centerLabel: z.string().optional().describe("Text to display in the center"),
        style: ChartStyleSchema.optional().describe("Chart styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the chart group"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_donut_chart", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Created donut chart "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_donut_chart" });
        }
    });
    // Update Chart Data
    server.tool("update_chart_data", "Update the data of an existing chart. The chart will be re-rendered with new data while preserving its type and position. Supports both single-series (data) and multi-series (series).", {
        chartId: z.string().describe("ID of the chart to update"),
        data: z.array(DataPointSchema).optional().describe("New single-series data points"),
        series: z.array(DataSeriesSchema).optional().describe("New multi-series data"),
        title: z.string().optional().describe("New chart title (optional)"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("update_chart_data", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Updated chart "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "update_chart_data" });
        }
    });
    // Get Chart Data
    server.tool("get_chart_data", "Get the current data and metadata of an existing chart. Use this to inspect chart data before updating.", {
        chartId: z.string().describe("ID of the chart to inspect"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("get_chart_data", params);
            return createSuccessResponse({
                messages: [`Retrieved data for chart "${result.name}" (type: ${result.chartType})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_chart_data" });
        }
    });
    // Change Chart Type
    server.tool("change_chart_type", "Change the type of an existing simple chart created by create_bar_chart/create_line_chart/create_pie_chart/create_donut_chart. Only supports bar, line, pie, donut. For data charts (created by create_data_chart) that support area and stacked_bar, use change_data_chart_type instead.", {
        chartId: z.string().describe("ID of the chart to modify"),
        newType: z
            .enum(["bar", "line", "pie", "donut"])
            .describe("New chart type"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("change_chart_type", {
                ...params,
                defaultColors: DEFAULT_COLORS,
            });
            return createSuccessResponse({
                messages: [`Changed chart type from "${result.oldType}" to "${result.newType}"`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "change_chart_type" });
        }
    });
}
