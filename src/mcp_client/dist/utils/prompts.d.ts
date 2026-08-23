/** FULL mode – original behaviour (backward-compatible). */
export declare function getFigmaSlideModificationPrompt(instruction: string, baseJsonString: string, slideCount: number): string;
/** MICRO_SPATIAL – deep scene graph for target slides only. */
export declare function getMicroSpatialPrompt(instruction: string, contextJson: string, slideCount: number): string;
/** MACRO_PROGRAMMATIC – skeleton JSON (text + IDs only). */
export declare function getMacroProgrammaticPrompt(instruction: string, contextJson: string, slideCount: number): string;
/** SYSTEMIC_TOKEN – style metadata (colours, fonts, usage). */
export declare function getSystemicTokenPrompt(instruction: string, contextJson: string, slideCount: number): string;
/** OFF mode – no pre-supplied context; LLM discovers canvas state via tools. */
export declare function getMinimalPrompt(instruction: string, slideCount: number): string;
/** Select the correct prompt builder based on CARE routing mode. */
export declare function getPromptForMode(mode: string, instruction: string, contextJson: string, slideCount: number): string;
//# sourceMappingURL=prompts.d.ts.map