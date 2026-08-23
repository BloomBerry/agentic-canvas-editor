// Slide Management Handlers
import { lookupNode, nodeIdMap } from "../bridge";

// When ported from Figma Slides → Figma Design, SLIDE becomes FRAME.
// Accept both types as valid "slide" nodes.
const SLIDE_TYPES = new Set(["SLIDE", "FRAME"]);

// Direct getNodeByIdAsync, with sourceId tree-scan fallback (lookupNode).
async function getSlideNode(slideId: string): Promise<SlideNode> {
  const node = await lookupNode(slideId);
  if (!node) {
    throw new Error(`Node not found: ${slideId}`);
  }
  if (!SLIDE_TYPES.has(node.type)) {
    throw new Error(`Node is not a slide: ${slideId} (type: ${node.type})`);
  }
  return node as unknown as SlideNode;
}

export async function createSlide(params: {
  row?: number;
  column?: number;
  name?: string;
}) {
  try {
    const slide = figma.createSlide();

    if (params.name) {
      slide.name = params.name;
    }

    // Position the slide at the requested index (column) using insertChild.
    // figma.createSlide() always appends to the end, so we move it afterward.
    // column = -1 (or omitted) → keep at end (default behavior).
    if (params.column != null && params.column !== -1) {
      const parent = slide.parent;
      if (parent && "insertChild" in parent) {
        (parent as any).insertChild(params.column, slide);
      }
    }

    // Auto-focus the newly created slide so that subsequent element creation
    // (without explicit parentId) targets this slide instead of a stale one.
    try {
      if (figma.currentPage) {
        (figma.currentPage as any).focusedSlide = slide;
      }
    } catch {
      // focusedSlide assignment can throw on slides with variable bindings; ignore.
    }

    return {
      id: slide.id,
      name: slide.name,
      type: slide.type,
    };
  } catch (error) {
    throw new Error(`Failed to create slide: ${error}`);
  }
}

export async function deleteSlide(params: { slideId: string }) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Collect all descendant IDs before removal so we can purge nodeIdMap
    const idsToRemove = new Set<string>();
    function collectIds(node: BaseNode) {
      idsToRemove.add(node.id);
      if ("children" in node) {
        for (const child of (node as any).children) {
          collectIds(child);
        }
      }
    }
    collectIds(slide);

    slide.remove();

    // Purge stale entries from nodeIdMap (both key and value sides)
    for (const [origId, mappedId] of nodeIdMap.entries()) {
      if (idsToRemove.has(mappedId) || idsToRemove.has(origId)) {
        nodeIdMap.delete(origId);
      }
    }

    return { success: true, slideId: params.slideId };
  } catch (error) {
    throw new Error(`Failed to delete slide: ${error}`);
  }
}

export async function cloneSlide(params: { slideId: string; name?: string }) {
  try {
    const slide = await getSlideNode(params.slideId);

    const clonedSlide = slide.clone();

    if (params.name) {
      clonedSlide.name = params.name;
    }

    return {
      id: clonedSlide.id,
      name: clonedSlide.name,
      type: clonedSlide.type,
    };
  } catch (error) {
    throw new Error(`Failed to clone slide: ${error}`);
  }
}

export async function focusSlide(params: { slideId: string }) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Set the focused slide (may fail on slides with bound Variables)
    try {
      if (figma.currentPage) {
        (figma.currentPage as any).focusedSlide = slide;
      }
    } catch {
      // focusedSlide assignment can throw "unsupported type in createVMObject:
      // VARIABLE" when the slide contains design-token variable bindings.
    }

    // Also zoom to the slide — wrap because scrollAndZoomIntoView reads node
    // bounds which itself can hit the VARIABLE error on bound slides. Focus
    // succeeds visually if the assignment above worked; viewport zoom is
    // best-effort eye candy and not worth failing the whole command for.
    try {
      figma.viewport.scrollAndZoomIntoView([slide]);
    } catch {}

    return {
      id: slide.id,
      name: slide.name,
      focused: true,
    };
  } catch (error) {
    throw new Error(`Failed to focus slide: ${error}`);
  }
}

export async function getFocusedSlide() {
  try {
    const focusedSlide = (figma.currentPage as any).focusedSlide as SlideNode | null;

    if (!focusedSlide) {
      return null;
    }

    return {
      id: focusedSlide.id,
      name: focusedSlide.name,
      type: focusedSlide.type,
    };
  } catch (error) {
    throw new Error(`Failed to get focused slide: ${error}`);
  }
}

