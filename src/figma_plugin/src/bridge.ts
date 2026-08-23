// @ts-nocheck
// Figma runtime objects use dynamic shapes not fully covered by typings.

type FetchedNode = Record<string, any>;
type XYWH = { x: number; y: number; width: number; height: number };

/**
 * Global mapping of old (JSON source) node IDs → new (live Figma) node IDs.
 * Populated during createNode and cleared at the start of each import.
 */
export const nodeIdMap: Map<string, string> = new Map();

// Find a node on the current page whose `sourceId` pluginData equals the
// given id. Used as a fallback when agents pass the original source id
// (from the input JSON / get_slide_grid response) but the live node has a
// different id after Figma's post-import stabilization. The sourceId is
// set on every imported node by createNode() / importJson() — that's why
// this works even after nodeIdMap is no longer consulted on lookup.
export async function findNodeBySourceId(id: string): Promise<BaseNode | null> {
  function walk(node: BaseNode): BaseNode | null {
    try {
      const sid = (node as any).getPluginData?.("sourceId");
      if (sid === id) return node;
    } catch {}
    if ("children" in node && Array.isArray((node as any).children)) {
      for (const child of (node as any).children) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  }
  for (const c of figma.currentPage.children) {
    const found = walk(c);
    if (found) return found;
  }
  return null;
}

// Direct getNodeByIdAsync + sourceId tree-scan fallback. Preferred over
// raw getNodeByIdAsync at handler boundaries so agents passing the
// original input id (the export_json output is keyed by sourceId) don't
// hit "Node not found" every time Figma reassigns a live id.
export async function lookupNode(id: string): Promise<BaseNode | null> {
  const direct = await figma.getNodeByIdAsync(id);
  if (direct) return direct;
  return await findNodeBySourceId(id);
}

/**
 * Global mapping of imageRef → new imageHash after figma.createImage().
 * Populated during importJson when imageData is provided, cleared each import.
 */
export const imageHashMap: Map<string, string> = new Map();
export const imagePaintStats = { total: 0, resolved: 0, unresolved: 0, refs: [] as string[] };

/**
 * Collects detailed import logs so they can be returned in the import_json response.
 * Cleared at the start of each import via resetImportLogs().
 */
export const importLogs: string[] = [];
export function resetImportLogs() { importLogs.length = 0; }
export function _ilog(msg: string) {
  importLogs.push(msg);
  console.log(msg);
}
function clone(val) {
  return JSON.parse(JSON.stringify(val));
}

function det3(m: Mat3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}


function inv3(m: Mat3): Mat3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = det3(m);
  if (Math.abs(det) < 1e-8) return null;

  const invDet = 1 / det;
  return [
    [
      (e * i - f * h) * invDet,
      (c * h - b * i) * invDet,
      (b * f - c * e) * invDet,
    ],
    [
      (f * g - d * i) * invDet,
      (a * i - c * g) * invDet,
      (c * d - a * f) * invDet,
    ],
    [
      (d * h - e * g) * invDet,
      (b * g - a * h) * invDet,
      (a * e - b * d) * invDet,
    ],
  ];
}


function mul3(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return r;
}
type Transform = [[number, number, number], [number, number, number]];
const IDENTITY_HANDLES: Mat3 = [
  [0, 1, 0],
  [0.5, 0.5, 1],
  [1, 1, 1],
];

function handlesToTransform(h: Vector[]): Transform {
  const D: Mat3 = [
    [h[0].x, h[1].x, h[2].x],
    [h[0].y, h[1].y, h[2].y],
    [1, 1, 1],
  ];

  const invD = inv3(D) ?? IDENTITY_HANDLES;
  const M = mul3(IDENTITY_HANDLES, invD);
  return [M[0] as any, M[1] as any];
}

function sanitisePathData(path: string): string {
  return (
    path
      .replace(/([MLHVCSQTAZmlhvcsqtaz])(?=[^\s,])/g, '$1 ')
      .replace(/([^\s,])([MLHVCSQTAZmlhvcsqtaz])/g, '$1 $2')
      .replace(/([0-9.])(-)/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function degFromMatrix(t: Transform): number {
  const [[a, b], [c, d]] = t;
  const radians = Math.atan2(c, a);
  return (radians * 180) / Math.PI;
}


function deltaDeg(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360) - 180);
}

export function tideFloat(n: number, eps = 1e-6): number {
  return Math.abs(n) < eps ? 0 : Number(n.toFixed(6));
}

function wantsAbsolute(staticNode: FetchedNode): boolean {
  return (
    (staticNode as any).layoutPositioning === 'ABSOLUTE' ||
    (staticNode as any).ignoreAutoLayout === true
  );
}

function finaliseAbsolutePositioning(
  liveChild: SceneNode,
  staticChild: FetchedNode,
  liveParent: SceneNode & ChildrenMixin
) {
  try {
    if (
      !wantsAbsolute(staticChild) ||
      !('layoutMode' in liveParent) ||
      liveParent.layoutMode === 'NONE' ||
      !('layoutPositioning' in liveChild)
    ) {
      return;
    }

    if ('layoutPositioning' in liveChild) {
      (liveChild as any).layoutPositioning = 'ABSOLUTE';
    }

    if (
      Array.isArray(staticChild.relativeTransform) &&
      staticChild.relativeTransform.length === 2
    ) {
      const T = staticChild.relativeTransform as Transform;
      liveChild.x = T[0][2];
      liveChild.y = T[1][2];
    } else if (staticChild.absoluteBoundingBox) {
      const { x, y } = staticChild.absoluteBoundingBox as XYWH;
      liveChild.x = x - liveParent.x;
      liveChild.y = y - liveParent.y;
    }
  } catch (err) {
    console.warn('finaliseAbsolutePositioning →', err);
  }
}

/**
 * Apply FILL sizing to a child node AFTER it has been appended to its
 * auto-layout parent.  Figma requires the node to already be inside an
 * auto-layout container before layoutSizingHorizontal/Vertical can be
 * set to 'FILL'.
 */
function finaliseLayoutSizing(
  liveChild: SceneNode,
  staticChild: FetchedNode
) {
  try {
    if (
      staticChild.layoutSizingHorizontal === 'FILL' &&
      'layoutSizingHorizontal' in liveChild
    ) {
      (liveChild as any).layoutSizingHorizontal = 'FILL';
    }
    if (
      staticChild.layoutSizingVertical === 'FILL' &&
      'layoutSizingVertical' in liveChild
    ) {
      (liveChild as any).layoutSizingVertical = 'FILL';
    }
  } catch (err) {
    console.warn('finaliseLayoutSizing →', err);
  }
}

export function formatPaint(p: any): Paint | undefined {
  if (!p?.type) return;

  const rgb = ({ r, g, b }: any): RGB => ({ r, g, b });
  const rgba = ({ r, g, b, a }: any): RGBA => ({ r, g, b, a: a ?? 1 });

  switch (p.type) {

    case 'SOLID': {
      if (!p.color) return;
      return {
        type: 'SOLID',
        color: rgb(p.color),
        opacity: p.opacity ?? p.color.a ?? 1,
        visible: p.visible ?? true,
        blendMode: p.blendMode,
      };
    }


    case 'IMAGE': {
      const origRef = p.imageHash ?? p.imageRef;
      if (!origRef) return;
      imagePaintStats.total++;
      const inMap = imageHashMap.has(origRef);
      const resolvedHash = inMap ? imageHashMap.get(origRef)! : origRef;
      if (inMap) {
        imagePaintStats.resolved++;
      } else {
        imagePaintStats.unresolved++;
      }

      // Map scaleMode: REST API 'STRETCH' → Plugin API 'CROP'
      // Preserve the original imageTransform so crop/pan is maintained.
      // Only fall back to identity when the source has no transform at all.
      let scaleMode: string = p.scaleMode ?? 'FILL';
      let imgTransform = p.imageTransform ?? [[1, 0, 0], [0, 1, 0]];
      if (!['FILL', 'FIT', 'CROP', 'TILE'].includes(scaleMode)) {
        scaleMode = 'CROP';
        // Keep the original imageTransform (already set above);
        // only use identity if there was no transform in the source.
      }

      return {
        type: 'IMAGE',
        imageHash: resolvedHash,
        scaleMode,
        imageTransform: imgTransform,
        opacity: p.opacity ?? 1,
        visible: p.visible ?? true,
      };
    }


    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND': {
      if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2) return;

      const transform: Transform =
        p.gradientTransform ??
        (Array.isArray(p.gradientHandlePositions) &&
        p.gradientHandlePositions.length === 3
          ? handlesToTransform(p.gradientHandlePositions)
          : [
              [1, 0, 0],
              [0, 1, 0],
            ]);

      return {
        type: p.type,
        gradientTransform: transform,
        gradientStops: p.gradientStops.map((s: any) => ({
          position: s.position,
          color: rgba(s.color),
        })),
        opacity: p.opacity ?? 1,
        visible: p.visible ?? true,
        blendMode: p.blendMode,
      };
    }
  }
}

