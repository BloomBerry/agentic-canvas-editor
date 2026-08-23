/**
 * XML Ablation: OOXML-specific prompt builders
 *
 * Replaces the SceneGraph JSON context instructions with OOXML XML context
 * instructions for the ablation study. The key differences:
 * - Flat <p:spTree> structure instead of hierarchical node tree
 * - Absolute EMU coordinates instead of parent-relative pixels
 * - Integer <p:cNvPr id> element IDs instead of Figma "1:23" format
 * - XML code blocks instead of JSON
 */
/** Build a prompt for XML ablation mode. */
export declare function getXmlModePrompt(instruction: string, xmlContext: string, slideCount: number): string;
//# sourceMappingURL=xml_prompts.d.ts.map