export async function getSlideGrid() {
  try {
    // Get all slides in the current page
    const slides: SlideNode[] = [];

    function findSlides(node: BaseNode) {
      if (node.type === "SLIDE") {
        slides.push(node as SlideNode);
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
  } catch (error) {
    throw new Error(`Failed to get slide grid: ${error}`);
  }
}

export async function getAllSlides() {
  try {
    const slides: SlideNode[] = [];

    function findSlides(node: BaseNode) {
      if (node.type === "SLIDE") {
        slides.push(node as SlideNode);
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
  } catch (error) {
    throw new Error(`Failed to get all slides: ${error}`);
  }
}

export async function reorderSlides(params: { slideIds: string[] }) {
  try {
    // Resolve all slide nodes first (validates they exist)
    const slides: SlideNode[] = [];
    for (const sid of params.slideIds) {
      slides.push(await getSlideNode(sid));
    }

    if (slides.length === 0) {
      throw new Error("slideIds array is empty");
    }

    // All slides must share the same parent (Section or Page)
    const parent = slides[0].parent;
    if (!parent || !("insertChild" in parent)) {
      throw new Error("Slide parent does not support insertChild");
    }

    // Re-insert slides in the requested order.
    // insertChild(index, node) moves an existing child to a new position.
    for (let i = 0; i < slides.length; i++) {
      (parent as any).insertChild(i, slides[i]);
    }

    return {
      success: true,
      order: slides.map((s) => ({ id: s.id, name: s.name })),
    };
  } catch (error) {
    throw new Error(`Failed to reorder slides: ${error}`);
  }
}

export async function setSlideTransition(params: {
  slideId: string;
  transitionStyle: string;
  direction?: string;
  duration?: number;
  curve?: string;
  timing?: string;
  delay?: number;
}) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Build the full transition style name
    let fullStyle = params.transitionStyle;
    const direction = params.direction || "LEFT";

    // Direction-based transitions need to be converted to full style names
    const directionMap: Record<string, Record<string, string>> = {
      PUSH: {
        LEFT: "PUSH_FROM_LEFT",
        RIGHT: "PUSH_FROM_RIGHT",
        TOP: "PUSH_FROM_TOP",
        BOTTOM: "PUSH_FROM_BOTTOM",
      },
      SLIDE_IN: {
        LEFT: "SLIDE_FROM_LEFT",
        RIGHT: "SLIDE_FROM_RIGHT",
        TOP: "SLIDE_FROM_TOP",
        BOTTOM: "SLIDE_FROM_BOTTOM",
      },
      SLIDE_OUT: {
        LEFT: "SLIDE_OUT_TO_LEFT",
        RIGHT: "SLIDE_OUT_TO_RIGHT",
        TOP: "SLIDE_OUT_TO_TOP",
        BOTTOM: "SLIDE_OUT_TO_BOTTOM",
      },
      MOVE_IN: {
        LEFT: "MOVE_FROM_LEFT",
        RIGHT: "MOVE_FROM_RIGHT",
        TOP: "MOVE_FROM_TOP",
        BOTTOM: "MOVE_FROM_BOTTOM",
      },
      MOVE_OUT: {
        LEFT: "MOVE_OUT_TO_LEFT",
        RIGHT: "MOVE_OUT_TO_RIGHT",
        TOP: "MOVE_OUT_TO_TOP",
        BOTTOM: "MOVE_OUT_TO_BOTTOM",
      },
    };

    if (directionMap[params.transitionStyle]) {
      fullStyle = directionMap[params.transitionStyle][direction] || params.transitionStyle;
    }

    // Build timing object
    const timingType = (params.timing || "ON_CLICK") as "ON_CLICK" | "AFTER_DELAY";
    const timing: SlideTransition["timing"] = {
      type: timingType,
      ...(timingType === "AFTER_DELAY" && params.delay ? { delay: params.delay / 1000 } : {}),
    };

    // Set slide transition
    const transition = {
      style: fullStyle,
      duration: (params.duration || 300) / 1000, // Convert ms to seconds
      curve: (params.curve || "EASE_OUT") as SlideTransition["curve"],
      timing,
    } as SlideTransition;

    slide.setSlideTransition(transition);

    return {
      id: slide.id,
      transition,
    };
  } catch (error) {
    throw new Error(`Failed to set slide transition: ${error}`);
  }
}

export async function skipSlide(params: { slideId: string; skip: boolean }) {
  try {
    const slide = await getSlideNode(params.slideId);

    slide.isSkippedSlide = params.skip;

    return {
      id: slide.id,
      isSkipped: slide.isSkippedSlide,
    };
  } catch (error) {
    throw new Error(`Failed to set slide skip status: ${error}`);
  }
}

// Explore all properties of a SlideNode (including undocumented ones)
export async function getSlideProperties(params: { slideId: string }) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Known SlideNode properties to check
    const knownProperties = [
      // Basic node properties
      "id", "name", "type", "visible", "locked", "opacity",
      "x", "y", "width", "height", "rotation",
      // SlideNode specific
      "isSkippedSlide",
      // Frame-like properties
      "fills", "strokes", "strokeWeight", "cornerRadius",
      "layoutMode", "primaryAxisSizingMode", "counterAxisSizingMode",
      "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
      "itemSpacing", "counterAxisSpacing",
      "clipsContent", "guides", "layoutGrids",
      // Children
      "children", "parent",
      // Potential note properties
      "speakerNotes", "presenterNotes", "notes", "slideNotes",
      "speakerNote", "presenterNote", "note", "slideNote",
      "annotations", "comments", "description",
      // Methods
      "getSlideTransition", "setSlideTransition", "clone",
    ];

    const allProperties: Record<string, any> = {};

    // Safely check each known property
    for (const propName of knownProperties) {
      try {
        const value = (slide as any)[propName];
        if (value === undefined) {
          allProperties[propName] = "undefined";
        } else if (value === null) {
          allProperties[propName] = "null";
        } else if (typeof value === "function") {
          allProperties[propName] = "[Function]";
        } else if (typeof value === "symbol") {
          allProperties[propName] = "[Symbol]";
        } else if (typeof value === "object") {
          if (Array.isArray(value)) {
            allProperties[propName] = `[Array(${value.length})]`;
          } else {
            allProperties[propName] = "[Object]";
          }
        } else {
          allProperties[propName] = value;
        }
      } catch (e) {
        allProperties[propName] = `[Error]`;
      }
    }

    // Note-related properties to specifically check
    const potentialNoteProperties = [
      "speakerNotes", "presenterNotes", "notes", "slideNotes",
      "speakerNote", "presenterNote", "note", "slideNote",
      "annotations", "comments", "description",
    ];

    const noteProperties: Record<string, any> = {};
    for (const propName of potentialNoteProperties) {
      try {
        const value = (slide as any)[propName];
        if (value !== undefined && value !== null && typeof value !== "symbol") {
          if (typeof value === "string" || typeof value === "object") {
            noteProperties[propName] = value;
          }
        }
      } catch (e) {
        // Property doesn't exist or can't be accessed
      }
    }

    // Get slide transition info
    let transitionInfo = null;
    try {
      transitionInfo = slide.getSlideTransition();
    } catch (e) {
      // Ignore
    }

    return {
      id: slide.id,
      name: slide.name,
      type: slide.type,
      propertyCount: Object.keys(allProperties).filter(k => allProperties[k] !== "undefined").length,
      properties: allProperties,
      noteRelatedProperties: noteProperties,
      hasNoteProperties: Object.keys(noteProperties).length > 0,
      transition: transitionInfo,
      isSkipped: slide.isSkippedSlide,
    };
  } catch (error) {
    throw new Error(`Failed to get slide properties: ${error}`);
  }
}