const assignPaints = (
  key: 'fills' | 'strokes',
  target: GeometryMixin,
  source: any
) => {
  if (!(key in source && key in target)) return;

  const rawArr = source[key] as any[];

  if (rawArr.length === 0) {
    (target as any)[key] = [];
    return;
  }

  const paints = rawArr
    .map(formatPaint)
    .filter((p): p is Paint => p !== undefined);

  const hasImage = paints.some((p: any) => p.type === 'IMAGE');
  try {
    (target as any)[key] = paints;
    // Verify IMAGE fills were actually applied
    if (hasImage) {
      const readBack = (target as any)[key] as Paint[];
      const imgAfter = readBack?.filter?.((p: any) => p.type === 'IMAGE') ?? [];
      if (imgAfter.length === 0) {
        imagePaintStats.refs.push(`VERIFY_FAIL:set_ok_but_readback_no_image`);
      } else {
        imagePaintStats.refs.push(`VERIFY_OK:${imgAfter.length}_images_in_fills`);
      }
    }
  } catch (err) {
    if (hasImage) {
      imagePaintStats.refs.push(`ASSIGN_ERR:${err instanceof Error ? err.message : String(err)}`);
    }
  }
};


export async function createNode(
  staticNode: FetchedNode,
  parentNode: BaseNode & ChildrenMixin,
  staticParentNode: FetchedNode
): Promise<SceneNode | null> {
  const liveNode = await instantiateNode(staticNode);
  if (!liveNode) return null;

  try {
    // Track old→new ID mapping for subsequent commands
    if (staticNode.id) {
      nodeIdMap.set(staticNode.id, liveNode.id);
      // Persist input id as sourceId on the live node so export can report
      // the same id that was imported (stable identity across import sessions).
      try { (liveNode as any).setPluginData("sourceId", String(staticNode.id)); } catch {}
    }

    const _nodeLabel = `"${(staticNode.name ?? staticNode.type).slice(0, 50)}" (${staticNode.type}, id=${staticNode.id})`;
    const _step = (name: string) => {
      if (staticNode.type === 'TEXT') _ilog(`[createNode] ${_nodeLabel} → ${name}`);
    };

    _step('applyCommonProps');
    applyCommonProps(liveNode, staticNode);
    _step('applyVectorData');
    applyVectorData(liveNode, staticNode);
    _step('applyTransform');
    // For GROUP nodes, skip transform on the temp FRAME — children will be created
    // at their local (non-rotated) positions. The GROUP's transform is applied AFTER
    // figma.group() to avoid double-rotation.
    if (staticNode.type !== 'GROUP') {
      applyTransform(liveNode, staticNode, staticParentNode);
    }
    _step('applyGeometry');
    applyGeometry(liveNode, staticNode);
    _step('applyBackground');
    applyBackground(liveNode, staticNode);
    _step('applyStrokeProps');
    applyStrokeProps(liveNode, staticNode);
    _step('applyShapeProps');
    applyShapeProps(liveNode, staticNode);
    _step('applyText');
    await applyText(liveNode, staticNode);
    _step('applyAutoLayout');
    applyAutoLayout(liveNode, staticNode);
    _step('applyConstraints');
    applyConstraints(liveNode, staticNode);
    _step('applyBlend');
    applyBlend(liveNode, staticNode);
    _step('DONE ✓');

    if (Array.isArray(staticNode.children) && 'appendChild' in liveNode) {
      for (const staticChildNode of staticNode.children) {
        try {
          const liveChildNode = await createNode(
            staticChildNode,
            liveNode,
            staticNode
          );
          if (liveChildNode) {
            (liveNode as SceneNode & ChildrenMixin).appendChild(liveChildNode);
            finaliseAbsolutePositioning(liveChildNode, staticChildNode, liveNode);
            finaliseLayoutSizing(liveChildNode, staticChildNode);
          }
        } catch (childErr) {
          const errMsg = childErr instanceof Error ? `${childErr.message}\n${childErr.stack}` : String(childErr);
          _ilog(`[createNode] ❌ Child "${(staticChildNode.name ?? staticChildNode.type).slice(0, 50)}" (${staticChildNode.type}, id=${staticChildNode.id}) failed: ${errMsg}`);
        }
      }

      if (staticNode.type === 'GROUP') {
        // Snapshot children array — figma.group() mutates the live list
        const children = Array.from((liveNode as FrameNode).children);
        if (children.length === 0) {
          // No children survived — return the temp FRAME as-is
          return liveNode;
        }

        // Log the temp FRAME transform before grouping
        const hasRotation = Array.isArray(staticNode.relativeTransform) &&
          staticNode.relativeTransform.length === 2 &&
          (Math.abs(staticNode.relativeTransform[0][1]) > 0.001 || Math.abs(staticNode.relativeTransform[1][0]) > 0.001);
        if (hasRotation) {
          const M = staticNode.relativeTransform;
          const liveM = (liveNode as any).relativeTransform;
          console.log(`[createNode] GROUP "${staticNode.name}" has ROTATION. JSON transform: tx=${M[0][2].toFixed(1)} ty=${M[1][2].toFixed(1)} cos=${M[0][0].toFixed(4)} sin=${M[0][1].toFixed(4)}`);
          console.log(`[createNode] GROUP "${staticNode.name}" tempFrame transform: tx=${liveM?.[0]?.[2]?.toFixed?.(1)} ty=${liveM?.[1]?.[2]?.toFixed?.(1)} cos=${liveM?.[0]?.[0]?.toFixed?.(4)} sin=${liveM?.[0]?.[1]?.toFixed?.(4)}`);
        }

        const group = figma.group(
          children,
          liveNode.parent as PageNode | (BaseNode & ChildrenMixin)
        );
        group.name = liveNode.name;
        if ('opacity' in staticNode) group.opacity = staticNode.opacity ?? 1;
        if ('visible' in staticNode) group.visible = staticNode.visible;
        // Preserve mask properties (critical for clip path groups)
        if (staticNode.isMask === true) {
          group.isMask = true;
          if ('maskType' in group) {
            (group as any).maskType = resolveMaskType(staticNode);
          }
        }

        if (hasRotation) {
          const gM = (group as any).relativeTransform;
          console.log(`[createNode] GROUP "${staticNode.name}" AFTER figma.group(): tx=${gM?.[0]?.[2]?.toFixed?.(1)} ty=${gM?.[1]?.[2]?.toFixed?.(1)} cos=${gM?.[0]?.[0]?.toFixed?.(4)} sin=${gM?.[0]?.[1]?.toFixed?.(4)}`);
        }

        // Apply the GROUP's transform now (was skipped on the temp FRAME to avoid
        // double-rotation). This sets position + rotation on the GROUP correctly.
        // Note: This sets transform relative to the current parent (page).
        // importJson's re-apply will override this with the correct slide-relative transform.
        if (Array.isArray(staticNode.relativeTransform) && staticNode.relativeTransform.length === 2) {
          try {
            const M = staticNode.relativeTransform;
            (group as any).relativeTransform = [
              [M[0][0], M[0][1], M[0][2]],
              [M[1][0], M[1][1], M[1][2]],
            ];
            if (hasRotation) {
              const aM = (group as any).relativeTransform;
              console.log(`[createNode] GROUP "${staticNode.name}" AFTER applyTransform: tx=${aM?.[0]?.[2]?.toFixed?.(1)} ty=${aM?.[1]?.[2]?.toFixed?.(1)} cos=${aM?.[0]?.[0]?.toFixed?.(4)} sin=${aM?.[0]?.[1]?.toFixed?.(4)}`);
            }
          } catch (e) {
            console.warn(`[createNode] Failed to apply transform on GROUP "${staticNode.name}": ${e instanceof Error ? e.message : e}`);
          }
        }

        liveNode.remove();
        return group;
      }

      if (staticNode.type === 'BOOLEAN_OPERATION') {
        const boolNode = applyBoolean(liveNode, staticNode, parentNode);
        if (boolNode) {
          applyCommonProps(boolNode, staticNode);
          applyTransform(boolNode, staticNode, staticParentNode);
          applyGeometry(boolNode, staticNode);
          applyBackground(boolNode, staticNode);
          applyBlend(boolNode, staticNode);
          return boolNode;
        }
      }
    }
    return liveNode;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    _ilog(`[createNode] ❌ FAILED for "${(staticNode.name ?? staticNode.type).slice(0, 50)}" (${staticNode.type}, id=${staticNode.id}): ${errMsg}`);
    try { liveNode.remove(); } catch {}
    return null;
  }
}


