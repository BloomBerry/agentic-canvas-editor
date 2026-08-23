import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
const UNSPLASH_API_BASE = "https://api.unsplash.com";
// Read lazily — dotenv loads after ESM imports are hoisted
function getAccessKey() {
    return process.env.UNSPLASH_ACCESS_KEY || "";
}
export function registerUnsplashTools(server) {
    // Search Unsplash photos
    server.tool("search_unsplash", "Search Unsplash for free-to-use images by keyword. All Unsplash images are free under the Unsplash License (free for commercial and non-commercial use, no permission needed). Returns a list of images with multiple size URLs (thumb/small/regular/full), descriptions, dimensions, and photographer info. Use the returned URLs with insert_image to place photos on the slide. Set contentType to 'illustration' to find illustrations, vectors, and graphic art instead of photographs. IMPORTANT: When using insert_image with Unsplash results, always pass photographerName and photographerUsername from the photographer field to ensure proper attribution ('Photo by [Name] on Unsplash').", {
        query: z.string().describe("Search query (e.g., 'mountain landscape', 'office workspace')"),
        contentType: z
            .enum(["photo", "illustration"])
            .optional()
            .describe("Type of content to search for. 'photo' returns photographs (default). 'illustration' appends illustration/vector keywords to find graphic art, illustrations, and vector-style images."),
        perPage: z
            .number()
            .min(1)
            .max(30)
            .optional()
            .describe("Number of results per page (default: 5)"),
        page: z.number().optional().describe("Page number for pagination (default: 1)"),
        orientation: z
            .enum(["landscape", "portrait", "squarish"])
            .optional()
            .describe("Filter by photo orientation"),
    }, async (params) => {
        try {
            const { query, contentType, perPage = 5, page = 1, orientation } = params;
            // Modify query for illustration content type
            const effectiveQuery = contentType === "illustration"
                ? `${query} illustration vector graphic`
                : query;
            const searchParams = new URLSearchParams({
                query: effectiveQuery,
                per_page: String(perPage),
                page: String(page),
            });
            if (orientation)
                searchParams.set("orientation", orientation);
            const response = await fetch(`${UNSPLASH_API_BASE}/search/photos?${searchParams}`, {
                headers: { Authorization: `Client-ID ${getAccessKey()}` },
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Unsplash API error: ${response.status} ${response.statusText} - ${errorBody}`);
            }
            const data = await response.json();
            const results = data.results.map((photo) => ({
                id: photo.id,
                description: photo.description || photo.alt_description || "",
                width: photo.width,
                height: photo.height,
                urls: {
                    thumb: photo.urls.thumb, // 200px wide
                    small: photo.urls.small, // 400px wide
                    regular: photo.urls.regular, // 1080px wide
                    full: photo.urls.full, // original resolution
                },
                photographer: {
                    name: photo.user.name,
                    username: photo.user.username,
                    profileUrl: `https://unsplash.com/@${photo.user.username}`,
                },
            }));
            return createSuccessResponse({
                messages: [
                    `Found ${data.total} photos for "${query}" (showing ${results.length})`,
                ],
                dataItem: {
                    total: data.total,
                    totalPages: data.total_pages,
                    results,
                },
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "search_unsplash" });
        }
    });
    // Insert image from URL into Figma
    server.tool("insert_image", "Download an image from a URL and insert it into the current Figma slide as a rectangle with image fill. Works with any image URL (Unsplash, direct links, etc.). Use search_unsplash first to find photos, then insert_image with the returned URL. IMPORTANT: When inserting Unsplash images, you MUST pass the photographer name and username from search_unsplash results to comply with Unsplash attribution requirements.", {
        url: z.string().url().describe("Image URL to download and insert"),
        x: z.number().optional().describe("X coordinate (default: 0)"),
        y: z.number().optional().describe("Y coordinate (default: 0)"),
        width: z.number().optional().describe("Display width in pixels"),
        height: z
            .number()
            .optional()
            .describe("Display height in pixels (auto-calculated from aspect ratio if omitted)"),
        originalWidth: z
            .number()
            .optional()
            .describe("Original image width for aspect ratio calculation"),
        originalHeight: z
            .number()
            .optional()
            .describe("Original image height for aspect ratio calculation"),
        name: z.string().optional().describe("Name for the image node"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        photographerName: z
            .string()
            .optional()
            .describe("Photographer's display name (from search_unsplash results). Required for Unsplash attribution."),
        photographerUsername: z
            .string()
            .optional()
            .describe("Photographer's Unsplash username (from search_unsplash results). Required for Unsplash attribution."),
    }, async (params) => {
        try {
            const { url, ...rest } = params;
            // Download image
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString("base64");
            // Send to Figma plugin
            const result = await sendCommandToFigma("insert_image", {
                imageBase64: base64,
                ...rest,
            });
            return createSuccessResponse({
                messages: [
                    `Inserted image "${result.name}" (${result.id}) - ${result.width}x${result.height}`,
                    ...(result.attribution
                        ? [`Attribution: ${result.attribution}`]
                        : []),
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "insert_image" });
        }
    });
}
