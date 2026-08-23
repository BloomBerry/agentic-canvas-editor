import { z } from "zod";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
// Initialize MathJax
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: "none" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svg });
// Convert "ex" units to pixels (1ex ≈ 8px for typical math fonts)
const EX_TO_PX = 8;
// Convert LaTeX to SVG
function latexToSvg(latex, displayMode = false, scale = 1) {
    const node = html.convert(latex, { display: displayMode });
    let svgString = adaptor.outerHTML(node);
    // Extract just the SVG element (remove mjx-container wrapper)
    const svgMatch = svgString.match(/<svg[^>]*>[\s\S]*<\/svg>/);
    if (svgMatch) {
        svgString = svgMatch[0];
    }
    // Convert "ex" units to pixels
    svgString = svgString.replace(/width="([0-9.]+)ex"/g, (_, num) => {
        return `width="${parseFloat(num) * EX_TO_PX * scale}"`;
    });
    svgString = svgString.replace(/height="([0-9.]+)ex"/g, (_, num) => {
        return `height="${parseFloat(num) * EX_TO_PX * scale}"`;
    });
    // Fix viewBox if needed (convert ex to unitless numbers)
    svgString = svgString.replace(/viewBox="([^"]+)"/g, (match, viewBox) => {
        // viewBox should already be unitless, but ensure it's valid
        return match;
    });
    // Remove MathJax-specific attributes
    svgString = svgString.replace(/\s*data-[a-z-]+="[^"]*"/gi, "");
    svgString = svgString.replace(/\s*focusable="[^"]*"/gi, "");
    svgString = svgString.replace(/\s*role="[^"]*"/gi, "");
    svgString = svgString.replace(/\s*aria-[a-z-]+="[^"]*"/gi, "");
    // Replace currentColor with black
    svgString = svgString.replace(/currentColor/g, "#000000");
    // Add xmlns if missing
    if (!svgString.includes('xmlns=')) {
        svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    // Remove any style elements that might cause issues
    svgString = svgString.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    return svgString;
}
export function registerMathTools(server) {
    // Create Math Equation
    server.tool("create_math", "Create a mathematical equation from LaTeX syntax and insert it as a vector graphic", {
        latex: z.string().describe("LaTeX math expression (e.g., 'E = mc^2', '\\\\frac{a}{b}', '\\\\int_0^1 x^2 dx')"),
        x: z.number().describe("X coordinate for the equation"),
        y: z.number().describe("Y coordinate for the equation"),
        displayMode: z.boolean().optional().describe("Display mode (true for centered block, false for inline). Default: true"),
        scale: z.number().optional().describe("Scale factor for the equation size (default: 1)"),
        color: z.object({
            r: z.number().min(0).max(1),
            g: z.number().min(0).max(1),
            b: z.number().min(0).max(1),
        }).optional().describe("Color for the equation (RGB values 0-1). Default: black"),
        name: z.string().optional().describe("Name for the equation node"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
    }, async (params) => {
        try {
            const { latex, x, y, displayMode = true, scale = 1, color, name, parentId } = params;
            // Convert LaTeX to SVG (scale is applied during conversion)
            let svgString = latexToSvg(latex, displayMode, scale);
            // Apply color if specified
            if (color) {
                const rgbColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
                // Replace black fills with the specified color
                svgString = svgString.replace(/#000000/g, rgbColor);
                svgString = svgString.replace(/#000/g, rgbColor);
                svgString = svgString.replace(/fill="black"/g, `fill="${rgbColor}"`);
            }
            // Create the graphic using the existing create_graphic command
            const result = await sendCommandToFigma("create_graphic", {
                svg: svgString,
                x,
                y,
                name: name || `Math: ${latex.substring(0, 30)}${latex.length > 30 ? "..." : ""}`,
                parentId,
            });
            return createSuccessResponse({
                messages: [`Created math equation "${latex.substring(0, 50)}${latex.length > 50 ? "..." : ""}" (${result.id})`],
                dataItem: {
                    ...result,
                    latex,
                    displayMode,
                },
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_math" });
        }
    });
}