async function instantiateNode(
  staticNode: FetchedNode
): Promise<SceneNode | null> {
  const map: Record<string, () => SceneNode> = {
    FRAME: () => figma.createFrame(),
    GROUP: () => figma.createFrame(),
    SECTION: () => figma.createSection?.() || figma.createFrame(),
    RECTANGLE: () => figma.createRectangle(),
    ELLIPSE: () => figma.createEllipse(),
    LINE: () => figma.createLine(),
    POLYGON: () => figma.createPolygon(),
    STAR: () => figma.createStar(),
    VECTOR: () => figma.createVector(),
    BOOLEAN_OPERATION: () => figma.createFrame(),
    SLICE: () => figma.createSlice(),
    TEXT: () => figma.createText(),
    SLIDE: () => figma.createFrame(),  // SlideNodes are created by importJson, not here
    SLIDE_ROW: () => figma.createFrame(),
    SLIDE_GRID: () => figma.createFrame(),
    INSTANCE: () => figma.createFrame(),
    COMPONENT: () => figma.createFrame(),
    COMPONENT_SET: () => figma.createFrame(),
    SHAPE_WITH_TEXT: () => {
      // Try native createShapeWithText first (FigJam/Slides).
      // If unavailable, fall back to a shape matching the shapeType.
      try {
        if (typeof figma.createShapeWithText === 'function') {
          return figma.createShapeWithText();
        }
      } catch (e) {
        _ilog(`[instantiateNode] createShapeWithText() failed: ${e instanceof Error ? e.message : e}, falling back`);
      }
      // Fallback: create primitive shape based on shapeType
      const st = staticNode.shapeType;
      if (st === 'ELLIPSE') return figma.createEllipse();
      if (st === 'DIAMOND' || st === 'TRIANGLE_UP' || st === 'TRIANGLE_DOWN' ||
          st === 'HEXAGON' || st === 'PENTAGON' || st === 'OCTAGON' ||
          st === 'STAR' || st === 'PLUS' || st === 'CHEVRON' ||
          st === 'SHIELD' || st === 'ARROW_LEFT' || st === 'ARROW_RIGHT') {
        return figma.createPolygon();
      }
      return figma.createRectangle();
    },
    TABLE: () => figma.createFrame(),
    TABLE_CELL: () => figma.createFrame(),
    CANVAS: () => null,
  };
  const ctor = map[staticNode.type];
  return ctor ? ctor() : null;
}


function applyVectorData(liveNode: SceneNode, staticNode: FetchedNode) {
  try {
    if (staticNode.type !== 'VECTOR') return;
    const vector = liveNode as VectorNode;

    const hasFillGeo =
      Array.isArray(staticNode.fillGeometry) && staticNode.fillGeometry.length;
    const hasStrokeGeo =
      Array.isArray(staticNode.strokeGeometry) && staticNode.strokeGeometry.length;

    if (hasFillGeo) {
      // Use fill geometry — keep fills and strokes separate
      vector.vectorPaths = staticNode.fillGeometry.map((g: any) => ({
        windingRule: (g.windingRule as WindingRule) ?? 'NONZERO',
        data: sanitisePathData(g.path as string),
      }));
      // fills & strokes are applied later by applyGeometry — don't touch them
    } else if (hasStrokeGeo) {
      // No fill geometry — the stroke geometry already represents the
      // expanded stroke shape, so treat original stroke paints as fills.
      vector.vectorPaths = staticNode.strokeGeometry.map((g: any) => ({
        windingRule: (g.windingRule as WindingRule) ?? 'NONZERO',
        data: sanitisePathData(g.path as string),
      }));
      const strokePaints = Array.isArray(staticNode.strokes)
        ? clone(staticNode.strokes)
        : [];
      staticNode.fills = strokePaints.concat(staticNode.fills ?? []);
      staticNode.strokes = [];
      delete staticNode.strokeWeight;
    }
  } catch (e) {
    console.error('applyVectorData →', e);
  }
}

function applyCommonProps(liveNode: SceneNode, staticNode: FetchedNode) {
  try {
    liveNode.name = staticNode.name ?? staticNode.type;
    if ('visible' in staticNode) liveNode.visible = staticNode.visible;
    if ('opacity' in staticNode) (liveNode as any).opacity = staticNode.opacity;
  } catch (e) {
    console.error('Error applying common props:', e);
  }
}

function applyTransform(
  liveNode: SceneNode,
  staticNode: FetchedNode,
  staticParentNode: FetchedNode
) {
  try {

    const parentIsAutoLayout =
      typeof staticParentNode.layoutMode === 'string' &&
      staticParentNode.layoutMode !== 'NONE';

    const absoluteLater = parentIsAutoLayout && wantsAbsolute(staticNode);


    const w =
      staticNode.size?.x ??
      staticNode.absoluteBoundingBox?.width ??
      liveNode.width;
    const h =
      staticNode.size?.y ??
      staticNode.absoluteBoundingBox?.height ??
      liveNode.height;

    const SLIDE_TYPES = ['SLIDE', 'SLIDE_ROW', 'SLIDE_GRID'];
    if (
      'resize' in liveNode &&
      w != null &&
      h != null &&
      liveNode.type !== 'VECTOR' &&
      !SLIDE_TYPES.includes(liveNode.type)
    ) {
      (liveNode as LayoutMixin).resize(w, h);
    }


    const canEditXYNow = !parentIsAutoLayout && !absoluteLater;
    const isRoot =
      staticParentNode.type === 'DOCUMENT' || staticParentNode.type === 'PAGE';

    if (
      canEditXYNow &&
      Array.isArray(staticNode.relativeTransform) &&
      staticNode.relativeTransform.length === 2 &&
      !isRoot &&
      'relativeTransform' in liveNode
    ) {
      const M = staticNode.relativeTransform as Transform;


      const safe: Transform = [
        [tideFloat(M[0][0]), tideFloat(M[0][1]), tideFloat(M[0][2])],
        [tideFloat(M[1][0]), tideFloat(M[1][1]), tideFloat(M[1][2])],
      ];

      try {
        (liveNode as any).relativeTransform = safe;
        return;
      } catch (error) {
        console.error(
          'Error applying relativeTransform:',
          error,
          '→ falling back to absolute positioning'
        );
      }
    }

    if (canEditXYNow && staticNode.absoluteBoundingBox) {
      const { x, y } = staticNode.absoluteBoundingBox as XYWH;
      liveNode.x = x - (staticParentNode.absoluteBoundingBox?.x ?? 0);
      liveNode.y = y - (staticParentNode.absoluteBoundingBox?.y ?? 0);
      if (typeof staticNode.rotation === 'number') {
        const raw =
          Math.abs(staticNode.rotation) <= 2 * Math.PI
            ? (staticNode.rotation * 180) / Math.PI
            : staticNode.rotation;
        liveNode.rotation = raw;
      }
    }
  } catch (e) {
    console.error('Error applying transform:', e);
  }
}

