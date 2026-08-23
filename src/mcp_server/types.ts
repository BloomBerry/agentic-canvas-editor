import {
  TextContent,
  ImageContent,
  AudioContent,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";

export type ResponseContent =
  | TextContent
  | ImageContent
  | AudioContent
  | EmbeddedResource;

export interface FigmaResponse {
  id: string;
  result?: any;
  error?: string;
}

export type FigmaCommand =
  // Connection
  | "get_channels"
  | "select_channel"
  | "check_connection_status"
  // Slide Management
  | "create_slide"
  | "delete_slide"
  | "clone_slide"
  | "focus_slide"
  | "get_focused_slide"
  | "get_slide_grid"
  | "set_slide_transition"
  | "skip_slide"
  | "get_all_slides"
  | "reorder_slides"
  | "get_slide_properties"
  | "get_slide_speaker_notes"
  | "set_slide_speaker_notes"
  // Content Creation
  | "create_rectangle"
  | "create_frame"
  | "create_text"
  | "create_ellipse"
  | "create_graphic"
  | "create_marker"
  | "create_polygon"
  | "create_star"
  | "create_line"
  | "create_mask"
  // Content Operations
  | "move_node"
  | "resize_node"
  | "delete_node"
  | "clone_node"
  | "group_nodes"
  | "ungroup_nodes"
  | "reparent_node"
  | "reorder_node"
  | "boolean_nodes"
  // Style
  | "set_fill_color"
  | "set_fill_gradient"
  | "set_stroke"
  | "set_opacity"
  | "set_corner_radius"
  | "set_drop_shadow"
  | "set_inner_shadow"
  | "set_blend_mode"
  | "copy_style"
  // Text
  | "set_text_content"
  | "set_text_properties"
  | "get_text_node_info"
  | "set_text_decoration"
  | "set_text_font"
  | "set_text_range_style"
  // Text Styles
  | "get_local_text_styles"
  | "set_text_style"
  | "get_text_style"
  // Inspection
  | "get_page_info"
  | "get_page_structure"
  | "get_node_info"
  | "get_node_info_by_types"
  | "get_selection_info"
  | "get_result_image"
  | "get_styles"
  // Rename
  | "rename_node"
  | "rename_layers"
  // Layout
  | "set_layout_mode"
  | "set_padding"
  | "set_axis_align"
  | "set_layout_sizing"
  | "set_item_spacing"
  | "set_child_layout_props"
  | "set_constraints"
  // Export
  | "export_slide_image"
  // Import / Export JSON
  | "export_json"
  | "import_json"
  | "clear_canvas"
  // Transform
  | "rotate_node"
  // Color
  | "replace_color"
  // Charts
  | "create_bar_chart"
  | "create_line_chart"
  | "create_pie_chart"
  | "create_donut_chart"
  | "update_chart_data"
  | "get_chart_data"
  | "change_chart_type"
  // Data Charts (tabular data → rich charts)
  | "create_data_chart"
  | "update_data_chart"
  | "change_data_chart_type"
  | "get_data_chart_info"
  // Tables (text/CSV/TSV/Markdown → Figma table)
  | "create_table"
  | "create_table_from_data"
  | "update_table"
  | "get_table_info"
  // SmartArt
  | "create_smartart"
  | "update_smartart"
  | "change_smartart_type"
  | "get_smartart_info"
  // Image
  | "insert_image"
  // Batch
  | "batch_execute";

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  lastActivity: number;
}

export interface CommandProgressUpdate {
  commandType: string;
  progress: number;
  message: string;
  status: "in_progress" | "completed" | "error";
}

export interface ProgressMessage {
  type: "progress_update";
  id: string;
  data: CommandProgressUpdate;
}
