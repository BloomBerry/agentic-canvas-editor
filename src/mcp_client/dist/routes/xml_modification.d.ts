/**
 * XML Ablation: Route handler for /xml-modification endpoint
 *
 * Same as modification.ts but:
 * - Parses xmlIdMapping form field
 * - Uses XML-mode prompts
 * - Creates XmlFigmaSlideAgent instead of SingleFigmaSlideAgent
 */
import { Response } from "express";
import { MulterRequest, ResponseData } from "../types";
export declare const runXmlModification: (req: MulterRequest, res: Response<ResponseData>) => Promise<void>;
//# sourceMappingURL=xml_modification.d.ts.map