// Content Creation and Manipulation Handlers
// Helper function to get the current context (focused slide or page)
function getCurrentParent() {
    const focusedSlide = figma.currentPage.focusedSlide;
    return focusedSlide || figma.currentPage;
}
// Helper function to get node by ID
function getNode(nodeId) {
    const node = figma.getNodeById(nodeId);
    if (!node || !("id" in node)) {
        throw new Error(`Node not found: ${nodeId}`);
    }
    return node;
}
export async function createRectangle(params) {
    const rect = figma.createRectangle();
    rect.x = params.x;
    rect.y = params.y;
    rect.resize(params.width, params.height);
    if (params.name)
        rect.name = params.name;
    if (params.fillColor) {
        rect.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.fillColor.r,
                    g: params.fillColor.g,
                    b: params.fillColor.b,
                },
                opacity: params.fillColor.a ?? 1,
            },
        ];
    }
    if (params.strokeColor && params.strokeWeight) {
        rect.strokes = [
            {
                type: "SOLID",
                color: {
                    r: params.strokeColor.r,
                    g: params.strokeColor.g,
                    b: params.strokeColor.b,
                },
                opacity: params.strokeColor.a ?? 1,
            },
        ];
        rect.strokeWeight = params.strokeWeight;
    }
    if (params.cornerRadius) {
        rect.cornerRadius = params.cornerRadius;
    }
    const parent = params.parentId
        ? figma.getNodeById(params.parentId)
        : getCurrentParent();
    if (parent && "appendChild" in parent) {
        parent.appendChild(rect);
    }
    return { id: rect.id, name: rect.name, type: rect.type };
}
export async function createFrame(params) {
    const frame = figma.createFrame();
    frame.x = params.x;
    frame.y = params.y;
    frame.resize(params.width, params.height);
    if (params.name)
        frame.name = params.name;
    if (params.fillColor) {
        frame.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.fillColor.r,
                    g: params.fillColor.g,
                    b: params.fillColor.b,
                },
                opacity: params.fillColor.a ?? 1,
            },
        ];
    }
    const parent = params.parentId
        ? figma.getNodeById(params.parentId)
        : getCurrentParent();
    if (parent && "appendChild" in parent) {
        parent.appendChild(frame);
    }
    return { id: frame.id, name: frame.name, type: frame.type };
}
export async function createText(params) {
    const textNode = figma.createText();
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    textNode.x = params.x;
    textNode.y = params.y;
    textNode.characters = params.text;
    if (params.name)
        textNode.name = params.name;
    if (params.fontSize) {
        textNode.fontSize = params.fontSize;
    }
    if (params.fontColor) {
        textNode.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.fontColor.r,
                    g: params.fontColor.g,
                    b: params.fontColor.b,
                },
                opacity: params.fontColor.a ?? 1,
            },
        ];
    }
    if (params.textAlign) {
        textNode.textAlignHorizontal = params.textAlign;
    }
    const parent = params.parentId
        ? figma.getNodeById(params.parentId)
        : getCurrentParent();
    if (parent && "appendChild" in parent) {
        parent.appendChild(textNode);
    }
    return { id: textNode.id, name: textNode.name, type: textNode.type };
}
export async function createEllipse(params) {
    const ellipse = figma.createEllipse();
    ellipse.x = params.x;
    ellipse.y = params.y;
    ellipse.resize(params.width, params.height);
    if (params.name)
        ellipse.name = params.name;
    if (params.fillColor) {
        ellipse.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.fillColor.r,
                    g: params.fillColor.g,
                    b: params.fillColor.b,
                },
                opacity: params.fillColor.a ?? 1,
            },
        ];
    }
    const parent = params.parentId
        ? figma.getNodeById(params.parentId)
        : getCurrentParent();
    if (parent && "appendChild" in parent) {
        parent.appendChild(ellipse);
    }
    return { id: ellipse.id, name: ellipse.name, type: ellipse.type };
}
export async function createGraphic(params) {
    const node = figma.createNodeFromSvg(params.svg);
    node.x = params.x;
    node.y = params.y;
    if (params.name)
        node.name = params.name;
    const parent = params.parentId
        ? figma.getNodeById(params.parentId)
        : getCurrentParent();
    if (parent && "appendChild" in parent) {
        parent.appendChild(node);
    }
    return { id: node.id, name: node.name, type: node.type };
}
export async function moveNode(params) {
    const node = getNode(params.nodeId);
    node.x = params.x;
    node.y = params.y;
    return { id: node.id, x: node.x, y: node.y };
}
export async function resizeNode(params) {
    const node = getNode(params.nodeId);
    if ("resize" in node) {
        node.resize(params.width, params.height);
    }
    return { id: node.id, width: node.width, height: node.height };
}
export async function deleteNode(params) {
    const node = getNode(params.nodeId);
    node.remove();
    return { success: true, nodeId: params.nodeId };
}
export async function cloneNode(params) {
    const node = getNode(params.nodeId);
    const cloned = node.clone();
    if (params.offsetX)
        cloned.x += params.offsetX;
    if (params.offsetY)
        cloned.y += params.offsetY;
    return { id: cloned.id, name: cloned.name, type: cloned.type };
}
export async function groupNodes(params) {
    const nodes = params.nodeIds.map((id) => getNode(id));
    const group = figma.group(nodes, getCurrentParent());
    if (params.groupName) {
        group.name = params.groupName;
    }
    return { id: group.id, name: group.name, type: group.type };
}
export async function ungroupNodes(params) {
    const group = getNode(params.groupId);
    if (group.type !== "GROUP") {
        throw new Error("Node is not a group");
    }
    figma.ungroup(group);
    return { success: true };
}
export async function setFillColor(params) {
    const node = getNode(params.nodeId);
    if ("fills" in node) {
        node.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.color.r,
                    g: params.color.g,
                    b: params.color.b,
                },
                opacity: params.color.a ?? 1,
            },
        ];
    }
    return { id: node.id };
}
export async function setStroke(params) {
    const node = getNode(params.nodeId);
    if ("strokes" in node && "strokeWeight" in node) {
        node.strokes = [
            {
                type: "SOLID",
                color: {
                    r: params.color.r,
                    g: params.color.g,
                    b: params.color.b,
                },
                opacity: params.color.a ?? 1,
            },
        ];
        if (params.weight) {
            node.strokeWeight = params.weight;
        }
    }
    return { id: node.id };
}
export async function setOpacity(params) {
    const node = getNode(params.nodeId);
    if ("opacity" in node) {
        node.opacity = params.opacity;
    }
    return { id: node.id, opacity: "opacity" in node ? node.opacity : undefined };
}
export async function setCornerRadius(params) {
    const node = getNode(params.nodeId);
    if ("cornerRadius" in node && node.type === "RECTANGLE") {
        node.cornerRadius = params.radius;
    }
    else if ("cornerRadius" in node && node.type === "FRAME") {
        node.cornerRadius = params.radius;
    }
    return { id: node.id };
}
export async function setTextContent(params) {
    const node = getNode(params.nodeId);
    if (node.type !== "TEXT") {
        throw new Error("Node is not a text node");
    }
    const textNode = node;
    await figma.loadFontAsync(textNode.fontName);
    textNode.characters = params.text;
    return { id: textNode.id, text: textNode.characters };
}
export async function setTextProperties(params) {
    const node = getNode(params.nodeId);
    if (node.type !== "TEXT") {
        throw new Error("Node is not a text node");
    }
    const textNode = node;
    await figma.loadFontAsync(textNode.fontName);
    if (params.fontSize) {
        textNode.fontSize = params.fontSize;
    }
    if (params.fontColor) {
        textNode.fills = [
            {
                type: "SOLID",
                color: {
                    r: params.fontColor.r,
                    g: params.fontColor.g,
                    b: params.fontColor.b,
                },
                opacity: params.fontColor.a ?? 1,
            },
        ];
    }
    if (params.textAlign) {
        textNode.textAlignHorizontal = params.textAlign;
    }
    return { id: textNode.id };
}
export async function getPageInfo() {
    const page = figma.currentPage;
    return {
        id: page.id,
        name: page.name,
        type: page.type,
        children: page.children.map((child) => ({
            id: child.id,
            name: child.name,
            type: child.type,
        })),
    };
}
export async function getNodeInfo(params) {
    const node = getNode(params.nodeId);
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
    };
}
export async function getSelectionInfo() {
    const selection = figma.currentPage.selection;
    return {
        nodes: selection.map((node) => ({
            id: node.id,
            name: node.name,
            type: node.type,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
        })),
    };
}