function applyGeometry(liveNode: SceneNode, staticNode: FetchedNode) {
  try {
    const DEFAULT_GRADIENT_HANDLES: Vector[] = [
      { x: 0.0, y: 0.0 },
      { x: 1.0, y: 0.0 },
      { x: 0.0, y: 1.0 },
    ];

    if ('fills' in liveNode) {
      assignPaints('fills', liveNode as GeometryMixin, staticNode);
    }
    if ('strokes' in liveNode) {
      assignPaints('strokes', liveNode as GeometryMixin, staticNode);
    }

    if ('strokeWeight' in staticNode && 'strokeWeight' in liveNode) {
      (liveNode as GeometryMixin).strokeWeight = staticNode.strokeWeight;
    }
    if ('cornerRadius' in liveNode) {
      const tgt = liveNode as unknown as CornerMixin;

      const asNum = (v: any) => (typeof v === 'number' ? v : 0);

      if (
        Array.isArray(staticNode.rectangleCornerRadii) &&
        staticNode.rectangleCornerRadii.length === 4
      ) {
        const [tl, tr, br, bl] = staticNode.rectangleCornerRadii.map(asNum);
        tgt.topLeftRadius = tl;
        tgt.topRightRadius = tr;
        tgt.bottomRightRadius = br;
        tgt.bottomLeftRadius = bl;
      } else {
        if (staticNode.topLeftRadius !== undefined)
          tgt.topLeftRadius = asNum(staticNode.topLeftRadius);
        if (staticNode.topRightRadius !== undefined)
          tgt.topRightRadius = asNum(staticNode.topRightRadius);
        if (staticNode.bottomRightRadius !== undefined)
          tgt.bottomRightRadius = asNum(staticNode.bottomRightRadius);
        if (staticNode.bottomLeftRadius !== undefined)
          tgt.bottomLeftRadius = asNum(staticNode.bottomLeftRadius);
      }

      if (
        staticNode.rectangleCornerRadii === undefined &&
        staticNode.topLeftRadius === undefined &&
        staticNode.cornerRadius !== undefined
      ) {
        tgt.cornerRadius = asNum(staticNode.cornerRadius);
      }

      if (staticNode.cornerSmoothing !== undefined) {
        try {
          tgt.cornerSmoothing = staticNode.cornerSmoothing;
        } catch {
          // SlideNodes don't support cornerSmoothing
        }
      }
    }
    if ('effects' in staticNode && 'effects' in liveNode) {
      (liveNode as GeometryMixin).effects = staticNode.effects;
    }
  } catch (e) {
    console.error('Error applying geometry:', e);
  }
}

function applyBackground(liveNode: SceneNode, staticNode: FetchedNode) {

  const hasBgInput =
    staticNode.backgroundColor != null ||
    (Array.isArray(staticNode.background) &&
      staticNode.background.length > 0) ||
    typeof staticNode.backgroundStyleId === 'string';
  if (!hasBgInput) return;


  if (liveNode.type === 'PAGE' || staticNode.type === 'PAGE') {
    if (staticNode.backgroundColor) {
      const { r, g, b } = staticNode.backgroundColor;
      (liveNode as PageNode).backgroundColor = { r, g, b };
    }
    if (
      typeof staticNode.backgroundStyleId === 'string' &&
      'backgroundStyleId' in liveNode
    ) {
      try {
        (liveNode as any).backgroundStyleId = staticNode.backgroundStyleId;
      } catch (err) {
        console.error('Error applying background style:', err);
      }
    }
    return;
  }


  if ('background' in liveNode) {
    const frameLike = liveNode as FrameNode | ComponentNode | InstanceNode;


    if (
      typeof staticNode.backgroundStyleId === 'string' &&
      'backgroundStyleId' in frameLike
    ) {
      try {
        (frameLike as any).backgroundStyleId = staticNode.backgroundStyleId;
      } catch {
        console.error(
          'Error applying background style:',
          staticNode.backgroundStyleId
        );
      }
    }


    if (Array.isArray(staticNode.background) && staticNode.background.length) {
      const paints = staticNode.background
        .map(formatPaint)
        .filter(Boolean) as Paint[];

      if (JSON.stringify(paints) !== JSON.stringify(frameLike.background)) {
        frameLike.background = paints;
      }
      return;
    }


    if (
      staticNode.backgroundColor &&
      (!frameLike.background || frameLike.background.length === 0) &&
      typeof staticNode.backgroundStyleId !== 'string'
    ) {
      const { r, g, b, a } = staticNode.backgroundColor;
      frameLike.background = [
        { type: 'SOLID', color: { r, g, b }, opacity: a ?? 1 },
      ];
    }
    return;
  }


  if ('fills' in liveNode) {
    const geo = liveNode as GeometryMixin & { fillStyleId?: string };

    const jsonHasPaint =
      (Array.isArray(staticNode.fills) && staticNode.fills.length > 0) ||
      typeof staticNode.fillStyleId === 'string';
    const liveHasPaint =
      (Array.isArray(geo.fills) && geo.fills.length > 0) ||
      typeof geo.fillStyleId === 'string';


    if (!liveHasPaint && staticNode.backgroundColor) {
      const { r, g, b, a } = staticNode.backgroundColor;
      geo.fills = [{ type: 'SOLID', color: { r, g, b }, opacity: a ?? 1 }];
    }
  }
}

