import * as SlideHandlers from "./handlers/slideHandlers";
import * as ContentHandlers from "./handlers/contentHandlers";
import * as ChartHandlers from "./handlers/chartHandlers";
import * as DataChartHandlers from "./handlers/dataChartHandlers";
import * as TableHandlers from "./handlers/tableHandlers";
import * as ImportExportHandlers from "./handlers/importExportHandlers";
import * as SmartArtHandlers from "./handlers/smartArtHandlers";
import * as ImageHandlers from "./handlers/imageHandlers";
import { nodeIdMap } from "./bridge";

// Handle command dispatch
async function handleCommand(command: string, params: any) {
  switch (command) {
    // Slide Management
    case "create_slide":
      return await SlideHandlers.createSlide(params);
    case "delete_slide":
      return await SlideHandlers.deleteSlide(params);
    case "clone_slide":
      return await SlideHandlers.cloneSlide(params);
    case "focus_slide":
      return await SlideHandlers.focusSlide(params);
    case "get_focused_slide":
      return await SlideHandlers.getFocusedSlide();
    case "get_slide_grid":
      return await SlideHandlers.getSlideGrid();
    case "get_all_slides":
      return await SlideHandlers.getAllSlides();
    case "reorder_slides":
      return await SlideHandlers.reorderSlides(params);
    case "set_slide_transition":
      return await SlideHandlers.setSlideTransition(params);
    case "skip_slide":
      return await SlideHandlers.skipSlide(params);
    case "get_slide_properties":
      return await SlideHandlers.getSlideProperties(params);
    case "get_slide_speaker_notes":
      return await SlideHandlers.getSlideSpeakerNotes(params);
    case "set_slide_speaker_notes":
      return await SlideHandlers.setSlideSpeakerNotes(params);

    // Content Creation
    case "create_rectangle":
      return await ContentHandlers.createRectangle(params);
    case "create_frame":
      return await ContentHandlers.createFrame(params);
    case "create_text":
      return await ContentHandlers.createText(params);
    case "create_ellipse":
      return await ContentHandlers.createEllipse(params);
    case "create_graphic":
      return await ContentHandlers.createGraphic(params);
    case "create_marker":
      return await ContentHandlers.createMarker(params);
    case "create_polygon":
      return await ContentHandlers.createPolygon(params);
    case "create_star":
      return await ContentHandlers.createStar(params);
    case "create_line":
      return await ContentHandlers.createLine(params);
    case "create_mask":
      return await ContentHandlers.createMask(params);

    // Content Operations
    case "move_node":
      return await ContentHandlers.moveNode(params);
    case "resize_node":
      return await ContentHandlers.resizeNode(params);
    case "delete_node":
      return await ContentHandlers.deleteNode(params);
    case "clone_node":
      return await ContentHandlers.cloneNode(params);
    case "group_nodes":
      return await ContentHandlers.groupNodes(params);
    case "reparent_node":
      return await ContentHandlers.reparentNode(params);
    case "ungroup_nodes":
      return await ContentHandlers.ungroupNodes(params);
    case "reorder_node":
      return await ContentHandlers.reorderNode(params);
    case "boolean_nodes":
      return await ContentHandlers.booleanNodes(params);

    // Styling
    case "set_fill_color":
      return await ContentHandlers.setFillColor(params);
    case "set_fill_gradient":
      return await ContentHandlers.setFillGradient(params);
    case "set_stroke":
      return await ContentHandlers.setStroke(params);
    case "set_opacity":
      return await ContentHandlers.setOpacity(params);
    case "set_corner_radius":
      return await ContentHandlers.setCornerRadius(params);
    case "set_drop_shadow":
      return await ContentHandlers.setDropShadow(params);
    case "set_inner_shadow":
      return await ContentHandlers.setInnerShadow(params);
    case "set_blend_mode":
      return await ContentHandlers.setBlendMode(params);
    case "copy_style":
      return await ContentHandlers.copyStyle(params);

    // Text
    case "set_text_content":
      return await ContentHandlers.setTextContent(params);
    case "set_text_properties":
      return await ContentHandlers.setTextProperties(params);
    case "get_text_node_info":
      return await ContentHandlers.getTextNodeInfo(params);
    case "set_text_decoration":
      return await ContentHandlers.setTextDecoration(params);
    case "set_text_font":
      return await ContentHandlers.setTextFont(params);
    case "set_text_range_style":
      return await ContentHandlers.setTextRangeStyle(params);

    // Text Styles
    case "get_local_text_styles":
      return await ContentHandlers.getLocalTextStyles();
    case "set_text_style":
      return await ContentHandlers.setTextStyle(params);
    case "get_text_style":
      return await ContentHandlers.getTextStyle(params);

    // Inspection
    case "get_page_info":
      return await ContentHandlers.getPageInfo();
    case "get_page_structure":
      return await ContentHandlers.getPageStructure();
    case "get_node_info":
      return await ContentHandlers.getNodeInfo(params);
    case "get_node_info_by_types":
      return await ContentHandlers.getNodeInfoByTypes(params);
    case "get_selection_info":
      return await ContentHandlers.getSelectionInfo();
    case "get_result_image":
      return await ContentHandlers.getResultImage(params);
    case "get_styles":
      return await ContentHandlers.getStyles();

    // Rename
    case "rename_node":
      return await ContentHandlers.renameNode(params);
    case "rename_layers":
      return await ContentHandlers.renameLayers(params);

    // Layout
    case "set_layout_mode":
      return await ContentHandlers.setLayoutMode(params);
    case "set_padding":
      return await ContentHandlers.setPadding(params);
    case "set_axis_align":
      return await ContentHandlers.setAxisAlign(params);
    case "set_layout_sizing":
      return await ContentHandlers.setLayoutSizing(params);
    case "set_item_spacing":
      return await ContentHandlers.setItemSpacing(params);
    case "set_child_layout_props":
      return await ContentHandlers.setChildLayoutProps(params);
    case "set_constraints":
      return await ContentHandlers.setConstraints(params);

    // Export
    case "export_slide_image":
      return await ContentHandlers.exportSlideImage(params);

    // Transform
    case "rotate_node":
      return await ContentHandlers.rotateNode(params);

    // Color
    case "replace_color":
      return await ContentHandlers.replaceColor(params);

    // Charts
    case "create_bar_chart":
      return await ChartHandlers.createBarChart(params);
    case "create_line_chart":
      return await ChartHandlers.createLineChart(params);
    case "create_pie_chart":
      return await ChartHandlers.createPieChart(params);
    case "create_donut_chart":
      return await ChartHandlers.createDonutChart(params);
    case "update_chart_data":
      return await ChartHandlers.updateChartData(params);
    case "get_chart_data":
      return await ChartHandlers.getChartData(params);
    case "change_chart_type":
      return await ChartHandlers.changeChartType(params);

    // Data Charts (tabular data → rich charts)
    case "create_data_chart":
      return await DataChartHandlers.createDataChart(params);
    case "update_data_chart":
      return await DataChartHandlers.updateDataChart(params);
    case "change_data_chart_type":
      return await DataChartHandlers.changeDataChartType(params);
    case "get_data_chart_info":
      return await DataChartHandlers.getDataChartInfo(params);

    // Tables (text/CSV/TSV/Markdown → Figma table)
    case "create_table":
      return await TableHandlers.createTable(params);
    case "create_table_from_data":
      return await TableHandlers.createTableFromData(params);
    case "update_table":
      return await TableHandlers.updateTable(params);
    case "get_table_info":
      return await TableHandlers.getTableInfo(params);

    // SmartArt
    case "create_smartart":
      return await SmartArtHandlers.createSmartArt(params);
    case "update_smartart":
      return await SmartArtHandlers.updateSmartArt(params);
    case "change_smartart_type":
      return await SmartArtHandlers.changeSmartArtType(params);
    case "get_smartart_info":
      return await SmartArtHandlers.getSmartArtInfo(params);

    // Image
    case "insert_image":
      return await ImageHandlers.insertImage(params);

    // Import / Export
    case "export_json":
      return await ImportExportHandlers.exportJson();
    case "import_json":
      return await ImportExportHandlers.importJson(params);
    case "clear_canvas": {
      const page = figma.currentPage;
      let removed = 0;
      // In Figma Slides the tree is Page → SLIDE_GRID → SLIDE_ROW → SLIDE.
      // SLIDE_GRID / SLIDE_ROW cannot be removed directly; we must remove
      // every SLIDE node inside them, then clean up leftover containers.
      function collectAllSlides(node: BaseNode): SceneNode[] {
        if (node.type === "SLIDE") return [node as SceneNode];
        const slides: SceneNode[] = [];
        if ("children" in node) {
          for (const child of (node as any).children) {
            slides.push(...collectAllSlides(child));
          }
        }
        return slides;
      }
      // Phase 1: remove all SLIDE nodes
      const allSlides = collectAllSlides(page);
      for (const slide of allSlides) {
        try { slide.remove(); removed++; } catch {}
      }
      // Phase 2: remove any remaining top-level children (orphan FRAMEs, etc.)
      for (const child of Array.from(page.children)) {
        try { child.remove(); removed++; } catch {}
      }
      // Phase 3: clear stale ID mappings so the next import starts fresh
      nodeIdMap.clear();
      return { success: true, removed, message: `Removed ${removed} node(s)` };
    }

    // Batch execution
    case "batch_execute": {
      const results: { command: string; success: boolean; result?: any; error?: string }[] = [];
      for (const op of params.operations) {
        try {
          const result = await handleCommand(op.command, op.params);
          results.push({ command: op.command, success: true, result });
        } catch (error) {
          results.push({
            command: op.command,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        results,
        total: params.operations.length,
        succeeded: results.filter((r) => r.success).length,
      };
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Plugin entry point
figma.showUI(__html__, { width: 350, height: 500 });

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "execute-command":
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;

    case "notify":
      figma.notify(msg.message);
      break;

    case "close-plugin":
      figma.closePlugin();
      break;
  }
};