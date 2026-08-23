// Slide Management Handlers
export async function createSlide(params) {
    try {
        const slide = figma.createSlide();
        if (params.name) {
            slide.name = params.name;
        }
        // TODO: Implement row/column positioning using SlideGridNode API
        // This would require accessing the slide grid and manipulating slide rows
        return {
            id: slide.id,
            name: slide.name,
            type: slide.type,
        };
    }
    catch (error) {
        throw new Error(`Failed to create slide: ${error}`);
    }
}
export async function deleteSlide(params) {
    try {
        const slide = figma.getNodeById(params.slideId);
        if (!slide || slide.type !== "SLIDE") {
            throw new Error("Node is not a slide");
        }
        slide.remove();
        return { success: true, slideId: params.slideId };
    }
    catch (error) {
        throw new Error(`Failed to delete slide: ${error}`);
    }
}
export async function cloneSlide(params) {
    try {
        const slide = figma.getNodeById(params.slideId);
        if (!slide || slide.type !== "SLIDE") {
            throw new Error("Node is not a slide");
        }
        const clonedSlide = slide.clone();
        if (params.name) {
            clonedSlide.name = params.name;
        }
        return {
            id: clonedSlide.id,
            name: clonedSlide.name,
            type: clonedSlide.type,
        };
    }
    catch (error) {
        throw new Error(`Failed to clone slide: ${error}`);
    }
}
export async function focusSlide(params) {
    try {
        const slide = figma.getNodeById(params.slideId);
        if (!slide || slide.type !== "SLIDE") {
            throw new Error("Node is not a slide");
        }
        // Set the focused slide
        if (figma.currentPage) {
            figma.currentPage.focusedSlide = slide;
        }
        // Also zoom to the slide
        figma.viewport.scrollAndZoomIntoView([slide]);
        return {
            id: slide.id,
            name: slide.name,
            focused: true,
        };
    }
    catch (error) {
        throw new Error(`Failed to focus slide: ${error}`);
    }
}
export async function getFocusedSlide() {
    try {
        const focusedSlide = figma.currentPage.focusedSlide;
        if (!focusedSlide) {
            return null;
        }
        return {
            id: focusedSlide.id,
            name: focusedSlide.name,
            type: focusedSlide.type,
        };
    }
    catch (error) {
        throw new Error(`Failed to get focused slide: ${error}`);
    }
}
export async function getSlideGrid() {
    try {
        // Get all slides in the current page
        const slides = [];
        function findSlides(node) {
            if (node.type === "SLIDE") {
                slides.push(node);
            }
            if ("children" in node) {
                for (const child of node.children) {
                    findSlides(child);
                }
            }
        }
        findSlides(figma.currentPage);
        // Organize slides by rows (simplified version)
        // In reality, you would need to access SlideGridNode and SlideRowNode
        return {
            rows: [
                {
                    slides: slides.map((slide) => ({
                        id: slide.id,
                        name: slide.name,
                        type: slide.type,
                    })),
                },
            ],
        };
    }
    catch (error) {
        throw new Error(`Failed to get slide grid: ${error}`);
    }
}
export async function getAllSlides() {
    try {
        const slides = [];
        function findSlides(node) {
            if (node.type === "SLIDE") {
                slides.push(node);
            }
            if ("children" in node) {
                for (const child of node.children) {
                    findSlides(child);
                }
            }
        }
        findSlides(figma.currentPage);
        return {
            slides: slides.map((slide) => ({
                id: slide.id,
                name: slide.name,
                type: slide.type,
            })),
        };
    }
    catch (error) {
        throw new Error(`Failed to get all slides: ${error}`);
    }
}
export async function setSlideTransition(params) {
    try {
        const slide = figma.getNodeById(params.slideId);
        if (!slide || slide.type !== "SLIDE") {
            throw new Error("Node is not a slide");
        }
        // Set slide transition
        const transition = {
            style: params.transitionStyle,
            duration: (params.duration || 300) / 1000, // Convert ms to seconds
            curve: (params.easing || "EASE_OUT"),
        };
        slide.setSlideTransition(transition);
        return {
            id: slide.id,
            transition,
        };
    }
    catch (error) {
        throw new Error(`Failed to set slide transition: ${error}`);
    }
}
export async function skipSlide(params) {
    try {
        const slide = figma.getNodeById(params.slideId);
        if (!slide || slide.type !== "SLIDE") {
            throw new Error("Node is not a slide");
        }
        slide.isSkippedSlide = params.skip;
        return {
            id: slide.id,
            isSkipped: slide.isSkippedSlide,
        };
    }
    catch (error) {
        throw new Error(`Failed to set slide skip status: ${error}`);
    }
}