function applyStrokeProps(liveNode: SceneNode, staticNode: FetchedNode) {
  if (!('strokes' in liveNode)) return;

  const target = liveNode as unknown as {
    strokeCap?: StrokeCap;
    strokeJoin?: StrokeJoin;
    strokeAlign?: StrokeAlign;
    dashPattern?: number[];
    strokeMiterLimit?: number;
  };

  if ('strokeCap' in staticNode) target.strokeCap = staticNode.strokeCap;
  if ('strokeJoin' in staticNode) target.strokeJoin = staticNode.strokeJoin;
  if ('strokeAlign' in staticNode) target.strokeAlign = staticNode.strokeAlign;
  if ('dashPattern' in staticNode) target.dashPattern = staticNode.dashPattern;
  if ('strokeMiterLimit' in staticNode)
    target.strokeMiterLimit = staticNode.strokeMiterLimit;

  const dash = Array.isArray(staticNode.dashPattern)
    ? staticNode.dashPattern
    : Array.isArray((staticNode as any).strokeDashes)
      ? (staticNode as any).strokeDashes
      : undefined;

  if (dash && dash.length) {
    target.dashPattern = [...dash];
  }

  const indivdualWeights = staticNode.individualStrokeWeights;
  if (!indivdualWeights || typeof indivdualWeights !== 'object') return;

  const top =
    typeof indivdualWeights.top === 'number' ? indivdualWeights.top : undefined;
  const right =
    typeof indivdualWeights.right === 'number'
      ? indivdualWeights.right
      : undefined;
  const bottom =
    typeof indivdualWeights.bottom === 'number'
      ? indivdualWeights.bottom
      : undefined;
  const left =
    typeof indivdualWeights.left === 'number'
      ? indivdualWeights.left
      : undefined;

  if ('individualStrokeWeights' in liveNode) {
    (liveNode as any).individualStrokeWeights = {
      top:
        top ??
        (liveNode as any).individualStrokeWeights?.top ??
        (liveNode as any).strokeWeight ??
        0,
      right:
        right ??
        (liveNode as any).individualStrokeWeights?.right ??
        (liveNode as any).strokeWeight ??
        0,
      bottom:
        bottom ??
        (liveNode as any).individualStrokeWeights?.bottom ??
        (liveNode as any).strokeWeight ??
        0,
      left:
        left ??
        (liveNode as any).individualStrokeWeights?.left ??
        (liveNode as any).strokeWeight ??
        0,
    };
    return;
  }

  if ('strokeTopWeight' in liveNode && top !== undefined)
    (liveNode as any).strokeTopWeight = top;
  if ('strokeRightWeight' in liveNode && right !== undefined)
    (liveNode as any).strokeRightWeight = right;
  if ('strokeBottomWeight' in liveNode && bottom !== undefined)
    (liveNode as any).strokeBottomWeight = bottom;
  if ('strokeLeftWeight' in liveNode && left !== undefined)
    (liveNode as any).strokeLeftWeight = left;
}

function applyShapeProps(liveNode: SceneNode, staticNode: FetchedNode) {
  switch (staticNode.type) {

    case 'ELLIPSE': {
      if ('arcData' in staticNode) {
        const src = staticNode.arcData;
        const inner =
          typeof src.innerRadius === 'number' && src.innerRadius > 1
            ? src.innerRadius / 100
            : (src.innerRadius ?? 0);
        (liveNode as EllipseNode).arcData = {
          startingAngle: src.startingAngle ?? 0,
          endingAngle: src.endingAngle ?? 0,
          innerRadius: inner,
        };
      }
      break;
    }


    case 'RECTANGLE': {
      const r = liveNode as RectangleNode;

      if ('cornerSmoothing' in staticNode)
        r.cornerSmoothing = staticNode.cornerSmoothing;

      if (Array.isArray(staticNode.rectangleCornerRadii)) {
        const [tl, tr, br, bl] = staticNode.rectangleCornerRadii;
        r.topLeftRadius = tl;
        r.topRightRadius = tr;
        r.bottomRightRadius = br;
        r.bottomLeftRadius = bl;
      } else {
        if ('topLeftRadius' in staticNode)
          r.topLeftRadius = staticNode.topLeftRadius;
        if ('topRightRadius' in staticNode)
          r.topRightRadius = staticNode.topRightRadius;
        if ('bottomRightRadius' in staticNode)
          r.bottomRightRadius = staticNode.bottomRightRadius;
        if ('bottomLeftRadius' in staticNode)
          r.bottomLeftRadius = staticNode.bottomLeftRadius;
      }
      break;
    }


    case 'POLYGON': {
      const p = liveNode as PolygonNode;
      if ('pointCount' in staticNode) p.pointCount = staticNode.pointCount;
      if ('cornerRadius' in staticNode) {
        p.cornerRadius =
          staticNode.cornerRadius > 1
            ? staticNode.cornerRadius / 100
            : staticNode.cornerRadius;
      }
      if ('cornerSmoothing' in staticNode) {
        p.cornerSmoothing = staticNode.cornerSmoothing;
      }
      break;
    }


    case 'STAR': {
      const s = liveNode as StarNode;
      if ('pointCount' in staticNode) s.pointCount = staticNode.pointCount;
      if ('innerRadius' in staticNode)
        s.innerRadius =
          staticNode.innerRadius > 1
            ? staticNode.innerRadius / 100
            : staticNode.innerRadius;
      break;
    }


    case 'LINE':

      break;

    case 'SHAPE_WITH_TEXT': {
      if (staticNode.shapeType && liveNode.type === 'SHAPE_WITH_TEXT') {
        try {
          (liveNode as ShapeWithTextNode).shapeType = staticNode.shapeType;
        } catch (e) {
          console.error('Error setting shapeType:', e);
        }
      }
      break;
    }
  }
}