// Get speaker notes for a slide (if available)
export async function getSlideSpeakerNotes(params: { slideId: string }) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Try various possible property names for speaker notes
    const possibleProps = [
      "speakerNotes",
      "presenterNotes",
      "notes",
      "slideNotes",
      "speakerNote",
      "presenterNote",
      "note",
      "slideNote",
    ];

    for (const propName of possibleProps) {
      try {
        const value = (slide as any)[propName];
        if (value !== undefined && value !== null) {
          return {
            id: slide.id,
            name: slide.name,
            propertyName: propName,
            speakerNotes: value,
            available: true,
          };
        }
      } catch (e) {
        // Continue to next property
      }
    }

    return {
      id: slide.id,
      name: slide.name,
      speakerNotes: null,
      available: false,
      message: "Speaker notes are not available through the Figma Plugin API",
    };
  } catch (error) {
    throw new Error(`Failed to get speaker notes: ${error}`);
  }
}

// Set speaker notes for a slide (if available)
export async function setSlideSpeakerNotes(params: {
  slideId: string;
  notes: string;
}) {
  try {
    const slide = await getSlideNode(params.slideId);

    // Try various possible property names for speaker notes
    const possibleProps = [
      "speakerNotes",
      "presenterNotes",
      "notes",
      "slideNotes",
      "speakerNote",
      "presenterNote",
      "note",
      "slideNote",
    ];

    for (const propName of possibleProps) {
      try {
        // Check if property exists and is writable
        const descriptor = Object.getOwnPropertyDescriptor(slide, propName);
        if (descriptor && descriptor.writable !== false) {
          (slide as any)[propName] = params.notes;
          return {
            id: slide.id,
            name: slide.name,
            propertyName: propName,
            speakerNotes: params.notes,
            success: true,
          };
        }

        // Try setting anyway
        (slide as any)[propName] = params.notes;
        const value = (slide as any)[propName];
        if (value === params.notes) {
          return {
            id: slide.id,
            name: slide.name,
            propertyName: propName,
            speakerNotes: params.notes,
            success: true,
          };
        }
      } catch (e) {
        // Continue to next property
      }
    }

    return {
      id: slide.id,
      name: slide.name,
      success: false,
      message: "Setting speaker notes is not available through the Figma Plugin API",
    };
  } catch (error) {
    throw new Error(`Failed to set speaker notes: ${error}`);
  }
}