async function applyText(
  liveNode: SceneNode,
  staticNode: FetchedNode
): Promise<void> {
  if (staticNode.type === 'SHAPE_WITH_TEXT') {
    // Only apply text if the live node is actually a ShapeWithTextNode (has .text sublayer)
    if (liveNode.type !== 'SHAPE_WITH_TEXT') return;
    const shapeNode = liveNode as ShapeWithTextNode;
    const textTarget = shapeNode.text;
    const chars = staticNode.characters ?? '';
    if (chars) {
      try {
        await figma.loadFontAsync(textTarget.fontName as FontName);
        textTarget.characters = chars;
        const rootStyle = staticNode.style ?? {};
        if (rootStyle.fontFamily) {
          const font: FontName = {
            family: rootStyle.fontFamily,
            style: rootStyle.fontStyle ?? 'Regular',
          };
          try {
            await figma.loadFontAsync(font);
            textTarget.fontName = font;
          } catch {
            // keep default font
          }
        }
        if ('fontSize' in rootStyle) {
          textTarget.fontSize = rootStyle.fontSize;
        }
      } catch (e) {
        console.error('Error applying SHAPE_WITH_TEXT text:', e);
      }
    }
    return;
  }

  // TABLE_CELL stores its text in the `characters` field directly (Figma's
  // import API recreates TABLE_CELL as a FRAME, which can't hold text).
  // Inject a TEXT child inside the cell frame so the cell renders.
  // JSON omits cell typography (Figma's TABLE applies it implicitly), so we
  // pick sensible defaults: Inter, 24px, header row SemiBold, padding + center.
  if (staticNode.type === 'TABLE_CELL') {
    const cellChars = staticNode.characters ?? '';
    if (cellChars && 'appendChild' in liveNode) {
      try {
        const cellFrame = liveNode as FrameNode;
        // Determine if header row by ty=0 of relativeTransform
        const rt = staticNode.relativeTransform;
        const isHeader = Array.isArray(rt) && rt.length >= 2
          && Math.abs((rt[1] && rt[1][2]) || 0) < 0.5;
        const headerStyle: FontName = { family: 'Inter', style: 'Semi Bold' };
        const bodyStyle: FontName = { family: 'Inter', style: 'Regular' };
        const cellTxt = figma.createText();
        const requested = isHeader ? headerStyle : bodyStyle;
        try {
          await figma.loadFontAsync(requested);
          cellTxt.fontName = requested;
        } catch {
          // Fallback chain: SemiBold→Bold, Regular kept
          try {
            const fallback: FontName = isHeader ? { family: 'Inter', style: 'Bold' } : bodyStyle;
            await figma.loadFontAsync(fallback);
            cellTxt.fontName = fallback;
          } catch {
            try { await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); cellTxt.fontName = { family: 'Inter', style: 'Regular' }; } catch {}
          }
        }
        cellTxt.characters = cellChars.replace(/\s+$/, ''); // trim trailing whitespace
        try { cellTxt.fontSize = 24; } catch {}
        try { cellTxt.textAlignHorizontal = 'LEFT'; } catch {}
        try { cellTxt.textAlignVertical = 'CENTER'; } catch {}

        // Auto-layout the cell frame so text vertically centers with padding
        try {
          cellFrame.layoutMode = 'VERTICAL';
          cellFrame.primaryAxisAlignItems = 'CENTER';
          cellFrame.counterAxisAlignItems = 'MIN';
          cellFrame.paddingLeft = 24;
          cellFrame.paddingRight = 24;
          cellFrame.paddingTop = 16;
          cellFrame.paddingBottom = 16;
          cellFrame.primaryAxisSizingMode = 'FIXED';
          cellFrame.counterAxisSizingMode = 'FIXED';
        } catch {}

        // Cell border to mimic table grid lines
        try {
          cellFrame.strokes = [{
            type: 'SOLID',
            color: { r: 0.45, g: 0.45, b: 0.45 },
            opacity: 1,
          } as Paint];
          cellFrame.strokeWeight = 1;
          (cellFrame as any).strokeAlign = 'INSIDE';
        } catch {}

        // Constrain text width to cell width minus padding
        const cellW = cellFrame.width || 0;
        if (cellW > 48) {
          try { cellTxt.textAutoResize = 'HEIGHT'; cellTxt.resize(cellW - 48, cellTxt.height); } catch {}
        }
        cellFrame.appendChild(cellTxt);
      } catch (e) {
        _ilog(`[applyText] TABLE_CELL "${cellChars.slice(0, 40)}" failed to inject text: ${e instanceof Error ? e.message : e}`);
      }
    }
    return;
  }

  if (staticNode.type !== 'TEXT') return;
  const txt = liveNode as TextNode;

  const _tl = (msg: string) => _ilog(`[applyText] id=${staticNode.id} "${(staticNode.characters ?? '').slice(0, 40)}" → ${msg}`);

  const FALLBACK_FAMILY = 'Inter';

  async function loadFontOrFallback(requested: FontName): Promise<FontName> {
    try {
      await figma.loadFontAsync(requested);
      return requested;
    } catch {
      _tl(`font fallback: ${requested.family}/${requested.style} → trying ${FALLBACK_FAMILY}/${requested.style}`);
      const sameStyle: FontName = {
        family: FALLBACK_FAMILY,
        style: requested.style,
      };
      try {
        await figma.loadFontAsync(sameStyle);
        return sameStyle;
      } catch {
        _tl(`font fallback: ${FALLBACK_FAMILY}/${requested.style} → trying ${FALLBACK_FAMILY}/Regular`);
        const regular: FontName = { family: FALLBACK_FAMILY, style: 'Regular' };
        await figma.loadFontAsync(regular);
        return regular;
      }
    }
  }

  const toPaints = (fills: any[] = []): Paint[] =>
    fills.map(formatPaint).filter((p): p is Paint => p !== undefined);


  const rootStyle = staticNode.style ?? {};
  const overrides = staticNode.characterStyleOverrides ?? [];
  const table = staticNode.styleOverrideTable ?? {};

  _tl(`chars=${(staticNode.characters ?? '').length}, overrides=${overrides.length}, tableKeys=[${Object.keys(table)}], rootFont=${rootStyle.fontFamily}/${rootStyle.fontStyle}/${rootStyle.fontSize}`);

  const lookupFont = (s: any): FontName => ({
    family: s.fontFamily ?? (txt.fontName as FontName).family,
    style: s.fontStyle ?? (txt.fontName as FontName).style,
  });


  _tl('loading default font');
  await figma.loadFontAsync(txt.fontName as FontName);
  const fontMap = new Map<string, FontName>();
  async function register(fn: FontName) {
    const resolved = await loadFontOrFallback(fn);
    fontMap.set(JSON.stringify(fn), resolved);
    _tl(`font registered: ${fn.family}/${fn.style} → ${resolved.family}/${resolved.style}`);
  }
  await register(lookupFont(rootStyle));
  for (const [key, s] of Object.entries(table)) {
    _tl(`registering font for override key="${key}": ${JSON.stringify(s)}`);
    await register(lookupFont(s as any));
  }
  const safe = (fn: FontName) => fontMap.get(JSON.stringify(fn))!;


  // TARGET textAutoResize – applied at the very end after all text properties
  // are set.  applyTransform's resize() may have already switched the node to
  // NONE.  We temporarily reset to WIDTH_AND_HEIGHT so that setting characters,
  // fontName, fontSize, textCase etc. does not cause premature line-wrapping
  // (e.g. textCase=UPPER widening text beyond the original box width).
  const _targetAutoResize = (staticNode.textAutoResize ??
    rootStyle.textAutoResize ??
    'NONE') as string;
  txt.textAutoResize = 'WIDTH_AND_HEIGHT' as any;

  _tl(`BEFORE characters: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize} target=${_targetAutoResize}`);
  _tl('setting characters');
  txt.characters = staticNode.characters ?? '';
  _tl(`AFTER characters: width=${txt.width}`);
  _tl('setting fontName');
  txt.fontName = safe(lookupFont(rootStyle));
  _tl(`AFTER fontName: width=${txt.width}`);
  if ('fontSize' in rootStyle) {
    _tl(`setting fontSize=${rootStyle.fontSize}`);
    txt.fontSize = rootStyle.fontSize;
    _tl(`AFTER fontSize: width=${txt.width}`);
  }

  const resolveAlignment = (): {
    h: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
    v: 'TOP' | 'CENTER' | 'BOTTOM';
  } => {
    const hRaw =
      staticNode.textAlignHorizontal ?? rootStyle.textAlignHorizontal ?? 'LEFT';
    const vRaw =
      staticNode.textAlignVertical ?? rootStyle.textAlignVertical ?? 'TOP';

    const normaliseAlign = (raw: any) => {
      if (typeof raw !== 'string') return undefined;
      const up = raw.toUpperCase();
      return up === 'MIDDLE' ? 'CENTER' : up;
    };

    const h = normaliseAlign(hRaw);
    const v = normaliseAlign(vRaw);

    const horiz: any = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(h!)
      ? h
      : 'LEFT';
    const vert: any = ['TOP', 'CENTER', 'BOTTOM'].includes(v!) ? v : 'TOP';
    return { h: horiz, v: vert };
  };
  const { h, v } = resolveAlignment();
  txt.textAlignHorizontal = h;
  if (_targetAutoResize === 'NONE') {
    txt.textAlignVertical = v;
  }


  if ('textCase' in rootStyle) {
    try {
      txt.textCase = rootStyle.textCase;
    } catch {

    }
  }
  if ('textDecoration' in rootStyle)
    txt.textDecoration = rootStyle.textDecoration;
  if ('paragraphIndent' in rootStyle)
    txt.paragraphIndent = rootStyle.paragraphIndent;
  if ('paragraphSpacing' in rootStyle)
    txt.paragraphSpacing = rootStyle.paragraphSpacing;

  // Root-level list options
  // Diagnostic: always log what we have for list options
  const hasBulletText = txt.characters.includes("•") || txt.characters.includes("·");
  if (hasBulletText || rootStyle.listOptions) {
    _tl(`BULLET IMPORT DIAG: name="${staticNode.name || 'N/A'}" rootStyle.listOptions=${JSON.stringify(rootStyle.listOptions)} hasBulletText=${hasBulletText} chars="${txt.characters.substring(0, 60)}"`);
  }
  if (rootStyle.listOptions && rootStyle.listOptions.type && txt.characters.length > 0) {
    try {
      _tl(`setting root listOptions=${rootStyle.listOptions.type}`);
      txt.setRangeListOptions(0, txt.characters.length, rootStyle.listOptions);
    } catch (e) {
      _tl(`setRangeListOptions root FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Root-level indentation
  if (rootStyle.indentation !== undefined && rootStyle.indentation > 0 && txt.characters.length > 0) {
    try {
      _tl(`setting root indentation=${rootStyle.indentation}`);
      txt.setRangeIndentation(0, txt.characters.length, rootStyle.indentation);
    } catch (e) {
      _tl(`setRangeIndentation root FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Per-paragraph lineTypes & lineIndentations (REST API format bullets)
  const lineTypes: string[] | undefined = staticNode.lineTypes;
  const lineIndentations: number[] | undefined = staticNode.lineIndentations;
  if (Array.isArray(lineTypes) && lineTypes.length > 0 && txt.characters.length > 0) {
    _tl(`applying lineTypes=${JSON.stringify(lineTypes)} lineIndentations=${JSON.stringify(lineIndentations)}`);
    const lines = txt.characters.split("\n");
    let charOffset = 0;
    for (let li = 0; li < lines.length && li < lineTypes.length; li++) {
      const lineStart = charOffset;
      const lineEnd = charOffset + lines[li].length;
      charOffset = lineEnd + 1; // +1 for newline

      if (lineEnd <= lineStart) continue; // empty line

      const lt = lineTypes[li];
      if (lt && lt !== "NONE") {
        try {
          _tl(`  setRangeListOptions line[${li}] [${lineStart},${lineEnd}) → ${lt}`);
          txt.setRangeListOptions(lineStart, lineEnd, { type: lt as any });
        } catch (e) {
          _tl(`  setRangeListOptions line[${li}] FAILED: ${e instanceof Error ? e.message : e}`);
        }
      }

      const indent = lineIndentations?.[li] ?? 0;
      if (indent > 0) {
        try {
          _tl(`  setRangeIndentation line[${li}] [${lineStart},${lineEnd}) → ${indent}`);
          txt.setRangeIndentation(lineStart, lineEnd, indent);
        } catch (e) {
          _tl(`  setRangeIndentation line[${li}] FAILED: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  }

  if (rootStyle.lineHeightUnit === 'AUTO') {
    txt.lineHeight = { unit: 'AUTO' };
  } else if ('lineHeightPx' in rootStyle) {
    txt.lineHeight = { value: rootStyle.lineHeightPx, unit: 'PIXELS' };
  } else if ('lineHeightPercent' in rootStyle) {
    txt.lineHeight = { value: rootStyle.lineHeightPercent, unit: 'PERCENT' };
  }

  if ('letterSpacing' in rootStyle) {
    txt.letterSpacing = {
      value: rootStyle.letterSpacing,
      unit: rootStyle.letterSpacingUnit === 'PERCENT' ? 'PERCENT' : 'PIXELS',
    };
  }

  if (
    (staticNode.leadingTrim !== undefined ||
      rootStyle.leadingTrim !== undefined) &&
    'leadingTrim' in txt
  ) {
    try {
      (txt as any).leadingTrim =
        staticNode.leadingTrim ?? rootStyle.leadingTrim;
    } catch (err) {
      console.warn('applyText → could not set leadingTrim:', err);
    }
  }


  if ('fills' in staticNode && (!txt.fills || txt.fills.length === 0)) {
    const paints = toPaints(staticNode.fills);
    if (paints.length) txt.fills = paints;
  }


  if (overrides.length && Object.keys(table).length) {
    _tl(`applying ${overrides.length} character overrides`);
    let start = 0;
    while (start < overrides.length) {
      const styleId = overrides[start];
      let end = start;
      while (end < overrides.length && overrides[end] === styleId) end++;

      const o = table[styleId];
      if (o) {
        _tl(`  range [${start},${end}) styleId=${styleId} keys=[${Object.keys(o)}]`);
        // Only set font if the override actually specifies font info
        const hasFont = 'fontFamily' in o || 'fontStyle' in o || 'fontWeight' in o || 'fontPostScriptName' in o;
        if (hasFont) {
          try {
            const sf = safe(lookupFont(o));
            _tl(`  setRangeFontName [${start},${end}) → ${sf?.family}/${sf?.style}`);
            txt.setRangeFontName(start, end, sf);
          } catch (e) {
            _tl(`  ❌ setRangeFontName FAILED: ${e instanceof Error ? e.message : e}`);
            throw e;
          }
        } else {
          _tl(`  skipping setRangeFontName [${start},${end}) — no font info in override`);
        }
        if ('fontSize' in o) {
          _tl(`  setRangeFontSize [${start},${end}) → ${o.fontSize}`);
          txt.setRangeFontSize(start, end, o.fontSize);
        }
        if ('textCase' in o) {
          try {
            txt.setRangeTextCase(start, end, o.textCase);
          } catch {}
        }
        if ('textDecoration' in o)
          txt.setRangeTextDecoration(start, end, o.textDecoration);

        if (o.lineHeightUnit === 'AUTO') {
          txt.setRangeLineHeight(start, end, { unit: 'AUTO' });
        } else if ('lineHeightPx' in o) {
          txt.setRangeLineHeight(start, end, {
            value: o.lineHeightPx,
            unit: 'PIXELS',
          });
        } else if ('lineHeightPercent' in o) {
          txt.setRangeLineHeight(start, end, {
            value: o.lineHeightPercent,
            unit: 'PERCENT',
          });
        }

        if ('letterSpacing' in o) {
          txt.setRangeLetterSpacing(start, end, {
            value: o.letterSpacing,
            unit: o.letterSpacingUnit === 'PERCENT' ? 'PERCENT' : 'PIXELS',
          });
        }

        // List options override
        if (o.listOptions && o.listOptions.type) {
          try {
            _tl(`  setRangeListOptions [${start},${end}) → ${o.listOptions.type}`);
            txt.setRangeListOptions(start, end, o.listOptions);
          } catch (e) {
            _tl(`  setRangeListOptions [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
          }
        }

        // Indentation override
        if ('indentation' in o && typeof o.indentation === 'number' && o.indentation > 0) {
          try {
            _tl(`  setRangeIndentation [${start},${end}) → ${o.indentation}`);
            txt.setRangeIndentation(start, end, o.indentation);
          } catch (e) {
            _tl(`  setRangeIndentation [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
          }
        }

        // OpenType features override
        if (o.openTypeFeatures && typeof o.openTypeFeatures === 'object' && Object.keys(o.openTypeFeatures).length > 0) {
          try {
            _tl(`  setRangeOpenTypeFeatures [${start},${end})`);
            txt.setRangeOpenTypeFeatures(start, end, o.openTypeFeatures);
          } catch (e) {
            _tl(`  setRangeOpenTypeFeatures [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
          }
        }

        // Hyperlink override
        if (o.hyperlink) {
          try {
            _tl(`  setRangeHyperlink [${start},${end}) → ${o.hyperlink.type}`);
            txt.setRangeHyperlink(start, end, o.hyperlink);
          } catch (e) {
            _tl(`  setRangeHyperlink [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
          }
        }

        if (Array.isArray(o.fills) && o.fills.length) {
          try {
            const rangePaints = toPaints(o.fills);
            _tl(`  setRangeFills [${start},${end}) → ${rangePaints.length} paint(s)`);
            txt.setRangeFills(start, end, rangePaints);
          } catch (e) {
            _tl(`  ❌ setRangeFills FAILED: ${e instanceof Error ? e.message : e}`);
            throw e;
          }
        }
        if ('inheritFillStyleId' in o) {
          try {
            _tl(`  setRangeFillStyleId [${start},${end}) → "${o.inheritFillStyleId}"`);
            txt.setRangeFillStyleId(start, end, o.inheritFillStyleId);
          } catch (e) {
            _tl(`  setRangeFillStyleId skipped (expected): ${e instanceof Error ? e.message : e}`);
          }
        }
      } else {
        _tl(`  range [${start},${end}) styleId=${styleId} → NOT found in table, skipping`);
      }
      start = end;
    }
    _tl('overrides done');
  }

  // --- Finalize textAutoResize and dimensions ---
  // All text properties have been applied in WIDTH_AND_HEIGHT mode.
  // Now set the actual target textAutoResize and restore original dimensions.
  const origW = staticNode.size?.x ?? staticNode.absoluteBoundingBox?.width;
  const origH = staticNode.size?.y ?? staticNode.absoluteBoundingBox?.height;
  _tl(`FINAL: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize} origW=${origW} origH=${origH} target=${_targetAutoResize}`);

  txt.textAutoResize = _targetAutoResize as any;
  if (origW != null && origH != null && (_targetAutoResize === 'NONE' || _targetAutoResize === 'TRUNCATE')) {
    try { (txt as any).resize(origW, origH); } catch {}
  } else if (origW != null && _targetAutoResize === 'HEIGHT') {
    try { (txt as any).resize(origW, txt.height); } catch {}
  }
  _tl(`AFTER resize: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize}`);

  _tl('applyText complete');
}

function applyAutoLayout(liveNode: SceneNode, staticNode: FetchedNode) {
  try {
    if ('clipsContent' in liveNode) {
      const clip =
        (staticNode as any).clipsContent ?? (staticNode as any).clipContent;
      if (typeof clip === 'boolean') {
        (liveNode as FrameNode).clipsContent = clip;
      }
    }

    if (!('layoutMode' in staticNode) || !('layoutMode' in liveNode)) return;
    const frame = liveNode as FrameNode;


    frame.layoutMode = staticNode.layoutMode;
    const isContainer = frame.layoutMode !== 'NONE';


    if (isContainer) {
      if (
        'layoutSizingHorizontal' in staticNode &&
        staticNode.layoutSizingHorizontal !== 'FILL'
      ) {
        frame.layoutSizingHorizontal = staticNode.layoutSizingHorizontal as any;
      }
      if (
        'layoutSizingVertical' in staticNode &&
        staticNode.layoutSizingVertical !== 'FILL'
      ) {
        frame.layoutSizingVertical = staticNode.layoutSizingVertical as any;
      }

      if ('primaryAxisSizingMode' in staticNode)
        frame.primaryAxisSizingMode = staticNode.primaryAxisSizingMode;
      if ('counterAxisSizingMode' in staticNode)
        frame.counterAxisSizingMode = staticNode.counterAxisSizingMode;

      if ('primaryAxisAlignItems' in staticNode)
        frame.primaryAxisAlignItems = staticNode.primaryAxisAlignItems;
      if ('counterAxisAlignItems' in staticNode)
        frame.counterAxisAlignItems = staticNode.counterAxisAlignItems;
      if ('layoutWrap' in staticNode) frame.layoutWrap = staticNode.layoutWrap;
      if ('counterAxisSpacing' in staticNode)
        frame.counterAxisSpacing = staticNode.counterAxisSpacing ?? 0;


      if (staticNode.layoutMode === 'GRID') {
        if ('gridRowCount' in staticNode)
          frame.gridRowCount = staticNode.gridRowCount;
        if ('gridColumnCount' in staticNode)
          frame.gridColumnCount = staticNode.gridColumnCount;
        if ('gridRowGap' in staticNode)
          frame.gridRowGap = staticNode.gridRowGap;
        if ('gridColumnGap' in staticNode)
          frame.gridColumnGap = staticNode.gridColumnGap;
        if ('gridColumnsSizing' in staticNode)
          frame.gridColumnsSizing = staticNode.gridColumnsSizing;
        if ('gridRowsSizing' in staticNode)
          frame.gridRowsSizing = staticNode.gridRowsSizing;
      }


      frame.itemSpacing = staticNode.itemSpacing ?? frame.itemSpacing ?? 0;

      frame.paddingLeft =
        staticNode.paddingLeft ??
        staticNode.horizontalPadding ??
        frame.paddingLeft ??
        0;
      frame.paddingRight =
        staticNode.paddingRight ??
        staticNode.horizontalPadding ??
        frame.paddingRight ??
        0;
      frame.paddingTop =
        staticNode.paddingTop ??
        staticNode.verticalPadding ??
        frame.paddingTop ??
        0;
      frame.paddingBottom =
        staticNode.paddingBottom ??
        staticNode.verticalPadding ??
        frame.paddingBottom ??
        0;
    }

  } catch (err) {
    console.error('applyAutoLayout →', err);
  }
}

function applyConstraints(
  liveNode: SceneNode,
  staticNode: FetchedNode,
  parent?: BaseNode & ChildrenMixin
) {
  try {
    if ('constraints' in staticNode) {
      liveNode.setPluginData?.(
        '__constraints',
        JSON.stringify(staticNode.constraints)
      );
    }

    const parentIsAutoLayout =
      parent &&
      'layoutMode' in parent &&
      (parent as FrameNode).layoutMode !== 'NONE';

    if (parentIsAutoLayout) {
      if ('layoutAlign' in staticNode && 'layoutAlign' in liveNode)
        (liveNode as any).layoutAlign = staticNode.layoutAlign;
      if ('layoutGrow' in staticNode && 'layoutGrow' in liveNode)
        (liveNode as any).layoutGrow = staticNode.layoutGrow;

      if (
        'layoutSizingHorizontal' in staticNode &&
        'layoutSizingHorizontal' in liveNode
      )
        (liveNode as any).layoutSizingHorizontal =
          staticNode.layoutSizingHorizontal;
      if (
        'layoutSizingVertical' in staticNode &&
        'layoutSizingVertical' in liveNode
      )
        (liveNode as any).layoutSizingVertical =
          staticNode.layoutSizingVertical;
    }
  } catch (err) {
    console.error('applyConstraints →', err);
  }
}

function resolveMaskType(staticNode: FetchedNode): MaskType {
  if (typeof staticNode.maskType === 'string') {
    const t = staticNode.maskType.toUpperCase();
    if (t === 'ALPHA' || t === 'VECTOR' || t === 'LUMINANCE')
      return t as MaskType;
  }
  if (staticNode.isMaskOutline === true) return 'VECTOR';
  return 'ALPHA';
}

function applyBlend(liveNode: SceneNode, staticNode: FetchedNode) {
  try {
    if ('opacity' in staticNode && 'opacity' in liveNode) {
      (liveNode as GeometryMixin).opacity = staticNode.opacity;
    }
    if ('blendMode' in staticNode && 'blendMode' in liveNode) {
      (liveNode as BlendMixin).blendMode = staticNode.blendMode;
    }
    if ('isMask' in staticNode && 'isMask' in liveNode) {
      (liveNode as GeometryMixin).isMask = staticNode.isMask;
    }

    if ('maskType' in liveNode) {
      (liveNode as unknown as { maskType: MaskType }).maskType =
        resolveMaskType(staticNode);
    }
  } catch (e) {
    console.error('Error applying blend / maskType:', e);
  }
}

function applyBoolean(
  placeholder: SceneNode,
  staticNode: FetchedNode,
  parentNode: BaseNode & ChildrenMixin
): BooleanOperationNode | void {
  try {
    if (staticNode.type !== 'BOOLEAN_OPERATION') return;

    const shapes = (placeholder as ChildrenMixin).children as SceneNode[];
    if (shapes.length < 2) {
      console.warn(
        `[applyBoolean] “${staticNode.name}” needs ≥2 children, got ${shapes.length}.`
      );
      return;
    }

    const op = (staticNode.booleanOperation ?? 'UNION').toUpperCase();
    const opMap: Record<
      string,
      (nodes: SceneNode[], p: BaseNode & ChildrenMixin) => BooleanOperationNode
    > = {
      UNION: figma.union,
      SUBTRACT: figma.subtract,
      INTERSECT: figma.intersect,
      EXCLUDE: figma.exclude,
    };
    const builder = opMap[op] ?? figma.union;

    let z = parentNode.children.indexOf(placeholder);
    const boolNode =
      z >= 0 ? builder(shapes, parentNode, z) : builder(shapes, parentNode);

    boolNode.name = staticNode.name ?? 'Boolean';
    if ('touching' in staticNode)
      (boolNode as any).touching = staticNode.touching;
    if (placeholder.parent) placeholder.remove();

    return boolNode;
  } catch (err) {
    console.error('applyBoolean →', err);
  }
}
