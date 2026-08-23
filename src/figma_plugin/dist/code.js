"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/bridge.ts
  function findNodeBySourceId(id) {
    return __async(this, null, function* () {
      function walk(node) {
        var _a;
        try {
          const sid = (_a = node.getPluginData) == null ? void 0 : _a.call(node, "sourceId");
          if (sid === id) return node;
        } catch (e) {
        }
        if ("children" in node && Array.isArray(node.children)) {
          for (const child of node.children) {
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
    });
  }
  function lookupNode(id) {
    return __async(this, null, function* () {
      const direct = yield figma.getNodeByIdAsync(id);
      if (direct) return direct;
      return yield findNodeBySourceId(id);
    });
  }
  function resetImportLogs() {
    importLogs.length = 0;
  }
  function _ilog(msg) {
    importLogs.push(msg);
    console.log(msg);
  }
  function clone(val) {
    return JSON.parse(JSON.stringify(val));
  }
  function det3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  }
  function inv3(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const det = det3(m);
    if (Math.abs(det) < 1e-8) return null;
    const invDet = 1 / det;
    return [
      [
        (e * i - f * h) * invDet,
        (c * h - b * i) * invDet,
        (b * f - c * e) * invDet
      ],
      [
        (f * g - d * i) * invDet,
        (a * i - c * g) * invDet,
        (c * d - a * f) * invDet
      ],
      [
        (d * h - e * g) * invDet,
        (b * g - a * h) * invDet,
        (a * e - b * d) * invDet
      ]
    ];
  }
  function mul3(a, b) {
    const r = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
      }
    }
    return r;
  }
  function handlesToTransform(h) {
    var _a;
    const D = [
      [h[0].x, h[1].x, h[2].x],
      [h[0].y, h[1].y, h[2].y],
      [1, 1, 1]
    ];
    const invD = (_a = inv3(D)) != null ? _a : IDENTITY_HANDLES;
    const M = mul3(IDENTITY_HANDLES, invD);
    return [M[0], M[1]];
  }
  function sanitisePathData(path) {
    return path.replace(/([MLHVCSQTAZmlhvcsqtaz])(?=[^\s,])/g, "$1 ").replace(/([^\s,])([MLHVCSQTAZmlhvcsqtaz])/g, "$1 $2").replace(/([0-9.])(-)/g, "$1 $2").replace(/\s+/g, " ").trim();
  }
  function tideFloat(n, eps = 1e-6) {
    return Math.abs(n) < eps ? 0 : Number(n.toFixed(6));
  }
  function wantsAbsolute(staticNode) {
    return staticNode.layoutPositioning === "ABSOLUTE" || staticNode.ignoreAutoLayout === true;
  }
  function finaliseAbsolutePositioning(liveChild, staticChild, liveParent) {
    try {
      if (!wantsAbsolute(staticChild) || !("layoutMode" in liveParent) || liveParent.layoutMode === "NONE" || !("layoutPositioning" in liveChild)) {
        return;
      }
      if ("layoutPositioning" in liveChild) {
        liveChild.layoutPositioning = "ABSOLUTE";
      }
      if (Array.isArray(staticChild.relativeTransform) && staticChild.relativeTransform.length === 2) {
        const T = staticChild.relativeTransform;
        liveChild.x = T[0][2];
        liveChild.y = T[1][2];
      } else if (staticChild.absoluteBoundingBox) {
        const { x, y } = staticChild.absoluteBoundingBox;
        liveChild.x = x - liveParent.x;
        liveChild.y = y - liveParent.y;
      }
    } catch (err) {
      console.warn("finaliseAbsolutePositioning \u2192", err);
    }
  }
  function finaliseLayoutSizing(liveChild, staticChild) {
    try {
      if (staticChild.layoutSizingHorizontal === "FILL" && "layoutSizingHorizontal" in liveChild) {
        liveChild.layoutSizingHorizontal = "FILL";
      }
      if (staticChild.layoutSizingVertical === "FILL" && "layoutSizingVertical" in liveChild) {
        liveChild.layoutSizingVertical = "FILL";
      }
    } catch (err) {
      console.warn("finaliseLayoutSizing \u2192", err);
    }
  }
  function formatPaint(p) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    if (!(p == null ? void 0 : p.type)) return;
    const rgb = ({ r, g, b }) => ({ r, g, b });
    const rgba = ({ r, g, b, a }) => ({ r, g, b, a: a != null ? a : 1 });
    switch (p.type) {
      case "SOLID": {
        if (!p.color) return;
        return {
          type: "SOLID",
          color: rgb(p.color),
          opacity: (_b = (_a = p.opacity) != null ? _a : p.color.a) != null ? _b : 1,
          visible: (_c = p.visible) != null ? _c : true,
          blendMode: p.blendMode
        };
      }
      case "IMAGE": {
        const origRef = (_d = p.imageHash) != null ? _d : p.imageRef;
        if (!origRef) return;
        imagePaintStats.total++;
        const inMap = imageHashMap.has(origRef);
        const resolvedHash = inMap ? imageHashMap.get(origRef) : origRef;
        if (inMap) {
          imagePaintStats.resolved++;
        } else {
          imagePaintStats.unresolved++;
        }
        let scaleMode = (_e = p.scaleMode) != null ? _e : "FILL";
        let imgTransform = (_f = p.imageTransform) != null ? _f : [[1, 0, 0], [0, 1, 0]];
        if (!["FILL", "FIT", "CROP", "TILE"].includes(scaleMode)) {
          scaleMode = "CROP";
        }
        return {
          type: "IMAGE",
          imageHash: resolvedHash,
          scaleMode,
          imageTransform: imgTransform,
          opacity: (_g = p.opacity) != null ? _g : 1,
          visible: (_h = p.visible) != null ? _h : true
        };
      }
      case "GRADIENT_LINEAR":
      case "GRADIENT_RADIAL":
      case "GRADIENT_ANGULAR":
      case "GRADIENT_DIAMOND": {
        if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2) return;
        const transform = (_i = p.gradientTransform) != null ? _i : Array.isArray(p.gradientHandlePositions) && p.gradientHandlePositions.length === 3 ? handlesToTransform(p.gradientHandlePositions) : [
          [1, 0, 0],
          [0, 1, 0]
        ];
        return {
          type: p.type,
          gradientTransform: transform,
          gradientStops: p.gradientStops.map((s) => ({
            position: s.position,
            color: rgba(s.color)
          })),
          opacity: (_j = p.opacity) != null ? _j : 1,
          visible: (_k = p.visible) != null ? _k : true,
          blendMode: p.blendMode
        };
      }
    }
  }
  function createNode(staticNode, parentNode, staticParentNode) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M, _N;
      const liveNode = yield instantiateNode(staticNode);
      if (!liveNode) return null;
      try {
        if (staticNode.id) {
          nodeIdMap.set(staticNode.id, liveNode.id);
          try {
            liveNode.setPluginData("sourceId", String(staticNode.id));
          } catch (e) {
          }
        }
        const _nodeLabel = `"${((_a = staticNode.name) != null ? _a : staticNode.type).slice(0, 50)}" (${staticNode.type}, id=${staticNode.id})`;
        const _step = (name) => {
          if (staticNode.type === "TEXT") _ilog(`[createNode] ${_nodeLabel} \u2192 ${name}`);
        };
        _step("applyCommonProps");
        applyCommonProps(liveNode, staticNode);
        _step("applyVectorData");
        applyVectorData(liveNode, staticNode);
        _step("applyTransform");
        if (staticNode.type !== "GROUP") {
          applyTransform(liveNode, staticNode, staticParentNode);
        }
        _step("applyGeometry");
        applyGeometry(liveNode, staticNode);
        _step("applyBackground");
        applyBackground(liveNode, staticNode);
        _step("applyStrokeProps");
        applyStrokeProps(liveNode, staticNode);
        _step("applyShapeProps");
        applyShapeProps(liveNode, staticNode);
        _step("applyText");
        yield applyText(liveNode, staticNode);
        _step("applyAutoLayout");
        applyAutoLayout(liveNode, staticNode);
        _step("applyConstraints");
        applyConstraints(liveNode, staticNode);
        _step("applyBlend");
        applyBlend(liveNode, staticNode);
        _step("DONE \u2713");
        if (Array.isArray(staticNode.children) && "appendChild" in liveNode) {
          for (const staticChildNode of staticNode.children) {
            try {
              const liveChildNode = yield createNode(
                staticChildNode,
                liveNode,
                staticNode
              );
              if (liveChildNode) {
                liveNode.appendChild(liveChildNode);
                finaliseAbsolutePositioning(liveChildNode, staticChildNode, liveNode);
                finaliseLayoutSizing(liveChildNode, staticChildNode);
              }
            } catch (childErr) {
              const errMsg = childErr instanceof Error ? `${childErr.message}
${childErr.stack}` : String(childErr);
              _ilog(`[createNode] \u274C Child "${((_b = staticChildNode.name) != null ? _b : staticChildNode.type).slice(0, 50)}" (${staticChildNode.type}, id=${staticChildNode.id}) failed: ${errMsg}`);
            }
          }
          if (staticNode.type === "GROUP") {
            const children = Array.from(liveNode.children);
            if (children.length === 0) {
              return liveNode;
            }
            const hasRotation = Array.isArray(staticNode.relativeTransform) && staticNode.relativeTransform.length === 2 && (Math.abs(staticNode.relativeTransform[0][1]) > 1e-3 || Math.abs(staticNode.relativeTransform[1][0]) > 1e-3);
            if (hasRotation) {
              const M = staticNode.relativeTransform;
              const liveM = liveNode.relativeTransform;
              console.log(`[createNode] GROUP "${staticNode.name}" has ROTATION. JSON transform: tx=${M[0][2].toFixed(1)} ty=${M[1][2].toFixed(1)} cos=${M[0][0].toFixed(4)} sin=${M[0][1].toFixed(4)}`);
              console.log(`[createNode] GROUP "${staticNode.name}" tempFrame transform: tx=${(_e = (_d = (_c = liveM == null ? void 0 : liveM[0]) == null ? void 0 : _c[2]) == null ? void 0 : _d.toFixed) == null ? void 0 : _e.call(_d, 1)} ty=${(_h = (_g = (_f = liveM == null ? void 0 : liveM[1]) == null ? void 0 : _f[2]) == null ? void 0 : _g.toFixed) == null ? void 0 : _h.call(_g, 1)} cos=${(_k = (_j = (_i = liveM == null ? void 0 : liveM[0]) == null ? void 0 : _i[0]) == null ? void 0 : _j.toFixed) == null ? void 0 : _k.call(_j, 4)} sin=${(_n = (_m = (_l = liveM == null ? void 0 : liveM[0]) == null ? void 0 : _l[1]) == null ? void 0 : _m.toFixed) == null ? void 0 : _n.call(_m, 4)}`);
            }
            const group = figma.group(
              children,
              liveNode.parent
            );
            group.name = liveNode.name;
            if ("opacity" in staticNode) group.opacity = (_o = staticNode.opacity) != null ? _o : 1;
            if ("visible" in staticNode) group.visible = staticNode.visible;
            if (staticNode.isMask === true) {
              group.isMask = true;
              if ("maskType" in group) {
                group.maskType = resolveMaskType(staticNode);
              }
            }
            if (hasRotation) {
              const gM = group.relativeTransform;
              console.log(`[createNode] GROUP "${staticNode.name}" AFTER figma.group(): tx=${(_r = (_q = (_p = gM == null ? void 0 : gM[0]) == null ? void 0 : _p[2]) == null ? void 0 : _q.toFixed) == null ? void 0 : _r.call(_q, 1)} ty=${(_u = (_t = (_s = gM == null ? void 0 : gM[1]) == null ? void 0 : _s[2]) == null ? void 0 : _t.toFixed) == null ? void 0 : _u.call(_t, 1)} cos=${(_x = (_w = (_v = gM == null ? void 0 : gM[0]) == null ? void 0 : _v[0]) == null ? void 0 : _w.toFixed) == null ? void 0 : _x.call(_w, 4)} sin=${(_A = (_z = (_y = gM == null ? void 0 : gM[0]) == null ? void 0 : _y[1]) == null ? void 0 : _z.toFixed) == null ? void 0 : _A.call(_z, 4)}`);
            }
            if (Array.isArray(staticNode.relativeTransform) && staticNode.relativeTransform.length === 2) {
              try {
                const M = staticNode.relativeTransform;
                group.relativeTransform = [
                  [M[0][0], M[0][1], M[0][2]],
                  [M[1][0], M[1][1], M[1][2]]
                ];
                if (hasRotation) {
                  const aM = group.relativeTransform;
                  console.log(`[createNode] GROUP "${staticNode.name}" AFTER applyTransform: tx=${(_D = (_C = (_B = aM == null ? void 0 : aM[0]) == null ? void 0 : _B[2]) == null ? void 0 : _C.toFixed) == null ? void 0 : _D.call(_C, 1)} ty=${(_G = (_F = (_E = aM == null ? void 0 : aM[1]) == null ? void 0 : _E[2]) == null ? void 0 : _F.toFixed) == null ? void 0 : _G.call(_F, 1)} cos=${(_J = (_I = (_H = aM == null ? void 0 : aM[0]) == null ? void 0 : _H[0]) == null ? void 0 : _I.toFixed) == null ? void 0 : _J.call(_I, 4)} sin=${(_M = (_L = (_K = aM == null ? void 0 : aM[0]) == null ? void 0 : _K[1]) == null ? void 0 : _L.toFixed) == null ? void 0 : _M.call(_L, 4)}`);
                }
              } catch (e) {
                console.warn(`[createNode] Failed to apply transform on GROUP "${staticNode.name}": ${e instanceof Error ? e.message : e}`);
              }
            }
            liveNode.remove();
            return group;
          }
          if (staticNode.type === "BOOLEAN_OPERATION") {
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
        const errMsg = err instanceof Error ? `${err.message}
${err.stack}` : String(err);
        _ilog(`[createNode] \u274C FAILED for "${((_N = staticNode.name) != null ? _N : staticNode.type).slice(0, 50)}" (${staticNode.type}, id=${staticNode.id}): ${errMsg}`);
        try {
          liveNode.remove();
        } catch (e) {
        }
        return null;
      }
    });
  }
  function instantiateNode(staticNode) {
    return __async(this, null, function* () {
      const map = {
        FRAME: () => figma.createFrame(),
        GROUP: () => figma.createFrame(),
        SECTION: () => {
          var _a;
          return ((_a = figma.createSection) == null ? void 0 : _a.call(figma)) || figma.createFrame();
        },
        RECTANGLE: () => figma.createRectangle(),
        ELLIPSE: () => figma.createEllipse(),
        LINE: () => figma.createLine(),
        POLYGON: () => figma.createPolygon(),
        STAR: () => figma.createStar(),
        VECTOR: () => figma.createVector(),
        BOOLEAN_OPERATION: () => figma.createFrame(),
        SLICE: () => figma.createSlice(),
        TEXT: () => figma.createText(),
        SLIDE: () => figma.createFrame(),
        // SlideNodes are created by importJson, not here
        SLIDE_ROW: () => figma.createFrame(),
        SLIDE_GRID: () => figma.createFrame(),
        INSTANCE: () => figma.createFrame(),
        COMPONENT: () => figma.createFrame(),
        COMPONENT_SET: () => figma.createFrame(),
        SHAPE_WITH_TEXT: () => {
          try {
            if (typeof figma.createShapeWithText === "function") {
              return figma.createShapeWithText();
            }
          } catch (e) {
            _ilog(`[instantiateNode] createShapeWithText() failed: ${e instanceof Error ? e.message : e}, falling back`);
          }
          const st = staticNode.shapeType;
          if (st === "ELLIPSE") return figma.createEllipse();
          if (st === "DIAMOND" || st === "TRIANGLE_UP" || st === "TRIANGLE_DOWN" || st === "HEXAGON" || st === "PENTAGON" || st === "OCTAGON" || st === "STAR" || st === "PLUS" || st === "CHEVRON" || st === "SHIELD" || st === "ARROW_LEFT" || st === "ARROW_RIGHT") {
            return figma.createPolygon();
          }
          return figma.createRectangle();
        },
        TABLE: () => figma.createFrame(),
        TABLE_CELL: () => figma.createFrame(),
        CANVAS: () => null
      };
      const ctor = map[staticNode.type];
      return ctor ? ctor() : null;
    });
  }
  function applyVectorData(liveNode, staticNode) {
    var _a;
    try {
      if (staticNode.type !== "VECTOR") return;
      const vector = liveNode;
      const hasFillGeo = Array.isArray(staticNode.fillGeometry) && staticNode.fillGeometry.length;
      const hasStrokeGeo = Array.isArray(staticNode.strokeGeometry) && staticNode.strokeGeometry.length;
      if (hasFillGeo) {
        vector.vectorPaths = staticNode.fillGeometry.map((g) => {
          var _a2;
          return {
            windingRule: (_a2 = g.windingRule) != null ? _a2 : "NONZERO",
            data: sanitisePathData(g.path)
          };
        });
      } else if (hasStrokeGeo) {
        vector.vectorPaths = staticNode.strokeGeometry.map((g) => {
          var _a2;
          return {
            windingRule: (_a2 = g.windingRule) != null ? _a2 : "NONZERO",
            data: sanitisePathData(g.path)
          };
        });
        const strokePaints = Array.isArray(staticNode.strokes) ? clone(staticNode.strokes) : [];
        staticNode.fills = strokePaints.concat((_a = staticNode.fills) != null ? _a : []);
        staticNode.strokes = [];
        delete staticNode.strokeWeight;
      }
    } catch (e) {
      console.error("applyVectorData \u2192", e);
    }
  }
  function applyCommonProps(liveNode, staticNode) {
    var _a;
    try {
      liveNode.name = (_a = staticNode.name) != null ? _a : staticNode.type;
      if ("visible" in staticNode) liveNode.visible = staticNode.visible;
      if ("opacity" in staticNode) liveNode.opacity = staticNode.opacity;
    } catch (e) {
      console.error("Error applying common props:", e);
    }
  }
  function applyTransform(liveNode, staticNode, staticParentNode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    try {
      const parentIsAutoLayout = typeof staticParentNode.layoutMode === "string" && staticParentNode.layoutMode !== "NONE";
      const absoluteLater = parentIsAutoLayout && wantsAbsolute(staticNode);
      const w = (_d = (_c = (_a = staticNode.size) == null ? void 0 : _a.x) != null ? _c : (_b = staticNode.absoluteBoundingBox) == null ? void 0 : _b.width) != null ? _d : liveNode.width;
      const h = (_h = (_g = (_e = staticNode.size) == null ? void 0 : _e.y) != null ? _g : (_f = staticNode.absoluteBoundingBox) == null ? void 0 : _f.height) != null ? _h : liveNode.height;
      const SLIDE_TYPES2 = ["SLIDE", "SLIDE_ROW", "SLIDE_GRID"];
      if ("resize" in liveNode && w != null && h != null && liveNode.type !== "VECTOR" && !SLIDE_TYPES2.includes(liveNode.type)) {
        liveNode.resize(w, h);
      }
      const canEditXYNow = !parentIsAutoLayout && !absoluteLater;
      const isRoot = staticParentNode.type === "DOCUMENT" || staticParentNode.type === "PAGE";
      if (canEditXYNow && Array.isArray(staticNode.relativeTransform) && staticNode.relativeTransform.length === 2 && !isRoot && "relativeTransform" in liveNode) {
        const M = staticNode.relativeTransform;
        const safe = [
          [tideFloat(M[0][0]), tideFloat(M[0][1]), tideFloat(M[0][2])],
          [tideFloat(M[1][0]), tideFloat(M[1][1]), tideFloat(M[1][2])]
        ];
        try {
          liveNode.relativeTransform = safe;
          return;
        } catch (error) {
          console.error(
            "Error applying relativeTransform:",
            error,
            "\u2192 falling back to absolute positioning"
          );
        }
      }
      if (canEditXYNow && staticNode.absoluteBoundingBox) {
        const { x, y } = staticNode.absoluteBoundingBox;
        liveNode.x = x - ((_j = (_i = staticParentNode.absoluteBoundingBox) == null ? void 0 : _i.x) != null ? _j : 0);
        liveNode.y = y - ((_l = (_k = staticParentNode.absoluteBoundingBox) == null ? void 0 : _k.y) != null ? _l : 0);
        if (typeof staticNode.rotation === "number") {
          const raw = Math.abs(staticNode.rotation) <= 2 * Math.PI ? staticNode.rotation * 180 / Math.PI : staticNode.rotation;
          liveNode.rotation = raw;
        }
      }
    } catch (e) {
      console.error("Error applying transform:", e);
    }
  }
  function applyGeometry(liveNode, staticNode) {
    try {
      const DEFAULT_GRADIENT_HANDLES = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 }
      ];
      if ("fills" in liveNode) {
        assignPaints("fills", liveNode, staticNode);
      }
      if ("strokes" in liveNode) {
        assignPaints("strokes", liveNode, staticNode);
      }
      if ("strokeWeight" in staticNode && "strokeWeight" in liveNode) {
        liveNode.strokeWeight = staticNode.strokeWeight;
      }
      if ("cornerRadius" in liveNode) {
        const tgt = liveNode;
        const asNum = (v) => typeof v === "number" ? v : 0;
        if (Array.isArray(staticNode.rectangleCornerRadii) && staticNode.rectangleCornerRadii.length === 4) {
          const [tl, tr, br, bl] = staticNode.rectangleCornerRadii.map(asNum);
          tgt.topLeftRadius = tl;
          tgt.topRightRadius = tr;
          tgt.bottomRightRadius = br;
          tgt.bottomLeftRadius = bl;
        } else {
          if (staticNode.topLeftRadius !== void 0)
            tgt.topLeftRadius = asNum(staticNode.topLeftRadius);
          if (staticNode.topRightRadius !== void 0)
            tgt.topRightRadius = asNum(staticNode.topRightRadius);
          if (staticNode.bottomRightRadius !== void 0)
            tgt.bottomRightRadius = asNum(staticNode.bottomRightRadius);
          if (staticNode.bottomLeftRadius !== void 0)
            tgt.bottomLeftRadius = asNum(staticNode.bottomLeftRadius);
        }
        if (staticNode.rectangleCornerRadii === void 0 && staticNode.topLeftRadius === void 0 && staticNode.cornerRadius !== void 0) {
          tgt.cornerRadius = asNum(staticNode.cornerRadius);
        }
        if (staticNode.cornerSmoothing !== void 0) {
          try {
            tgt.cornerSmoothing = staticNode.cornerSmoothing;
          } catch (e) {
          }
        }
      }
      if ("effects" in staticNode && "effects" in liveNode) {
        liveNode.effects = staticNode.effects;
      }
    } catch (e) {
      console.error("Error applying geometry:", e);
    }
  }
  function applyBackground(liveNode, staticNode) {
    const hasBgInput = staticNode.backgroundColor != null || Array.isArray(staticNode.background) && staticNode.background.length > 0 || typeof staticNode.backgroundStyleId === "string";
    if (!hasBgInput) return;
    if (liveNode.type === "PAGE" || staticNode.type === "PAGE") {
      if (staticNode.backgroundColor) {
        const { r, g, b } = staticNode.backgroundColor;
        liveNode.backgroundColor = { r, g, b };
      }
      if (typeof staticNode.backgroundStyleId === "string" && "backgroundStyleId" in liveNode) {
        try {
          liveNode.backgroundStyleId = staticNode.backgroundStyleId;
        } catch (err) {
          console.error("Error applying background style:", err);
        }
      }
      return;
    }
    if ("background" in liveNode) {
      const frameLike = liveNode;
      if (typeof staticNode.backgroundStyleId === "string" && "backgroundStyleId" in frameLike) {
        try {
          frameLike.backgroundStyleId = staticNode.backgroundStyleId;
        } catch (e) {
          console.error(
            "Error applying background style:",
            staticNode.backgroundStyleId
          );
        }
      }
      if (Array.isArray(staticNode.background) && staticNode.background.length) {
        const paints = staticNode.background.map(formatPaint).filter(Boolean);
        if (JSON.stringify(paints) !== JSON.stringify(frameLike.background)) {
          frameLike.background = paints;
        }
        return;
      }
      if (staticNode.backgroundColor && (!frameLike.background || frameLike.background.length === 0) && typeof staticNode.backgroundStyleId !== "string") {
        const { r, g, b, a } = staticNode.backgroundColor;
        frameLike.background = [
          { type: "SOLID", color: { r, g, b }, opacity: a != null ? a : 1 }
        ];
      }
      return;
    }
    if ("fills" in liveNode) {
      const geo = liveNode;
      const jsonHasPaint = Array.isArray(staticNode.fills) && staticNode.fills.length > 0 || typeof staticNode.fillStyleId === "string";
      const liveHasPaint = Array.isArray(geo.fills) && geo.fills.length > 0 || typeof geo.fillStyleId === "string";
      if (!liveHasPaint && staticNode.backgroundColor) {
        const { r, g, b, a } = staticNode.backgroundColor;
        geo.fills = [{ type: "SOLID", color: { r, g, b }, opacity: a != null ? a : 1 }];
      }
    }
  }
  function applyStrokeProps(liveNode, staticNode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    if (!("strokes" in liveNode)) return;
    const target = liveNode;
    if ("strokeCap" in staticNode) target.strokeCap = staticNode.strokeCap;
    if ("strokeJoin" in staticNode) target.strokeJoin = staticNode.strokeJoin;
    if ("strokeAlign" in staticNode) target.strokeAlign = staticNode.strokeAlign;
    if ("dashPattern" in staticNode) target.dashPattern = staticNode.dashPattern;
    if ("strokeMiterLimit" in staticNode)
      target.strokeMiterLimit = staticNode.strokeMiterLimit;
    const dash = Array.isArray(staticNode.dashPattern) ? staticNode.dashPattern : Array.isArray(staticNode.strokeDashes) ? staticNode.strokeDashes : void 0;
    if (dash && dash.length) {
      target.dashPattern = [...dash];
    }
    const indivdualWeights = staticNode.individualStrokeWeights;
    if (!indivdualWeights || typeof indivdualWeights !== "object") return;
    const top = typeof indivdualWeights.top === "number" ? indivdualWeights.top : void 0;
    const right = typeof indivdualWeights.right === "number" ? indivdualWeights.right : void 0;
    const bottom = typeof indivdualWeights.bottom === "number" ? indivdualWeights.bottom : void 0;
    const left = typeof indivdualWeights.left === "number" ? indivdualWeights.left : void 0;
    if ("individualStrokeWeights" in liveNode) {
      liveNode.individualStrokeWeights = {
        top: (_c = (_b = top != null ? top : (_a = liveNode.individualStrokeWeights) == null ? void 0 : _a.top) != null ? _b : liveNode.strokeWeight) != null ? _c : 0,
        right: (_f = (_e = right != null ? right : (_d = liveNode.individualStrokeWeights) == null ? void 0 : _d.right) != null ? _e : liveNode.strokeWeight) != null ? _f : 0,
        bottom: (_i = (_h = bottom != null ? bottom : (_g = liveNode.individualStrokeWeights) == null ? void 0 : _g.bottom) != null ? _h : liveNode.strokeWeight) != null ? _i : 0,
        left: (_l = (_k = left != null ? left : (_j = liveNode.individualStrokeWeights) == null ? void 0 : _j.left) != null ? _k : liveNode.strokeWeight) != null ? _l : 0
      };
      return;
    }
    if ("strokeTopWeight" in liveNode && top !== void 0)
      liveNode.strokeTopWeight = top;
    if ("strokeRightWeight" in liveNode && right !== void 0)
      liveNode.strokeRightWeight = right;
    if ("strokeBottomWeight" in liveNode && bottom !== void 0)
      liveNode.strokeBottomWeight = bottom;
    if ("strokeLeftWeight" in liveNode && left !== void 0)
      liveNode.strokeLeftWeight = left;
  }
  function applyShapeProps(liveNode, staticNode) {
    var _a, _b, _c;
    switch (staticNode.type) {
      case "ELLIPSE": {
        if ("arcData" in staticNode) {
          const src = staticNode.arcData;
          const inner = typeof src.innerRadius === "number" && src.innerRadius > 1 ? src.innerRadius / 100 : (_a = src.innerRadius) != null ? _a : 0;
          liveNode.arcData = {
            startingAngle: (_b = src.startingAngle) != null ? _b : 0,
            endingAngle: (_c = src.endingAngle) != null ? _c : 0,
            innerRadius: inner
          };
        }
        break;
      }
      case "RECTANGLE": {
        const r = liveNode;
        if ("cornerSmoothing" in staticNode)
          r.cornerSmoothing = staticNode.cornerSmoothing;
        if (Array.isArray(staticNode.rectangleCornerRadii)) {
          const [tl, tr, br, bl] = staticNode.rectangleCornerRadii;
          r.topLeftRadius = tl;
          r.topRightRadius = tr;
          r.bottomRightRadius = br;
          r.bottomLeftRadius = bl;
        } else {
          if ("topLeftRadius" in staticNode)
            r.topLeftRadius = staticNode.topLeftRadius;
          if ("topRightRadius" in staticNode)
            r.topRightRadius = staticNode.topRightRadius;
          if ("bottomRightRadius" in staticNode)
            r.bottomRightRadius = staticNode.bottomRightRadius;
          if ("bottomLeftRadius" in staticNode)
            r.bottomLeftRadius = staticNode.bottomLeftRadius;
        }
        break;
      }
      case "POLYGON": {
        const p = liveNode;
        if ("pointCount" in staticNode) p.pointCount = staticNode.pointCount;
        if ("cornerRadius" in staticNode) {
          p.cornerRadius = staticNode.cornerRadius > 1 ? staticNode.cornerRadius / 100 : staticNode.cornerRadius;
        }
        if ("cornerSmoothing" in staticNode) {
          p.cornerSmoothing = staticNode.cornerSmoothing;
        }
        break;
      }
      case "STAR": {
        const s = liveNode;
        if ("pointCount" in staticNode) s.pointCount = staticNode.pointCount;
        if ("innerRadius" in staticNode)
          s.innerRadius = staticNode.innerRadius > 1 ? staticNode.innerRadius / 100 : staticNode.innerRadius;
        break;
      }
      case "LINE":
        break;
      case "SHAPE_WITH_TEXT": {
        if (staticNode.shapeType && liveNode.type === "SHAPE_WITH_TEXT") {
          try {
            liveNode.shapeType = staticNode.shapeType;
          } catch (e) {
            console.error("Error setting shapeType:", e);
          }
        }
        break;
      }
    }
  }
  function applyText(liveNode, staticNode) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
      if (staticNode.type === "SHAPE_WITH_TEXT") {
        if (liveNode.type !== "SHAPE_WITH_TEXT") return;
        const shapeNode = liveNode;
        const textTarget = shapeNode.text;
        const chars = (_a = staticNode.characters) != null ? _a : "";
        if (chars) {
          try {
            yield figma.loadFontAsync(textTarget.fontName);
            textTarget.characters = chars;
            const rootStyle2 = (_b = staticNode.style) != null ? _b : {};
            if (rootStyle2.fontFamily) {
              const font = {
                family: rootStyle2.fontFamily,
                style: (_c = rootStyle2.fontStyle) != null ? _c : "Regular"
              };
              try {
                yield figma.loadFontAsync(font);
                textTarget.fontName = font;
              } catch (e) {
              }
            }
            if ("fontSize" in rootStyle2) {
              textTarget.fontSize = rootStyle2.fontSize;
            }
          } catch (e) {
            console.error("Error applying SHAPE_WITH_TEXT text:", e);
          }
        }
        return;
      }
      if (staticNode.type === "TABLE_CELL") {
        const cellChars = (_d = staticNode.characters) != null ? _d : "";
        if (cellChars && "appendChild" in liveNode) {
          try {
            const cellFrame = liveNode;
            const rt = staticNode.relativeTransform;
            const isHeader = Array.isArray(rt) && rt.length >= 2 && Math.abs(rt[1] && rt[1][2] || 0) < 0.5;
            const headerStyle = { family: "Inter", style: "Semi Bold" };
            const bodyStyle = { family: "Inter", style: "Regular" };
            const cellTxt = figma.createText();
            const requested = isHeader ? headerStyle : bodyStyle;
            try {
              yield figma.loadFontAsync(requested);
              cellTxt.fontName = requested;
            } catch (e) {
              try {
                const fallback = isHeader ? { family: "Inter", style: "Bold" } : bodyStyle;
                yield figma.loadFontAsync(fallback);
                cellTxt.fontName = fallback;
              } catch (e2) {
                try {
                  yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
                  cellTxt.fontName = { family: "Inter", style: "Regular" };
                } catch (e3) {
                }
              }
            }
            cellTxt.characters = cellChars.replace(/\s+$/, "");
            try {
              cellTxt.fontSize = 24;
            } catch (e) {
            }
            try {
              cellTxt.textAlignHorizontal = "LEFT";
            } catch (e) {
            }
            try {
              cellTxt.textAlignVertical = "CENTER";
            } catch (e) {
            }
            try {
              cellFrame.layoutMode = "VERTICAL";
              cellFrame.primaryAxisAlignItems = "CENTER";
              cellFrame.counterAxisAlignItems = "MIN";
              cellFrame.paddingLeft = 24;
              cellFrame.paddingRight = 24;
              cellFrame.paddingTop = 16;
              cellFrame.paddingBottom = 16;
              cellFrame.primaryAxisSizingMode = "FIXED";
              cellFrame.counterAxisSizingMode = "FIXED";
            } catch (e) {
            }
            try {
              cellFrame.strokes = [{
                type: "SOLID",
                color: { r: 0.45, g: 0.45, b: 0.45 },
                opacity: 1
              }];
              cellFrame.strokeWeight = 1;
              cellFrame.strokeAlign = "INSIDE";
            } catch (e) {
            }
            const cellW = cellFrame.width || 0;
            if (cellW > 48) {
              try {
                cellTxt.textAutoResize = "HEIGHT";
                cellTxt.resize(cellW - 48, cellTxt.height);
              } catch (e) {
              }
            }
            cellFrame.appendChild(cellTxt);
          } catch (e) {
            _ilog(`[applyText] TABLE_CELL "${cellChars.slice(0, 40)}" failed to inject text: ${e instanceof Error ? e.message : e}`);
          }
        }
        return;
      }
      if (staticNode.type !== "TEXT") return;
      const txt = liveNode;
      const _tl = (msg) => {
        var _a2;
        return _ilog(`[applyText] id=${staticNode.id} "${((_a2 = staticNode.characters) != null ? _a2 : "").slice(0, 40)}" \u2192 ${msg}`);
      };
      const FALLBACK_FAMILY = "Inter";
      function loadFontOrFallback(requested) {
        return __async(this, null, function* () {
          try {
            yield figma.loadFontAsync(requested);
            return requested;
          } catch (e) {
            _tl(`font fallback: ${requested.family}/${requested.style} \u2192 trying ${FALLBACK_FAMILY}/${requested.style}`);
            const sameStyle = {
              family: FALLBACK_FAMILY,
              style: requested.style
            };
            try {
              yield figma.loadFontAsync(sameStyle);
              return sameStyle;
            } catch (e2) {
              _tl(`font fallback: ${FALLBACK_FAMILY}/${requested.style} \u2192 trying ${FALLBACK_FAMILY}/Regular`);
              const regular = { family: FALLBACK_FAMILY, style: "Regular" };
              yield figma.loadFontAsync(regular);
              return regular;
            }
          }
        });
      }
      const toPaints = (fills = []) => fills.map(formatPaint).filter((p) => p !== void 0);
      const rootStyle = (_e = staticNode.style) != null ? _e : {};
      const overrides = (_f = staticNode.characterStyleOverrides) != null ? _f : [];
      const table = (_g = staticNode.styleOverrideTable) != null ? _g : {};
      _tl(`chars=${((_h = staticNode.characters) != null ? _h : "").length}, overrides=${overrides.length}, tableKeys=[${Object.keys(table)}], rootFont=${rootStyle.fontFamily}/${rootStyle.fontStyle}/${rootStyle.fontSize}`);
      const lookupFont = (s) => {
        var _a2, _b2;
        return {
          family: (_a2 = s.fontFamily) != null ? _a2 : txt.fontName.family,
          style: (_b2 = s.fontStyle) != null ? _b2 : txt.fontName.style
        };
      };
      _tl("loading default font");
      yield figma.loadFontAsync(txt.fontName);
      const fontMap = /* @__PURE__ */ new Map();
      function register(fn) {
        return __async(this, null, function* () {
          const resolved = yield loadFontOrFallback(fn);
          fontMap.set(JSON.stringify(fn), resolved);
          _tl(`font registered: ${fn.family}/${fn.style} \u2192 ${resolved.family}/${resolved.style}`);
        });
      }
      yield register(lookupFont(rootStyle));
      for (const [key, s] of Object.entries(table)) {
        _tl(`registering font for override key="${key}": ${JSON.stringify(s)}`);
        yield register(lookupFont(s));
      }
      const safe = (fn) => fontMap.get(JSON.stringify(fn));
      const _targetAutoResize = (_j = (_i = staticNode.textAutoResize) != null ? _i : rootStyle.textAutoResize) != null ? _j : "NONE";
      txt.textAutoResize = "WIDTH_AND_HEIGHT";
      _tl(`BEFORE characters: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize} target=${_targetAutoResize}`);
      _tl("setting characters");
      txt.characters = (_k = staticNode.characters) != null ? _k : "";
      _tl(`AFTER characters: width=${txt.width}`);
      _tl("setting fontName");
      txt.fontName = safe(lookupFont(rootStyle));
      _tl(`AFTER fontName: width=${txt.width}`);
      if ("fontSize" in rootStyle) {
        _tl(`setting fontSize=${rootStyle.fontSize}`);
        txt.fontSize = rootStyle.fontSize;
        _tl(`AFTER fontSize: width=${txt.width}`);
      }
      const resolveAlignment = () => {
        var _a2, _b2, _c2, _d2;
        const hRaw = (_b2 = (_a2 = staticNode.textAlignHorizontal) != null ? _a2 : rootStyle.textAlignHorizontal) != null ? _b2 : "LEFT";
        const vRaw = (_d2 = (_c2 = staticNode.textAlignVertical) != null ? _c2 : rootStyle.textAlignVertical) != null ? _d2 : "TOP";
        const normaliseAlign = (raw) => {
          if (typeof raw !== "string") return void 0;
          const up = raw.toUpperCase();
          return up === "MIDDLE" ? "CENTER" : up;
        };
        const h2 = normaliseAlign(hRaw);
        const v2 = normaliseAlign(vRaw);
        const horiz = ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"].includes(h2) ? h2 : "LEFT";
        const vert = ["TOP", "CENTER", "BOTTOM"].includes(v2) ? v2 : "TOP";
        return { h: horiz, v: vert };
      };
      const { h, v } = resolveAlignment();
      txt.textAlignHorizontal = h;
      if (_targetAutoResize === "NONE") {
        txt.textAlignVertical = v;
      }
      if ("textCase" in rootStyle) {
        try {
          txt.textCase = rootStyle.textCase;
        } catch (e) {
        }
      }
      if ("textDecoration" in rootStyle)
        txt.textDecoration = rootStyle.textDecoration;
      if ("paragraphIndent" in rootStyle)
        txt.paragraphIndent = rootStyle.paragraphIndent;
      if ("paragraphSpacing" in rootStyle)
        txt.paragraphSpacing = rootStyle.paragraphSpacing;
      const hasBulletText = txt.characters.includes("\u2022") || txt.characters.includes("\xB7");
      if (hasBulletText || rootStyle.listOptions) {
        _tl(`BULLET IMPORT DIAG: name="${staticNode.name || "N/A"}" rootStyle.listOptions=${JSON.stringify(rootStyle.listOptions)} hasBulletText=${hasBulletText} chars="${txt.characters.substring(0, 60)}"`);
      }
      if (rootStyle.listOptions && rootStyle.listOptions.type && txt.characters.length > 0) {
        try {
          _tl(`setting root listOptions=${rootStyle.listOptions.type}`);
          txt.setRangeListOptions(0, txt.characters.length, rootStyle.listOptions);
        } catch (e) {
          _tl(`setRangeListOptions root FAILED: ${e instanceof Error ? e.message : e}`);
        }
      }
      if (rootStyle.indentation !== void 0 && rootStyle.indentation > 0 && txt.characters.length > 0) {
        try {
          _tl(`setting root indentation=${rootStyle.indentation}`);
          txt.setRangeIndentation(0, txt.characters.length, rootStyle.indentation);
        } catch (e) {
          _tl(`setRangeIndentation root FAILED: ${e instanceof Error ? e.message : e}`);
        }
      }
      const lineTypes = staticNode.lineTypes;
      const lineIndentations = staticNode.lineIndentations;
      if (Array.isArray(lineTypes) && lineTypes.length > 0 && txt.characters.length > 0) {
        _tl(`applying lineTypes=${JSON.stringify(lineTypes)} lineIndentations=${JSON.stringify(lineIndentations)}`);
        const lines = txt.characters.split("\n");
        let charOffset = 0;
        for (let li = 0; li < lines.length && li < lineTypes.length; li++) {
          const lineStart = charOffset;
          const lineEnd = charOffset + lines[li].length;
          charOffset = lineEnd + 1;
          if (lineEnd <= lineStart) continue;
          const lt = lineTypes[li];
          if (lt && lt !== "NONE") {
            try {
              _tl(`  setRangeListOptions line[${li}] [${lineStart},${lineEnd}) \u2192 ${lt}`);
              txt.setRangeListOptions(lineStart, lineEnd, { type: lt });
            } catch (e) {
              _tl(`  setRangeListOptions line[${li}] FAILED: ${e instanceof Error ? e.message : e}`);
            }
          }
          const indent = (_l = lineIndentations == null ? void 0 : lineIndentations[li]) != null ? _l : 0;
          if (indent > 0) {
            try {
              _tl(`  setRangeIndentation line[${li}] [${lineStart},${lineEnd}) \u2192 ${indent}`);
              txt.setRangeIndentation(lineStart, lineEnd, indent);
            } catch (e) {
              _tl(`  setRangeIndentation line[${li}] FAILED: ${e instanceof Error ? e.message : e}`);
            }
          }
        }
      }
      if (rootStyle.lineHeightUnit === "AUTO") {
        txt.lineHeight = { unit: "AUTO" };
      } else if ("lineHeightPx" in rootStyle) {
        txt.lineHeight = { value: rootStyle.lineHeightPx, unit: "PIXELS" };
      } else if ("lineHeightPercent" in rootStyle) {
        txt.lineHeight = { value: rootStyle.lineHeightPercent, unit: "PERCENT" };
      }
      if ("letterSpacing" in rootStyle) {
        txt.letterSpacing = {
          value: rootStyle.letterSpacing,
          unit: rootStyle.letterSpacingUnit === "PERCENT" ? "PERCENT" : "PIXELS"
        };
      }
      if ((staticNode.leadingTrim !== void 0 || rootStyle.leadingTrim !== void 0) && "leadingTrim" in txt) {
        try {
          txt.leadingTrim = (_m = staticNode.leadingTrim) != null ? _m : rootStyle.leadingTrim;
        } catch (err) {
          console.warn("applyText \u2192 could not set leadingTrim:", err);
        }
      }
      if ("fills" in staticNode && (!txt.fills || txt.fills.length === 0)) {
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
            const hasFont = "fontFamily" in o || "fontStyle" in o || "fontWeight" in o || "fontPostScriptName" in o;
            if (hasFont) {
              try {
                const sf = safe(lookupFont(o));
                _tl(`  setRangeFontName [${start},${end}) \u2192 ${sf == null ? void 0 : sf.family}/${sf == null ? void 0 : sf.style}`);
                txt.setRangeFontName(start, end, sf);
              } catch (e) {
                _tl(`  \u274C setRangeFontName FAILED: ${e instanceof Error ? e.message : e}`);
                throw e;
              }
            } else {
              _tl(`  skipping setRangeFontName [${start},${end}) \u2014 no font info in override`);
            }
            if ("fontSize" in o) {
              _tl(`  setRangeFontSize [${start},${end}) \u2192 ${o.fontSize}`);
              txt.setRangeFontSize(start, end, o.fontSize);
            }
            if ("textCase" in o) {
              try {
                txt.setRangeTextCase(start, end, o.textCase);
              } catch (e) {
              }
            }
            if ("textDecoration" in o)
              txt.setRangeTextDecoration(start, end, o.textDecoration);
            if (o.lineHeightUnit === "AUTO") {
              txt.setRangeLineHeight(start, end, { unit: "AUTO" });
            } else if ("lineHeightPx" in o) {
              txt.setRangeLineHeight(start, end, {
                value: o.lineHeightPx,
                unit: "PIXELS"
              });
            } else if ("lineHeightPercent" in o) {
              txt.setRangeLineHeight(start, end, {
                value: o.lineHeightPercent,
                unit: "PERCENT"
              });
            }
            if ("letterSpacing" in o) {
              txt.setRangeLetterSpacing(start, end, {
                value: o.letterSpacing,
                unit: o.letterSpacingUnit === "PERCENT" ? "PERCENT" : "PIXELS"
              });
            }
            if (o.listOptions && o.listOptions.type) {
              try {
                _tl(`  setRangeListOptions [${start},${end}) \u2192 ${o.listOptions.type}`);
                txt.setRangeListOptions(start, end, o.listOptions);
              } catch (e) {
                _tl(`  setRangeListOptions [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
              }
            }
            if ("indentation" in o && typeof o.indentation === "number" && o.indentation > 0) {
              try {
                _tl(`  setRangeIndentation [${start},${end}) \u2192 ${o.indentation}`);
                txt.setRangeIndentation(start, end, o.indentation);
              } catch (e) {
                _tl(`  setRangeIndentation [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
              }
            }
            if (o.openTypeFeatures && typeof o.openTypeFeatures === "object" && Object.keys(o.openTypeFeatures).length > 0) {
              try {
                _tl(`  setRangeOpenTypeFeatures [${start},${end})`);
                txt.setRangeOpenTypeFeatures(start, end, o.openTypeFeatures);
              } catch (e) {
                _tl(`  setRangeOpenTypeFeatures [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
              }
            }
            if (o.hyperlink) {
              try {
                _tl(`  setRangeHyperlink [${start},${end}) \u2192 ${o.hyperlink.type}`);
                txt.setRangeHyperlink(start, end, o.hyperlink);
              } catch (e) {
                _tl(`  setRangeHyperlink [${start},${end}) FAILED: ${e instanceof Error ? e.message : e}`);
              }
            }
            if (Array.isArray(o.fills) && o.fills.length) {
              try {
                const rangePaints = toPaints(o.fills);
                _tl(`  setRangeFills [${start},${end}) \u2192 ${rangePaints.length} paint(s)`);
                txt.setRangeFills(start, end, rangePaints);
              } catch (e) {
                _tl(`  \u274C setRangeFills FAILED: ${e instanceof Error ? e.message : e}`);
                throw e;
              }
            }
            if ("inheritFillStyleId" in o) {
              try {
                _tl(`  setRangeFillStyleId [${start},${end}) \u2192 "${o.inheritFillStyleId}"`);
                txt.setRangeFillStyleId(start, end, o.inheritFillStyleId);
              } catch (e) {
                _tl(`  setRangeFillStyleId skipped (expected): ${e instanceof Error ? e.message : e}`);
              }
            }
          } else {
            _tl(`  range [${start},${end}) styleId=${styleId} \u2192 NOT found in table, skipping`);
          }
          start = end;
        }
        _tl("overrides done");
      }
      const origW = (_p = (_n = staticNode.size) == null ? void 0 : _n.x) != null ? _p : (_o = staticNode.absoluteBoundingBox) == null ? void 0 : _o.width;
      const origH = (_s = (_q = staticNode.size) == null ? void 0 : _q.y) != null ? _s : (_r = staticNode.absoluteBoundingBox) == null ? void 0 : _r.height;
      _tl(`FINAL: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize} origW=${origW} origH=${origH} target=${_targetAutoResize}`);
      txt.textAutoResize = _targetAutoResize;
      if (origW != null && origH != null && (_targetAutoResize === "NONE" || _targetAutoResize === "TRUNCATE")) {
        try {
          txt.resize(origW, origH);
        } catch (e) {
        }
      } else if (origW != null && _targetAutoResize === "HEIGHT") {
        try {
          txt.resize(origW, txt.height);
        } catch (e) {
        }
      }
      _tl(`AFTER resize: width=${txt.width} height=${txt.height} autoResize=${txt.textAutoResize}`);
      _tl("applyText complete");
    });
  }
  function applyAutoLayout(liveNode, staticNode) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
    try {
      if ("clipsContent" in liveNode) {
        const clip = (_a = staticNode.clipsContent) != null ? _a : staticNode.clipContent;
        if (typeof clip === "boolean") {
          liveNode.clipsContent = clip;
        }
      }
      if (!("layoutMode" in staticNode) || !("layoutMode" in liveNode)) return;
      const frame = liveNode;
      frame.layoutMode = staticNode.layoutMode;
      const isContainer = frame.layoutMode !== "NONE";
      if (isContainer) {
        if ("layoutSizingHorizontal" in staticNode && staticNode.layoutSizingHorizontal !== "FILL") {
          frame.layoutSizingHorizontal = staticNode.layoutSizingHorizontal;
        }
        if ("layoutSizingVertical" in staticNode && staticNode.layoutSizingVertical !== "FILL") {
          frame.layoutSizingVertical = staticNode.layoutSizingVertical;
        }
        if ("primaryAxisSizingMode" in staticNode)
          frame.primaryAxisSizingMode = staticNode.primaryAxisSizingMode;
        if ("counterAxisSizingMode" in staticNode)
          frame.counterAxisSizingMode = staticNode.counterAxisSizingMode;
        if ("primaryAxisAlignItems" in staticNode)
          frame.primaryAxisAlignItems = staticNode.primaryAxisAlignItems;
        if ("counterAxisAlignItems" in staticNode)
          frame.counterAxisAlignItems = staticNode.counterAxisAlignItems;
        if ("layoutWrap" in staticNode) frame.layoutWrap = staticNode.layoutWrap;
        if ("counterAxisSpacing" in staticNode)
          frame.counterAxisSpacing = (_b = staticNode.counterAxisSpacing) != null ? _b : 0;
        if (staticNode.layoutMode === "GRID") {
          if ("gridRowCount" in staticNode)
            frame.gridRowCount = staticNode.gridRowCount;
          if ("gridColumnCount" in staticNode)
            frame.gridColumnCount = staticNode.gridColumnCount;
          if ("gridRowGap" in staticNode)
            frame.gridRowGap = staticNode.gridRowGap;
          if ("gridColumnGap" in staticNode)
            frame.gridColumnGap = staticNode.gridColumnGap;
          if ("gridColumnsSizing" in staticNode)
            frame.gridColumnsSizing = staticNode.gridColumnsSizing;
          if ("gridRowsSizing" in staticNode)
            frame.gridRowsSizing = staticNode.gridRowsSizing;
        }
        frame.itemSpacing = (_d = (_c = staticNode.itemSpacing) != null ? _c : frame.itemSpacing) != null ? _d : 0;
        frame.paddingLeft = (_g = (_f = (_e = staticNode.paddingLeft) != null ? _e : staticNode.horizontalPadding) != null ? _f : frame.paddingLeft) != null ? _g : 0;
        frame.paddingRight = (_j = (_i = (_h = staticNode.paddingRight) != null ? _h : staticNode.horizontalPadding) != null ? _i : frame.paddingRight) != null ? _j : 0;
        frame.paddingTop = (_m = (_l = (_k = staticNode.paddingTop) != null ? _k : staticNode.verticalPadding) != null ? _l : frame.paddingTop) != null ? _m : 0;
        frame.paddingBottom = (_p = (_o = (_n = staticNode.paddingBottom) != null ? _n : staticNode.verticalPadding) != null ? _o : frame.paddingBottom) != null ? _p : 0;
      }
    } catch (err) {
      console.error("applyAutoLayout \u2192", err);
    }
  }
  function applyConstraints(liveNode, staticNode, parent) {
    var _a;
    try {
      if ("constraints" in staticNode) {
        (_a = liveNode.setPluginData) == null ? void 0 : _a.call(
          liveNode,
          "__constraints",
          JSON.stringify(staticNode.constraints)
        );
      }
      const parentIsAutoLayout = parent && "layoutMode" in parent && parent.layoutMode !== "NONE";
      if (parentIsAutoLayout) {
        if ("layoutAlign" in staticNode && "layoutAlign" in liveNode)
          liveNode.layoutAlign = staticNode.layoutAlign;
        if ("layoutGrow" in staticNode && "layoutGrow" in liveNode)
          liveNode.layoutGrow = staticNode.layoutGrow;
        if ("layoutSizingHorizontal" in staticNode && "layoutSizingHorizontal" in liveNode)
          liveNode.layoutSizingHorizontal = staticNode.layoutSizingHorizontal;
        if ("layoutSizingVertical" in staticNode && "layoutSizingVertical" in liveNode)
          liveNode.layoutSizingVertical = staticNode.layoutSizingVertical;
      }
    } catch (err) {
      console.error("applyConstraints \u2192", err);
    }
  }
  function resolveMaskType(staticNode) {
    if (typeof staticNode.maskType === "string") {
      const t = staticNode.maskType.toUpperCase();
      if (t === "ALPHA" || t === "VECTOR" || t === "LUMINANCE")
        return t;
    }
    if (staticNode.isMaskOutline === true) return "VECTOR";
    return "ALPHA";
  }
  function applyBlend(liveNode, staticNode) {
    try {
      if ("opacity" in staticNode && "opacity" in liveNode) {
        liveNode.opacity = staticNode.opacity;
      }
      if ("blendMode" in staticNode && "blendMode" in liveNode) {
        liveNode.blendMode = staticNode.blendMode;
      }
      if ("isMask" in staticNode && "isMask" in liveNode) {
        liveNode.isMask = staticNode.isMask;
      }
      if ("maskType" in liveNode) {
        liveNode.maskType = resolveMaskType(staticNode);
      }
    } catch (e) {
      console.error("Error applying blend / maskType:", e);
    }
  }
  function applyBoolean(placeholder, staticNode, parentNode) {
    var _a, _b, _c;
    try {
      if (staticNode.type !== "BOOLEAN_OPERATION") return;
      const shapes = placeholder.children;
      if (shapes.length < 2) {
        console.warn(
          `[applyBoolean] \u201C${staticNode.name}\u201D needs \u22652 children, got ${shapes.length}.`
        );
        return;
      }
      const op = ((_a = staticNode.booleanOperation) != null ? _a : "UNION").toUpperCase();
      const opMap = {
        UNION: figma.union,
        SUBTRACT: figma.subtract,
        INTERSECT: figma.intersect,
        EXCLUDE: figma.exclude
      };
      const builder = (_b = opMap[op]) != null ? _b : figma.union;
      let z = parentNode.children.indexOf(placeholder);
      const boolNode = z >= 0 ? builder(shapes, parentNode, z) : builder(shapes, parentNode);
      boolNode.name = (_c = staticNode.name) != null ? _c : "Boolean";
      if ("touching" in staticNode)
        boolNode.touching = staticNode.touching;
      if (placeholder.parent) placeholder.remove();
      return boolNode;
    } catch (err) {
      console.error("applyBoolean \u2192", err);
    }
  }
  var nodeIdMap, imageHashMap, imagePaintStats, importLogs, IDENTITY_HANDLES, assignPaints;
  var init_bridge = __esm({
    "src/bridge.ts"() {
      "use strict";
      nodeIdMap = /* @__PURE__ */ new Map();
      imageHashMap = /* @__PURE__ */ new Map();
      imagePaintStats = { total: 0, resolved: 0, unresolved: 0, refs: [] };
      importLogs = [];
      IDENTITY_HANDLES = [
        [0, 1, 0],
        [0.5, 0.5, 1],
        [1, 1, 1]
      ];
      assignPaints = (key, target, source) => {
        var _a, _b;
        if (!(key in source && key in target)) return;
        const rawArr = source[key];
        if (rawArr.length === 0) {
          target[key] = [];
          return;
        }
        const paints = rawArr.map(formatPaint).filter((p) => p !== void 0);
        const hasImage = paints.some((p) => p.type === "IMAGE");
        try {
          target[key] = paints;
          if (hasImage) {
            const readBack = target[key];
            const imgAfter = (_b = (_a = readBack == null ? void 0 : readBack.filter) == null ? void 0 : _a.call(readBack, (p) => p.type === "IMAGE")) != null ? _b : [];
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
    }
  });

  // src/handlers/slideHandlers.ts
  function getSlideNode(slideId) {
    return __async(this, null, function* () {
      const node = yield lookupNode(slideId);
      if (!node) {
        throw new Error(`Node not found: ${slideId}`);
      }
      if (!SLIDE_TYPES.has(node.type)) {
        throw new Error(`Node is not a slide: ${slideId} (type: ${node.type})`);
      }
      return node;
    });
  }
  function createSlide(params) {
    return __async(this, null, function* () {
      try {
        const slide = figma.createSlide();
        if (params.name) {
          slide.name = params.name;
        }
        if (params.column != null && params.column !== -1) {
          const parent = slide.parent;
          if (parent && "insertChild" in parent) {
            parent.insertChild(params.column, slide);
          }
        }
        try {
          if (figma.currentPage) {
            figma.currentPage.focusedSlide = slide;
          }
        } catch (e) {
        }
        return {
          id: slide.id,
          name: slide.name,
          type: slide.type
        };
      } catch (error) {
        throw new Error(`Failed to create slide: ${error}`);
      }
    });
  }
  function deleteSlide(params) {
    return __async(this, null, function* () {
      try {
        let collectIds2 = function(node) {
          idsToRemove.add(node.id);
          if ("children" in node) {
            for (const child of node.children) {
              collectIds2(child);
            }
          }
        };
        var collectIds = collectIds2;
        const slide = yield getSlideNode(params.slideId);
        const idsToRemove = /* @__PURE__ */ new Set();
        collectIds2(slide);
        slide.remove();
        for (const [origId, mappedId] of nodeIdMap.entries()) {
          if (idsToRemove.has(mappedId) || idsToRemove.has(origId)) {
            nodeIdMap.delete(origId);
          }
        }
        return { success: true, slideId: params.slideId };
      } catch (error) {
        throw new Error(`Failed to delete slide: ${error}`);
      }
    });
  }
  function cloneSlide(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        const clonedSlide = slide.clone();
        if (params.name) {
          clonedSlide.name = params.name;
        }
        return {
          id: clonedSlide.id,
          name: clonedSlide.name,
          type: clonedSlide.type
        };
      } catch (error) {
        throw new Error(`Failed to clone slide: ${error}`);
      }
    });
  }
  function focusSlide(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        try {
          if (figma.currentPage) {
            figma.currentPage.focusedSlide = slide;
          }
        } catch (e) {
        }
        try {
          figma.viewport.scrollAndZoomIntoView([slide]);
        } catch (e) {
        }
        return {
          id: slide.id,
          name: slide.name,
          focused: true
        };
      } catch (error) {
        throw new Error(`Failed to focus slide: ${error}`);
      }
    });
  }
  function getFocusedSlide() {
    return __async(this, null, function* () {
      try {
        const focusedSlide = figma.currentPage.focusedSlide;
        if (!focusedSlide) {
          return null;
        }
        return {
          id: focusedSlide.id,
          name: focusedSlide.name,
          type: focusedSlide.type
        };
      } catch (error) {
        throw new Error(`Failed to get focused slide: ${error}`);
      }
    });
  }
  function getSlideGrid() {
    return __async(this, null, function* () {
      try {
        let findSlides2 = function(node) {
          if (node.type === "SLIDE") {
            slides.push(node);
          }
          if ("children" in node) {
            for (const child of node.children) {
              findSlides2(child);
            }
          }
        };
        var findSlides = findSlides2;
        const slides = [];
        findSlides2(figma.currentPage);
        return {
          rows: [
            {
              slides: slides.map((slide) => ({
                id: slide.id,
                name: slide.name,
                type: slide.type
              }))
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to get slide grid: ${error}`);
      }
    });
  }
  function getAllSlides() {
    return __async(this, null, function* () {
      try {
        let findSlides2 = function(node) {
          if (node.type === "SLIDE") {
            slides.push(node);
          }
          if ("children" in node) {
            for (const child of node.children) {
              findSlides2(child);
            }
          }
        };
        var findSlides = findSlides2;
        const slides = [];
        findSlides2(figma.currentPage);
        return {
          slides: slides.map((slide) => ({
            id: slide.id,
            name: slide.name,
            type: slide.type
          }))
        };
      } catch (error) {
        throw new Error(`Failed to get all slides: ${error}`);
      }
    });
  }
  function reorderSlides(params) {
    return __async(this, null, function* () {
      try {
        const slides = [];
        for (const sid of params.slideIds) {
          slides.push(yield getSlideNode(sid));
        }
        if (slides.length === 0) {
          throw new Error("slideIds array is empty");
        }
        const parent = slides[0].parent;
        if (!parent || !("insertChild" in parent)) {
          throw new Error("Slide parent does not support insertChild");
        }
        for (let i = 0; i < slides.length; i++) {
          parent.insertChild(i, slides[i]);
        }
        return {
          success: true,
          order: slides.map((s) => ({ id: s.id, name: s.name }))
        };
      } catch (error) {
        throw new Error(`Failed to reorder slides: ${error}`);
      }
    });
  }
  function setSlideTransition(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        let fullStyle = params.transitionStyle;
        const direction = params.direction || "LEFT";
        const directionMap = {
          PUSH: {
            LEFT: "PUSH_FROM_LEFT",
            RIGHT: "PUSH_FROM_RIGHT",
            TOP: "PUSH_FROM_TOP",
            BOTTOM: "PUSH_FROM_BOTTOM"
          },
          SLIDE_IN: {
            LEFT: "SLIDE_FROM_LEFT",
            RIGHT: "SLIDE_FROM_RIGHT",
            TOP: "SLIDE_FROM_TOP",
            BOTTOM: "SLIDE_FROM_BOTTOM"
          },
          SLIDE_OUT: {
            LEFT: "SLIDE_OUT_TO_LEFT",
            RIGHT: "SLIDE_OUT_TO_RIGHT",
            TOP: "SLIDE_OUT_TO_TOP",
            BOTTOM: "SLIDE_OUT_TO_BOTTOM"
          },
          MOVE_IN: {
            LEFT: "MOVE_FROM_LEFT",
            RIGHT: "MOVE_FROM_RIGHT",
            TOP: "MOVE_FROM_TOP",
            BOTTOM: "MOVE_FROM_BOTTOM"
          },
          MOVE_OUT: {
            LEFT: "MOVE_OUT_TO_LEFT",
            RIGHT: "MOVE_OUT_TO_RIGHT",
            TOP: "MOVE_OUT_TO_TOP",
            BOTTOM: "MOVE_OUT_TO_BOTTOM"
          }
        };
        if (directionMap[params.transitionStyle]) {
          fullStyle = directionMap[params.transitionStyle][direction] || params.transitionStyle;
        }
        const timingType = params.timing || "ON_CLICK";
        const timing = __spreadValues({
          type: timingType
        }, timingType === "AFTER_DELAY" && params.delay ? { delay: params.delay / 1e3 } : {});
        const transition = {
          style: fullStyle,
          duration: (params.duration || 300) / 1e3,
          // Convert ms to seconds
          curve: params.curve || "EASE_OUT",
          timing
        };
        slide.setSlideTransition(transition);
        return {
          id: slide.id,
          transition
        };
      } catch (error) {
        throw new Error(`Failed to set slide transition: ${error}`);
      }
    });
  }
  function skipSlide(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        slide.isSkippedSlide = params.skip;
        return {
          id: slide.id,
          isSkipped: slide.isSkippedSlide
        };
      } catch (error) {
        throw new Error(`Failed to set slide skip status: ${error}`);
      }
    });
  }
  function getSlideProperties(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        const knownProperties = [
          // Basic node properties
          "id",
          "name",
          "type",
          "visible",
          "locked",
          "opacity",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          // SlideNode specific
          "isSkippedSlide",
          // Frame-like properties
          "fills",
          "strokes",
          "strokeWeight",
          "cornerRadius",
          "layoutMode",
          "primaryAxisSizingMode",
          "counterAxisSizingMode",
          "paddingLeft",
          "paddingRight",
          "paddingTop",
          "paddingBottom",
          "itemSpacing",
          "counterAxisSpacing",
          "clipsContent",
          "guides",
          "layoutGrids",
          // Children
          "children",
          "parent",
          // Potential note properties
          "speakerNotes",
          "presenterNotes",
          "notes",
          "slideNotes",
          "speakerNote",
          "presenterNote",
          "note",
          "slideNote",
          "annotations",
          "comments",
          "description",
          // Methods
          "getSlideTransition",
          "setSlideTransition",
          "clone"
        ];
        const allProperties = {};
        for (const propName of knownProperties) {
          try {
            const value = slide[propName];
            if (value === void 0) {
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
        const potentialNoteProperties = [
          "speakerNotes",
          "presenterNotes",
          "notes",
          "slideNotes",
          "speakerNote",
          "presenterNote",
          "note",
          "slideNote",
          "annotations",
          "comments",
          "description"
        ];
        const noteProperties = {};
        for (const propName of potentialNoteProperties) {
          try {
            const value = slide[propName];
            if (value !== void 0 && value !== null && typeof value !== "symbol") {
              if (typeof value === "string" || typeof value === "object") {
                noteProperties[propName] = value;
              }
            }
          } catch (e) {
          }
        }
        let transitionInfo = null;
        try {
          transitionInfo = slide.getSlideTransition();
        } catch (e) {
        }
        return {
          id: slide.id,
          name: slide.name,
          type: slide.type,
          propertyCount: Object.keys(allProperties).filter((k) => allProperties[k] !== "undefined").length,
          properties: allProperties,
          noteRelatedProperties: noteProperties,
          hasNoteProperties: Object.keys(noteProperties).length > 0,
          transition: transitionInfo,
          isSkipped: slide.isSkippedSlide
        };
      } catch (error) {
        throw new Error(`Failed to get slide properties: ${error}`);
      }
    });
  }
  function getSlideSpeakerNotes(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        const possibleProps = [
          "speakerNotes",
          "presenterNotes",
          "notes",
          "slideNotes",
          "speakerNote",
          "presenterNote",
          "note",
          "slideNote"
        ];
        for (const propName of possibleProps) {
          try {
            const value = slide[propName];
            if (value !== void 0 && value !== null) {
              return {
                id: slide.id,
                name: slide.name,
                propertyName: propName,
                speakerNotes: value,
                available: true
              };
            }
          } catch (e) {
          }
        }
        return {
          id: slide.id,
          name: slide.name,
          speakerNotes: null,
          available: false,
          message: "Speaker notes are not available through the Figma Plugin API"
        };
      } catch (error) {
        throw new Error(`Failed to get speaker notes: ${error}`);
      }
    });
  }
  function setSlideSpeakerNotes(params) {
    return __async(this, null, function* () {
      try {
        const slide = yield getSlideNode(params.slideId);
        const possibleProps = [
          "speakerNotes",
          "presenterNotes",
          "notes",
          "slideNotes",
          "speakerNote",
          "presenterNote",
          "note",
          "slideNote"
        ];
        for (const propName of possibleProps) {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(slide, propName);
            if (descriptor && descriptor.writable !== false) {
              slide[propName] = params.notes;
              return {
                id: slide.id,
                name: slide.name,
                propertyName: propName,
                speakerNotes: params.notes,
                success: true
              };
            }
            slide[propName] = params.notes;
            const value = slide[propName];
            if (value === params.notes) {
              return {
                id: slide.id,
                name: slide.name,
                propertyName: propName,
                speakerNotes: params.notes,
                success: true
              };
            }
          } catch (e) {
          }
        }
        return {
          id: slide.id,
          name: slide.name,
          success: false,
          message: "Setting speaker notes is not available through the Figma Plugin API"
        };
      } catch (error) {
        throw new Error(`Failed to set speaker notes: ${error}`);
      }
    });
  }
  var SLIDE_TYPES;
  var init_slideHandlers = __esm({
    "src/handlers/slideHandlers.ts"() {
      "use strict";
      init_bridge();
      SLIDE_TYPES = /* @__PURE__ */ new Set(["SLIDE", "FRAME"]);
    }
  });

  // src/handlers/contentHandlers.ts
  function getCurrentParent() {
    const focusedSlide = figma.currentPage.focusedSlide;
    return focusedSlide || figma.currentPage;
  }
  function stripVariableBindings(node) {
    try {
      if ("boundVariables" in node) {
        const bv = node.boundVariables;
        if (bv) {
          for (const field of Object.keys(bv)) {
            try {
              node.setBoundVariable(field, null);
            } catch (e) {
            }
          }
        }
      }
    } catch (e) {
      try {
        if ("fills" in node) {
          const fills = node.fills;
          if (fills && fills !== figma.mixed && Array.isArray(fills)) {
            node.fills = fills.map((f) => __spreadValues({}, f));
          }
        }
      } catch (e2) {
      }
      try {
        if ("strokes" in node) {
          const strokes = node.strokes;
          if (strokes && Array.isArray(strokes)) {
            node.strokes = strokes.map((s) => __spreadValues({}, s));
          }
        }
      } catch (e2) {
      }
      try {
        if ("effects" in node) {
          const effects = node.effects;
          if (effects && Array.isArray(effects)) {
            node.effects = effects.map((e2) => __spreadValues({}, e2));
          }
        }
      } catch (e2) {
      }
    }
  }
  function resolveNodeId(nodeId) {
    return __async(this, null, function* () {
      return yield lookupNode(nodeId);
    });
  }
  function getNode(nodeId) {
    return __async(this, null, function* () {
      const node = yield lookupNode(nodeId);
      if (!node || !("id" in node)) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      stripVariableBindings(node);
      return node;
    });
  }
  function createRectangle(params) {
    return __async(this, null, function* () {
      const rect = figma.createRectangle();
      rect.resize(params.width, params.height);
      if (params.name) rect.name = params.name;
      if (params.fillColor) {
        rect.fills = [
          {
            type: "SOLID",
            color: {
              r: params.fillColor.r,
              g: params.fillColor.g,
              b: params.fillColor.b
            },
            opacity: params.fillColor.a != null ? params.fillColor.a : 1
          }
        ];
      }
      if (params.strokeColor && params.strokeWeight) {
        rect.strokes = [
          {
            type: "SOLID",
            color: {
              r: params.strokeColor.r,
              g: params.strokeColor.g,
              b: params.strokeColor.b
            },
            opacity: params.strokeColor.a != null ? params.strokeColor.a : 1
          }
        ];
        rect.strokeWeight = params.strokeWeight;
      }
      if (params.cornerRadius) {
        rect.cornerRadius = params.cornerRadius;
      }
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(rect);
      }
      rect.x = params.x;
      rect.y = params.y;
      return { id: rect.id, name: rect.name, type: rect.type };
    });
  }
  function createFrame(params) {
    return __async(this, null, function* () {
      const frame = figma.createFrame();
      frame.resize(params.width, params.height);
      if (params.name) frame.name = params.name;
      if (params.fillColor) {
        frame.fills = [
          {
            type: "SOLID",
            color: {
              r: params.fillColor.r,
              g: params.fillColor.g,
              b: params.fillColor.b
            },
            opacity: params.fillColor.a != null ? params.fillColor.a : 1
          }
        ];
      }
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(frame);
      }
      frame.x = params.x;
      frame.y = params.y;
      return { id: frame.id, name: frame.name, type: frame.type };
    });
  }
  function createText(params) {
    return __async(this, null, function* () {
      const textNode = figma.createText();
      yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      textNode.characters = params.text;
      if (params.name) textNode.name = params.name;
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
              b: params.fontColor.b
            },
            opacity: params.fontColor.a != null ? params.fontColor.a : 1
          }
        ];
      }
      if (params.textAlign) {
        textNode.textAlignHorizontal = params.textAlign;
      }
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(textNode);
      }
      textNode.x = params.x;
      textNode.y = params.y;
      return { id: textNode.id, name: textNode.name, type: textNode.type };
    });
  }
  function createEllipse(params) {
    return __async(this, null, function* () {
      const ellipse = figma.createEllipse();
      ellipse.resize(params.width, params.height);
      if (params.name) ellipse.name = params.name;
      if (params.fillColor) {
        ellipse.fills = [
          {
            type: "SOLID",
            color: {
              r: params.fillColor.r,
              g: params.fillColor.g,
              b: params.fillColor.b
            },
            opacity: params.fillColor.a != null ? params.fillColor.a : 1
          }
        ];
      }
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(ellipse);
      }
      ellipse.x = params.x;
      ellipse.y = params.y;
      return { id: ellipse.id, name: ellipse.name, type: ellipse.type };
    });
  }
  function createGraphic(params) {
    return __async(this, null, function* () {
      const node = figma.createNodeFromSvg(params.svg);
      if (params.name) node.name = params.name;
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(node);
      }
      node.x = params.x;
      node.y = params.y;
      return { id: node.id, name: node.name, type: node.type };
    });
  }
  function createMarker(params) {
    return __async(this, null, function* () {
      const { x, y, size, shape } = params;
      const fill = params.fillColor || { r: 0.259, g: 0.522, b: 0.957 };
      const fillRGB = { r: fill.r, g: fill.g, b: fill.b };
      const fillOpacity = fill.a != null ? fill.a : 1;
      function applyStroke(node2) {
        if (params.strokeColor && params.strokeWeight) {
          node2.strokes = [
            {
              type: "SOLID",
              color: {
                r: params.strokeColor.r,
                g: params.strokeColor.g,
                b: params.strokeColor.b
              },
              opacity: params.strokeColor.a != null ? params.strokeColor.a : 1
            }
          ];
          node2.strokeWeight = params.strokeWeight;
        }
      }
      let node;
      switch (shape) {
        case "square": {
          const rect = figma.createRectangle();
          rect.resize(size, size);
          rect.x = x;
          rect.y = y;
          rect.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(rect);
          node = rect;
          break;
        }
        case "diamond": {
          const dSize = size * 1.5;
          const rect = figma.createRectangle();
          rect.resize(dSize, dSize);
          rect.rotation = 45;
          rect.x = x + size * 0.15;
          rect.y = y;
          rect.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(rect);
          node = rect;
          break;
        }
        case "triangle_up": {
          const poly = figma.createPolygon();
          poly.pointCount = 3;
          poly.resize(size, size);
          poly.x = x;
          poly.y = y;
          poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(poly);
          node = poly;
          break;
        }
        case "triangle_down": {
          const poly = figma.createPolygon();
          poly.pointCount = 3;
          poly.resize(size, size);
          poly.rotation = 180;
          poly.x = x + size;
          poly.y = y + size;
          poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(poly);
          node = poly;
          break;
        }
        case "star": {
          const star = figma.createStar();
          star.pointCount = 5;
          star.innerRadius = 0.4;
          star.resize(size, size);
          star.x = x;
          star.y = y;
          star.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(star);
          node = star;
          break;
        }
        case "pentagon": {
          const poly = figma.createPolygon();
          poly.pointCount = 5;
          poly.resize(size, size);
          poly.x = x;
          poly.y = y;
          poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(poly);
          node = poly;
          break;
        }
        case "hexagon": {
          const poly = figma.createPolygon();
          poly.pointCount = 6;
          poly.resize(size, size);
          poly.x = x;
          poly.y = y;
          poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(poly);
          node = poly;
          break;
        }
        case "x": {
          const pad = size * 0.15;
          const sw = Math.max(1.5, size * 0.2);
          const r = Math.round;
          const rgb = `rgb(${r(fillRGB.r * 255)},${r(fillRGB.g * 255)},${r(fillRGB.b * 255)})`;
          const svgStr = `<svg width="${size}" height="${size}"><line x1="${pad}" y1="${pad}" x2="${size - pad}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${size - pad}" y1="${pad}" x2="${pad}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
          const svgNode = figma.createNodeFromSvg(svgStr);
          svgNode.x = x;
          svgNode.y = y;
          node = svgNode;
          break;
        }
        case "plus": {
          const mid = size / 2;
          const pad = size * 0.1;
          const sw = Math.max(1.5, size * 0.2);
          const r = Math.round;
          const rgb = `rgb(${r(fillRGB.r * 255)},${r(fillRGB.g * 255)},${r(fillRGB.b * 255)})`;
          const svgStr = `<svg width="${size}" height="${size}"><line x1="${mid}" y1="${pad}" x2="${mid}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${pad}" y1="${mid}" x2="${size - pad}" y2="${mid}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
          const svgNode = figma.createNodeFromSvg(svgStr);
          svgNode.x = x;
          svgNode.y = y;
          node = svgNode;
          break;
        }
        case "circle":
        default: {
          const ellipse = figma.createEllipse();
          ellipse.resize(size, size);
          ellipse.x = x;
          ellipse.y = y;
          ellipse.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
          applyStroke(ellipse);
          node = ellipse;
          break;
        }
      }
      if (params.name) node.name = params.name;
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(node);
      }
      node.x = x;
      node.y = y;
      return { id: node.id, name: node.name, type: node.type, shape };
    });
  }
  function moveNode(params) {
    return __async(this, null, function* () {
      var _a, _b;
      const node = yield getNode(params.nodeId);
      if (params.parentId && ((_a = node.parent) == null ? void 0 : _a.id) !== params.parentId) {
        const newParent = yield resolveNodeId(params.parentId);
        if (newParent && "appendChild" in newParent) {
          newParent.appendChild(node);
        }
      }
      try {
        node.x = params.x;
        node.y = params.y;
      } catch (e) {
        try {
          const t = node.relativeTransform;
          node.relativeTransform = [[t[0][0], t[0][1], params.x], [t[1][0], t[1][1], params.y]];
        } catch (e2) {
          node.relativeTransform = [[1, 0, params.x], [0, 1, params.y]];
        }
      }
      try {
        return { id: node.id, x: node.x, y: node.y, parentId: (_b = node.parent) == null ? void 0 : _b.id };
      } catch (e) {
        return { id: node.id, x: params.x, y: params.y, parentId: params.parentId };
      }
    });
  }
  function resizeNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if ("resize" in node) {
        try {
          node.resize(params.width, params.height);
        } catch (e) {
          try {
            const oldW = node.width;
            const oldH = node.height;
            const t = node.relativeTransform;
            const sx = oldW > 0 ? params.width / oldW : 1;
            const sy = oldH > 0 ? params.height / oldH : 1;
            node.relativeTransform = [[t[0][0] * sx, t[0][1] * sy, t[0][2]], [t[1][0] * sx, t[1][1] * sy, t[1][2]]];
          } catch (e2) {
          }
        }
      }
      try {
        return { id: node.id, width: node.width, height: node.height };
      } catch (e) {
        return { id: node.id, width: params.width, height: params.height };
      }
    });
  }
  function deleteNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const idsToRemove = /* @__PURE__ */ new Set();
      function collectIds(n) {
        idsToRemove.add(n.id);
        if ("children" in n) {
          for (const child of n.children) {
            collectIds(child);
          }
        }
      }
      collectIds(node);
      node.remove();
      for (const [origId, mappedId] of nodeIdMap.entries()) {
        if (idsToRemove.has(mappedId) || idsToRemove.has(origId)) {
          nodeIdMap.delete(origId);
        }
      }
      return { success: true, nodeId: params.nodeId };
    });
  }
  function cloneNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      let cloned;
      try {
        cloned = node.clone();
      } catch (e) {
        if ("boundVariables" in node) {
          for (const field of Object.keys(node.boundVariables || {})) {
            try {
              node.setBoundVariable(field, null);
            } catch (e2) {
            }
          }
        }
        cloned = node.clone();
      }
      if (params.parentId) {
        const parent = yield resolveNodeId(params.parentId);
        if (parent && "appendChild" in parent) {
          parent.appendChild(cloned);
        }
      }
      if (params.offsetX) cloned.x += params.offsetX;
      if (params.offsetY) cloned.y += params.offsetY;
      return { id: cloned.id, name: cloned.name, type: cloned.type, parentId: cloned.parent ? cloned.parent.id : void 0 };
    });
  }
  function reparentNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const parent = yield resolveNodeId(params.parentId);
      if (!parent || !("appendChild" in parent)) {
        throw new Error(`Parent node not found or cannot have children: ${params.parentId}`);
      }
      const absoluteX = node.absoluteTransform[0][2];
      const absoluteY = node.absoluteTransform[1][2];
      if (params.index != null && "insertChild" in parent) {
        parent.insertChild(params.index, node);
      } else {
        parent.appendChild(node);
      }
      const parentAbsoluteX = parent.absoluteTransform[0][2];
      const parentAbsoluteY = parent.absoluteTransform[1][2];
      node.x = absoluteX - parentAbsoluteX;
      node.y = absoluteY - parentAbsoluteY;
      return {
        id: node.id,
        name: node.name,
        parentId: parent.id,
        parentName: parent.name,
        x: node.x,
        y: node.y
      };
    });
  }
  function groupNodes(params) {
    return __async(this, null, function* () {
      const nodes = yield Promise.all(params.nodeIds.map((id) => getNode(id)));
      const group = figma.group(nodes, getCurrentParent());
      if (params.groupName) {
        group.name = params.groupName;
      }
      return { id: group.id, name: group.name, type: group.type };
    });
  }
  function ungroupNodes(params) {
    return __async(this, null, function* () {
      const group = yield getNode(params.groupId);
      if (group.type !== "GROUP") {
        throw new Error("Node is not a group");
      }
      figma.ungroup(group);
      return { success: true };
    });
  }
  function setFillColor(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if ("fills" in node) {
        node.fills = [
          {
            type: "SOLID",
            color: {
              r: params.color.r,
              g: params.color.g,
              b: params.color.b
            },
            opacity: params.color.a != null ? params.color.a : 1
          }
        ];
      }
      return { id: node.id };
    });
  }
  function setStroke(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if ("strokes" in node && "strokeWeight" in node) {
        node.strokes = [
          {
            type: "SOLID",
            color: {
              r: params.color.r,
              g: params.color.g,
              b: params.color.b
            },
            opacity: params.color.a != null ? params.color.a : 1
          }
        ];
        if (params.weight) {
          node.strokeWeight = params.weight;
        }
      }
      return { id: node.id };
    });
  }
  function setOpacity(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if ("opacity" in node) {
        node.opacity = params.opacity;
      }
      return { id: node.id, opacity: "opacity" in node ? node.opacity : void 0 };
    });
  }
  function setCornerRadius(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if ("cornerRadius" in node && node.type === "RECTANGLE") {
        node.cornerRadius = params.radius;
      } else if ("cornerRadius" in node && node.type === "FRAME") {
        node.cornerRadius = params.radius;
      }
      return { id: node.id };
    });
  }
  function setTextContent(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      function loadFontsAndSetText(textLike) {
        return __async(this, null, function* () {
          yield loadAllFontsOnTarget(textLike);
          textLike.characters = params.text;
        });
      }
      if (node.type === "TEXT") {
        yield loadFontsAndSetText(node);
        return { id: node.id, text: node.characters };
      } else if (node.type === "SHAPE_WITH_TEXT") {
        yield loadFontsAndSetText(node.text);
        return { id: node.id, text: node.text.characters };
      } else if (node.type === "TABLE_CELL") {
        yield loadFontsAndSetText(node.text);
        return { id: node.id, text: node.text.characters };
      } else {
        throw new Error(`Node type "${node.type}" is not a text-compatible node. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
      }
    });
  }
  function setTextProperties(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      let textTarget;
      if (node.type === "TEXT") {
        textTarget = node;
      } else if (node.type === "SHAPE_WITH_TEXT") {
        textTarget = node.text;
      } else if (node.type === "TABLE_CELL") {
        textTarget = node.text;
      } else {
        throw new Error(`Node type "${node.type}" does not support text properties. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
      }
      yield loadAllFontsOnTarget(textTarget);
      if (params.fontSize) {
        textTarget.fontSize = params.fontSize;
      }
      if (params.fontColor) {
        textTarget.fills = [
          {
            type: "SOLID",
            color: {
              r: params.fontColor.r,
              g: params.fontColor.g,
              b: params.fontColor.b
            },
            opacity: params.fontColor.a != null ? params.fontColor.a : 1
          }
        ];
      }
      if (params.textAlign) {
        textTarget.textAlignHorizontal = params.textAlign;
      }
      return { id: node.id };
    });
  }
  function getPageInfo() {
    return __async(this, null, function* () {
      const page = figma.currentPage;
      return {
        id: page.id,
        name: page.name,
        type: page.type,
        children: page.children.map((child) => ({
          id: child.id,
          name: child.name,
          type: child.type
        }))
      };
    });
  }
  function getNodeInfo(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const maxDepth = params.depth != null ? params.depth : 2;
      function getNodeDetails(n, currentDepth) {
        stripVariableBindings(n);
        const baseInfo = {
          id: n.id,
          name: n.name,
          type: n.type
        };
        try {
          baseInfo.x = n.x;
          baseInfo.y = n.y;
          baseInfo.width = n.width;
          baseInfo.height = n.height;
        } catch (e) {
        }
        try {
          if ("rotation" in n) {
            baseInfo.rotation = n.rotation;
          }
          if ("layoutMode" in n) {
            baseInfo.layoutMode = n.layoutMode;
          }
          if (n.type === "TEXT") {
            const textNode = n;
            baseInfo.characters = textNode.characters;
            try {
              baseInfo.fontSize = textNode.fontSize === figma.mixed ? "MIXED" : textNode.fontSize;
              baseInfo.fontName = textNode.fontName === figma.mixed ? "MIXED" : textNode.fontName;
            } catch (e) {
              baseInfo.fontSize = "VARIABLE_BOUND";
              baseInfo.fontName = "VARIABLE_BOUND";
            }
          } else if (n.type === "SHAPE_WITH_TEXT") {
            const shapeNode = n;
            baseInfo.characters = shapeNode.text.characters;
            try {
              baseInfo.fontSize = shapeNode.text.fontSize === figma.mixed ? "MIXED" : shapeNode.text.fontSize;
              baseInfo.fontName = shapeNode.text.fontName === figma.mixed ? "MIXED" : shapeNode.text.fontName;
            } catch (e) {
              baseInfo.fontSize = "VARIABLE_BOUND";
              baseInfo.fontName = "VARIABLE_BOUND";
            }
          } else if (n.type === "TABLE_CELL") {
            const cellNode = n;
            if (cellNode.text) {
              baseInfo.characters = cellNode.text.characters;
              try {
                baseInfo.fontSize = cellNode.text.fontSize === figma.mixed ? "MIXED" : cellNode.text.fontSize;
                baseInfo.fontName = cellNode.text.fontName === figma.mixed ? "MIXED" : cellNode.text.fontName;
              } catch (e) {
                baseInfo.fontSize = "VARIABLE_BOUND";
                baseInfo.fontName = "VARIABLE_BOUND";
              }
            }
          }
          if (n.type === "TABLE") {
            const tableNode = n;
            if (tableNode.numRows != null) baseInfo.numRows = tableNode.numRows;
            if (tableNode.numColumns != null) baseInfo.numColumns = tableNode.numColumns;
          }
          if ("fills" in n) {
            try {
              const fills = n.fills;
              if (fills && fills !== figma.mixed && Array.isArray(fills) && fills.length > 0) {
                baseInfo.fills = fills.map((f) => {
                  const info = { type: f.type, visible: f.visible !== false };
                  if (f.type === "SOLID") {
                    const s = f;
                    info.color = { r: s.color.r, g: s.color.g, b: s.color.b };
                    if (s.opacity != null) info.opacity = s.opacity;
                  } else if (f.type === "IMAGE") {
                    const img = f;
                    info.scaleMode = img.scaleMode;
                    if (img.imageHash) info.imageHash = img.imageHash;
                  }
                  return info;
                });
              }
            } catch (e) {
            }
          }
        } catch (e) {
        }
        try {
          if ("children" in n && currentDepth < maxDepth) {
            baseInfo.children = n.children.map(
              (child) => getNodeDetails(child, currentDepth + 1)
            );
          } else if ("children" in n) {
            baseInfo.childrenCount = n.children.length;
          }
        } catch (e) {
        }
        return baseInfo;
      }
      return getNodeDetails(node, 0);
    });
  }
  function getSelectionInfo() {
    return __async(this, null, function* () {
      const selection = figma.currentPage.selection;
      return {
        nodes: selection.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height
        }))
      };
    });
  }
  function renameNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const oldName = node.name;
      node.name = params.name;
      return {
        id: node.id,
        oldName,
        newName: node.name,
        type: node.type
      };
    });
  }
  function renameLayers(params) {
    return __async(this, null, function* () {
      const nodes = yield Promise.all(params.nodeIds.map((id) => getNode(id)));
      const results = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const oldName = node.name;
        let newName = oldName;
        if (params.pattern) {
          newName = params.pattern;
        }
        if (params.sequential) {
          const num = params.sequential.start + i;
          const seqPrefix = params.sequential.prefix || "Layer";
          newName = `${seqPrefix} ${num}`;
        }
        if (params.prefix) {
          newName = params.prefix + newName;
        }
        if (params.suffix) {
          newName = newName + params.suffix;
        }
        if (params.replace) {
          newName = newName.replace(
            new RegExp(params.replace.from, "g"),
            params.replace.to
          );
        }
        node.name = newName;
        results.push({
          id: node.id,
          oldName,
          newName: node.name,
          type: node.type
        });
      }
      return { renamed: results };
    });
  }
  function getTextNodeInfo(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const textNodes = [];
      function collectTextNodes(n, currentDepth = 0) {
        if (n.type === "TEXT") {
          const textNode = n;
          let fontName = "MIXED";
          let fontSize = "MIXED";
          if (textNode.fontName !== figma.mixed) {
            fontName = textNode.fontName;
          }
          if (textNode.fontSize !== figma.mixed) {
            fontSize = textNode.fontSize;
          }
          textNodes.push({
            id: textNode.id,
            name: textNode.name,
            type: "TEXT",
            characters: textNode.characters,
            fontSize,
            fontName,
            x: textNode.x,
            y: textNode.y,
            width: textNode.width,
            height: textNode.height
          });
        } else if (n.type === "SHAPE_WITH_TEXT") {
          const shapeNode = n;
          let fontName = "MIXED";
          let fontSize = "MIXED";
          if (shapeNode.text.fontName !== figma.mixed) {
            fontName = shapeNode.text.fontName;
          }
          if (shapeNode.text.fontSize !== figma.mixed) {
            fontSize = shapeNode.text.fontSize;
          }
          textNodes.push({
            id: shapeNode.id,
            name: shapeNode.name,
            type: "SHAPE_WITH_TEXT",
            characters: shapeNode.text.characters,
            fontSize,
            fontName,
            x: shapeNode.x,
            y: shapeNode.y,
            width: shapeNode.width,
            height: shapeNode.height
          });
        } else if (n.type === "TABLE_CELL") {
          const cellNode = n;
          if (cellNode.text) {
            let fontName = "MIXED";
            let fontSize = "MIXED";
            if (cellNode.text.fontName !== figma.mixed) {
              fontName = cellNode.text.fontName;
            }
            if (cellNode.text.fontSize !== figma.mixed) {
              fontSize = cellNode.text.fontSize;
            }
            textNodes.push({
              id: cellNode.id,
              name: cellNode.name,
              type: "TABLE_CELL",
              characters: cellNode.text.characters,
              fontSize,
              fontName,
              x: cellNode.x,
              y: cellNode.y,
              width: cellNode.width,
              height: cellNode.height
            });
          }
        }
        if ("children" in n && (!params.depth || currentDepth < params.depth)) {
          n.children.forEach(
            (child) => collectTextNodes(child, currentDepth + 1)
          );
        }
      }
      collectTextNodes(node);
      return {
        nodeId: params.nodeId,
        totalTextNodes: textNodes.length,
        textNodes
      };
    });
  }
  function setTextDecoration(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      let textTarget;
      if (node.type === "TEXT") {
        textTarget = node;
      } else if (node.type === "SHAPE_WITH_TEXT") {
        textTarget = node.text;
      } else if (node.type === "TABLE_CELL") {
        textTarget = node.text;
      } else {
        throw new Error(`Node type "${node.type}" does not support text decoration. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
      }
      yield loadAllFontsOnTarget(textTarget);
      if (params.textDecoration !== void 0) {
        textTarget.textDecoration = params.textDecoration;
      }
      if (params.textCase !== void 0) {
        textTarget.textCase = params.textCase;
      }
      return { id: node.id };
    });
  }
  function setTextFont(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const font = {
        family: params.fontFamily,
        style: params.fontStyle
      };
      yield figma.loadFontAsync(font);
      function applyFont(target) {
        var _a, _b;
        try {
          target.fontName = font;
          return;
        } catch (e) {
        }
        try {
          const saved = target.characters;
          if (saved.length > 0) {
            target.deleteCharacters(0, saved.length);
          }
          target.fontName = font;
          if (saved.length > 0) {
            target.insertCharacters(0, saved);
          }
          return;
        } catch (e) {
        }
        try {
          const len = (_b = (_a = target.characters) == null ? void 0 : _a.length) != null ? _b : 0;
          if (len > 0 && typeof target.setRangeFontName === "function") {
            target.setRangeFontName(0, len, font);
            return;
          }
        } catch (e) {
        }
        try {
          if ("boundVariables" in target) {
            const bv = target.boundVariables;
            if (bv) {
              for (const field of Object.keys(bv)) {
                try {
                  target.setBoundVariable(field, null);
                } catch (e) {
                }
              }
            }
          }
          target.fontName = font;
          return;
        } catch (e) {
        }
        throw new Error("Cannot set font: node has immutable VARIABLE bindings");
      }
      if (node.type === "TEXT") {
        const textNode = node;
        applyFont(textNode);
        return { id: textNode.id, fontName: font };
      } else if (node.type === "SHAPE_WITH_TEXT") {
        const shapeNode = node;
        applyFont(shapeNode.text);
        return { id: shapeNode.id, fontName: font };
      } else if (node.type === "TABLE_CELL") {
        const cellNode = node;
        applyFont(cellNode.text);
        return { id: cellNode.id, fontName: font };
      } else if ("children" in node) {
        const modified = [];
        function walkAndApply(parent) {
          return __async(this, null, function* () {
            for (const child of parent.children) {
              if (child.type === "TEXT") {
                stripVariableBindings(child);
                applyFont(child);
                modified.push(child.id);
              } else if (child.type === "SHAPE_WITH_TEXT") {
                stripVariableBindings(child);
                applyFont(child.text);
                modified.push(child.id);
              } else if (child.type === "TABLE_CELL") {
                stripVariableBindings(child);
                applyFont(child.text);
                modified.push(child.id);
              } else if ("children" in child) {
                yield walkAndApply(child);
              }
            }
          });
        }
        yield walkAndApply(node);
        if (modified.length === 0) {
          throw new Error(`Node "${node.name}" (${node.type}) contains no TEXT descendants`);
        }
        return { id: node.id, fontName: font, modifiedChildren: modified };
      } else {
        throw new Error(`Node type "${node.type}" does not support font changes. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL, or container with TEXT children`);
      }
    });
  }
  function setTextRangeStyle(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      let textTarget;
      if (node.type === "TEXT") {
        textTarget = node;
      } else if (node.type === "SHAPE_WITH_TEXT") {
        textTarget = node.text;
      } else if (node.type === "TABLE_CELL") {
        textTarget = node.text;
      } else {
        throw new Error(`Node type "${node.type}" does not support text range styles. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
      }
      const textLength = textTarget.characters.length;
      const currentFontName = textTarget.fontName;
      if (currentFontName !== figma.mixed) {
        yield figma.loadFontAsync(currentFontName);
      } else {
        const loaded = /* @__PURE__ */ new Set();
        for (let i = 0; i < textLength; i++) {
          const charFont = textTarget.getRangeFontName(i, i + 1);
          const key = `${charFont.family}:${charFont.style}`;
          if (!loaded.has(key)) {
            yield figma.loadFontAsync(charFont);
            loaded.add(key);
          }
        }
      }
      for (const range of params.ranges) {
        if (range.fontFamily && range.fontStyle) {
          yield figma.loadFontAsync({
            family: range.fontFamily,
            style: range.fontStyle
          });
        }
      }
      for (const range of params.ranges) {
        const start = Math.max(0, range.start);
        const end = Math.min(textLength, range.end);
        if (start >= end) continue;
        if (range.color) {
          textTarget.setRangeFills(start, end, [
            {
              type: "SOLID",
              color: {
                r: range.color.r,
                g: range.color.g,
                b: range.color.b
              },
              opacity: range.color.a != null ? range.color.a : 1
            }
          ]);
        }
        if (range.fontFamily && range.fontStyle) {
          textTarget.setRangeFontName(start, end, {
            family: range.fontFamily,
            style: range.fontStyle
          });
        }
        if (range.fontSize) {
          textTarget.setRangeFontSize(start, end, range.fontSize);
        }
        if (range.textDecoration) {
          textTarget.setRangeTextDecoration(start, end, range.textDecoration);
        }
      }
      return { id: node.id, rangesApplied: params.ranges.length };
    });
  }
  function collectTextStylesFromNodes() {
    const styleMap = /* @__PURE__ */ new Map();
    function scan(node) {
      if (node.type === "TEXT") {
        const textNode = node;
        const sid = (() => {
          try {
            return textNode.textStyleId;
          } catch (e) {
            return null;
          }
        })();
        if (sid && sid !== "" && sid !== figma.mixed && typeof sid === "string") {
          if (!styleMap.has(sid)) {
            styleMap.set(sid, {
              id: sid,
              name: textNode.name,
              sourceNodeId: textNode.id,
              fontName: textNode.fontName !== figma.mixed ? textNode.fontName : "MIXED",
              fontSize: textNode.fontSize !== figma.mixed ? textNode.fontSize : "MIXED"
            });
          }
          return;
        }
        if (typeof textNode.getStyledTextSegments === "function") {
          try {
            const segments = textNode.getStyledTextSegments(["textStyleId", "fontName", "fontSize", "lineHeight", "letterSpacing", "textDecoration", "textCase"]);
            for (const seg of segments) {
              if (seg.textStyleId && seg.textStyleId !== "" && !styleMap.has(seg.textStyleId)) {
                styleMap.set(seg.textStyleId, {
                  id: seg.textStyleId,
                  name: textNode.name,
                  sourceNodeId: textNode.id,
                  fontName: seg.fontName || "unknown",
                  fontSize: seg.fontSize || "unknown"
                });
              }
            }
          } catch (e) {
          }
        }
      }
      if ("children" in node) {
        for (const child of node.children) {
          scan(child);
        }
      }
    }
    scan(figma.currentPage);
    return Array.from(styleMap.values());
  }
  function getLocalTextStyles() {
    return __async(this, null, function* () {
      try {
        const styles2 = yield figma.getLocalTextStylesAsync();
        if (Array.isArray(styles2) && styles2.length > 0) {
          return {
            totalStyles: styles2.length,
            source: "api",
            styles: styles2.map((style) => ({
              id: style.id,
              name: style.name,
              fontName: style.fontName,
              fontSize: style.fontSize,
              letterSpacing: style.letterSpacing,
              lineHeight: style.lineHeight,
              textCase: style.textCase,
              textDecoration: style.textDecoration
            }))
          };
        }
      } catch (e) {
      }
      const styles = collectTextStylesFromNodes();
      return {
        totalStyles: styles.length,
        source: styles.length > 0 ? "node_scan" : "none",
        styles
      };
    });
  }
  function getTextTarget(node) {
    if (node.type === "TEXT") return node;
    if (node.type === "SHAPE_WITH_TEXT") return node.text;
    if (node.type === "TABLE_CELL") return node.text;
    throw new Error(`Node type "${node.type}" does not support text styles. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
  }
  function loadAllFontsOnTarget(textTarget) {
    return __async(this, null, function* () {
      try {
        if (textTarget.fontName === figma.mixed) {
          const len = textTarget.characters.length;
          const loaded = /* @__PURE__ */ new Set();
          for (let i = 0; i < len; i++) {
            const font = textTarget.getRangeFontName(i, i + 1);
            const key = `${font.family}:${font.style}`;
            if (!loaded.has(key)) {
              yield figma.loadFontAsync(font);
              loaded.add(key);
            }
          }
        } else if (textTarget.fontName) {
          yield figma.loadFontAsync(textTarget.fontName);
        }
      } catch (e) {
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    });
  }
  function setTextStyle(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const textTarget = getTextTarget(node);
      yield loadAllFontsOnTarget(textTarget);
      textTarget.textStyleId = params.textStyleId;
      return {
        id: node.id,
        textStyleId: params.textStyleId
      };
    });
  }
  function getTextStyle(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const textTarget = getTextTarget(node);
      const currentStyleId = textTarget.textStyleId;
      return {
        id: node.id,
        textStyleId: !currentStyleId || currentStyleId === "" || currentStyleId === figma.mixed ? null : currentStyleId,
        fontName: textTarget.fontName !== figma.mixed ? textTarget.fontName : "MIXED",
        fontSize: textTarget.fontSize !== figma.mixed ? textTarget.fontSize : "MIXED"
      };
    });
  }
  function setLayoutMode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
        throw new Error(`Node type "${node.type}" does not support layoutMode. Supported: FRAME, COMPONENT, COMPONENT_SET, INSTANCE`);
      }
      const frameNode = node;
      frameNode.layoutMode = params.layoutMode;
      return {
        id: frameNode.id,
        name: frameNode.name,
        layoutMode: frameNode.layoutMode
      };
    });
  }
  function base64Encode(bytes) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let base64 = "";
    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;
    for (let i = 0; i < mainLength; i += 3) {
      const chunk = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
      base64 += chars[(chunk & 16515072) >> 18] + chars[(chunk & 258048) >> 12] + chars[(chunk & 4032) >> 6] + chars[chunk & 63];
    }
    if (byteRemainder === 1) {
      const chunk = bytes[mainLength];
      base64 += chars[(chunk & 252) >> 2] + chars[(chunk & 3) << 4] + "==";
    } else if (byteRemainder === 2) {
      const chunk = bytes[mainLength] << 8 | bytes[mainLength + 1];
      base64 += chars[(chunk & 64512) >> 10] + chars[(chunk & 1008) >> 4] + chars[(chunk & 15) << 2] + "=";
    }
    return base64;
  }
  function exportSlideImage(params) {
    return __async(this, null, function* () {
      let scale = params.scale || 1;
      let slide;
      if (params.slideId) {
        const node = yield lookupNode(params.slideId);
        if (!node) throw new Error(`Slide not found: ${params.slideId}`);
        slide = node;
      } else {
        const focusedSlide = figma.currentPage.focusedSlide;
        if (focusedSlide) {
          slide = focusedSlide;
        } else {
          const firstChild = figma.currentPage.children[0];
          if (!firstChild) throw new Error("No slides found on the current page");
          slide = firstChild;
        }
      }
      if (!("exportAsync" in slide)) {
        throw new Error("Node does not support export");
      }
      const bytes = yield slide.exportAsync({
        format: "JPG",
        constraint: { type: "SCALE", value: scale }
      });
      const imageData = base64Encode(bytes);
      return {
        slideId: slide.id,
        slideName: slide.name,
        scale,
        mimeType: "image/jpeg",
        imageData
      };
    });
  }
  function rotateNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (!("rotation" in node)) {
        throw new Error(`Node "${node.type}" does not support rotation`);
      }
      try {
        const halfW = node.width / 2;
        const halfH = node.height / 2;
        const tOld = node.absoluteTransform;
        const cxOld = tOld[0][0] * halfW + tOld[0][1] * halfH + tOld[0][2];
        const cyOld = tOld[1][0] * halfW + tOld[1][1] * halfH + tOld[1][2];
        node.rotation = params.angle;
        const tNew = node.absoluteTransform;
        const cxNew = tNew[0][0] * halfW + tNew[0][1] * halfH + tNew[0][2];
        const cyNew = tNew[1][0] * halfW + tNew[1][1] * halfH + tNew[1][2];
        node.x += cxOld - cxNew;
        node.y += cyOld - cyNew;
      } catch (e) {
        try {
          const rad = -params.angle * Math.PI / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const t = node.relativeTransform;
          node.relativeTransform = [[cos, sin, t[0][2]], [-sin, cos, t[1][2]]];
        } catch (e2) {
        }
      }
      try {
        return {
          id: node.id,
          name: node.name,
          angle: params.angle,
          x: node.x,
          y: node.y
        };
      } catch (e) {
        return {
          id: node.id,
          name: node.name,
          angle: params.angle,
          x: 0,
          y: 0
        };
      }
    });
  }
  function colorsMatch(a, b, tolerance = 0.01) {
    return Math.abs(a.r - b.r) < tolerance && Math.abs(a.g - b.g) < tolerance && Math.abs(a.b - b.b) < tolerance;
  }
  function replaceColorsInNode(node, oldColor, newColor, tolerance, includeStrokes) {
    let replacedCount = 0;
    if ("fills" in node && Array.isArray(node.fills)) {
      const fills = node.fills;
      let fillsReplaced = 0;
      const newFills = fills.map((fill) => {
        if (fill.type === "SOLID" && colorsMatch(fill.color, oldColor, tolerance)) {
          fillsReplaced++;
          return __spreadProps(__spreadValues({}, fill), { color: newColor });
        }
        return fill;
      });
      if (fillsReplaced > 0) {
        node.fills = newFills;
        replacedCount += fillsReplaced;
      }
    }
    if (includeStrokes && "strokes" in node && Array.isArray(node.strokes)) {
      const strokes = node.strokes;
      let strokesReplaced = 0;
      const newStrokes = strokes.map((stroke) => {
        if (stroke.type === "SOLID" && colorsMatch(stroke.color, oldColor, tolerance)) {
          strokesReplaced++;
          return __spreadProps(__spreadValues({}, stroke), { color: newColor });
        }
        return stroke;
      });
      if (strokesReplaced > 0) {
        node.strokes = newStrokes;
        replacedCount += strokesReplaced;
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        replacedCount += replaceColorsInNode(child, oldColor, newColor, tolerance, includeStrokes);
      }
    }
    return replacedCount;
  }
  function replaceColor(params) {
    return __async(this, null, function* () {
      const { nodeId, oldColor, newColor, tolerance = 0.02, includeStrokes = true } = params;
      const node = yield getNode(nodeId);
      const oldRGB = { r: oldColor.r, g: oldColor.g, b: oldColor.b };
      const newRGB = { r: newColor.r, g: newColor.g, b: newColor.b };
      let totalReplaced = 0;
      totalReplaced += replaceColorsInNode(node, oldRGB, newRGB, tolerance, includeStrokes);
      return {
        id: nodeId,
        name: node.name,
        oldColor,
        newColor,
        replacedCount: totalReplaced
      };
    });
  }
  function makeSolidPaint(color) {
    return {
      type: "SOLID",
      color: { r: color.r, g: color.g, b: color.b },
      opacity: color.a != null ? color.a : 1
    };
  }
  function makeShadowEffect(shadowParams, type) {
    var _a, _b;
    return {
      type,
      visible: true,
      color: {
        r: shadowParams.shadowColor.r,
        g: shadowParams.shadowColor.g,
        b: shadowParams.shadowColor.b,
        a: (_a = shadowParams.shadowColor.a) != null ? _a : 0.25
      },
      offset: { x: shadowParams.offsetX, y: shadowParams.offsetY },
      radius: shadowParams.radius,
      spread: (_b = shadowParams.spread) != null ? _b : 0,
      blendMode: "NORMAL"
    };
  }
  function makeGradientPaint(stops, gradientType = "GRADIENT_LINEAR", angle) {
    const colorStops = stops.map((s) => {
      var _a;
      return {
        position: s.position,
        color: { r: s.r, g: s.g, b: s.b, a: (_a = s.a) != null ? _a : 1 }
      };
    });
    const rad = (angle != null ? angle : 0) * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      type: gradientType,
      gradientStops: colorStops,
      gradientTransform: [
        [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
        [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
      ]
    };
  }
  function createPolygon(params) {
    return __async(this, null, function* () {
      const polygon = figma.createPolygon();
      polygon.resize(params.width, params.height);
      polygon.pointCount = params.pointCount;
      if (params.name) polygon.name = params.name;
      if (params.fillColor) polygon.fills = [makeSolidPaint(params.fillColor)];
      if (params.strokeColor) polygon.strokes = [makeSolidPaint(params.strokeColor)];
      if (params.strokeWeight !== void 0) polygon.strokeWeight = params.strokeWeight;
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(polygon);
      }
      polygon.x = params.x;
      polygon.y = params.y;
      return { id: polygon.id, name: polygon.name, type: polygon.type, pointCount: polygon.pointCount };
    });
  }
  function createStar(params) {
    return __async(this, null, function* () {
      var _a;
      const star = figma.createStar();
      star.resize(params.width, params.height);
      star.pointCount = params.pointCount;
      star.innerRadius = (_a = params.innerRadius) != null ? _a : 50;
      if (params.name) star.name = params.name;
      if (params.fillColor) star.fills = [makeSolidPaint(params.fillColor)];
      if (params.strokeColor) star.strokes = [makeSolidPaint(params.strokeColor)];
      if (params.strokeWeight !== void 0) star.strokeWeight = params.strokeWeight;
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(star);
      }
      star.x = params.x;
      star.y = params.y;
      return { id: star.id, name: star.name, type: star.type, pointCount: star.pointCount, innerRadius: star.innerRadius };
    });
  }
  function createLine(params) {
    return __async(this, null, function* () {
      const dx = params.endX - params.startX;
      const dy = params.endY - params.startY;
      const length = Math.hypot(dx, dy);
      const angleDeg = Math.atan2(-dy, dx) * 180 / Math.PI;
      const line = figma.createLine();
      if (params.name) line.name = params.name;
      line.resize(length, 0);
      line.rotation = angleDeg;
      if (params.strokeColor) line.strokes = [makeSolidPaint(params.strokeColor)];
      if (params.strokeWeight !== void 0) line.strokeWeight = params.strokeWeight;
      if (params.strokeCap) line.strokeCap = params.strokeCap;
      if (params.dashPattern) line.dashPattern = params.dashPattern;
      const parent = params.parentId ? yield resolveNodeId(params.parentId) : getCurrentParent();
      if (parent && "appendChild" in parent) {
        parent.appendChild(line);
      }
      line.x = params.startX;
      line.y = params.startY;
      return {
        id: line.id,
        name: line.name,
        type: line.type,
        startX: params.startX,
        startY: params.startY,
        endX: params.endX,
        endY: params.endY,
        length
      };
    });
  }
  function createMask(params) {
    return __async(this, null, function* () {
      var _a;
      const maskNode = yield getNode(params.maskNodeId);
      const contentNodes = [];
      for (const id of params.contentNodeIds) {
        contentNodes.push(yield getNode(id));
      }
      if ("isMask" in maskNode) {
        maskNode.isMask = true;
      } else {
        throw new Error("Chosen mask node cannot act as a mask");
      }
      const parent = maskNode.parent || getCurrentParent();
      const grouped = figma.group([maskNode, ...contentNodes], parent);
      grouped.name = (_a = params.groupName) != null ? _a : "Mask Group";
      return {
        id: grouped.id,
        name: grouped.name,
        maskNodeId: params.maskNodeId,
        contentNodeIds: params.contentNodeIds
      };
    });
  }
  function getNodeInfoByTypes(params) {
    return __async(this, null, function* () {
      const node = yield figma.getNodeByIdAsync(params.nodeId);
      if (!node) throw new Error(`Node not found: ${params.nodeId}`);
      const matchingNodes = [];
      function scan(n) {
        if (params.types.includes(n.type)) {
          const info = { id: n.id, name: n.name, type: n.type };
          if ("x" in n) info.x = n.x;
          if ("y" in n) info.y = n.y;
          if ("width" in n) info.width = n.width;
          if ("height" in n) info.height = n.height;
          matchingNodes.push({ nodeId: n.id, nodeInfo: info });
        }
        if ("children" in n) {
          for (const child of n.children) {
            scan(child);
          }
        }
      }
      scan(node);
      return {
        success: true,
        count: matchingNodes.length,
        matchingNodes,
        searchedTypes: params.types
      };
    });
  }
  function getResultImage(params) {
    return __async(this, null, function* () {
      const scale = params.scale || 1;
      const page = params.pageId ? yield figma.getNodeByIdAsync(params.pageId) : figma.currentPage;
      if (!page) throw new Error(`Page not found: ${params.pageId}`);
      const exportable = page.children.filter(
        (n) => "exportAsync" in n && n.visible
      );
      if (exportable.length === 0) {
        return { pageId: page.id, mimeType: "image/png", imageData: "" };
      }
      const group = figma.group(exportable, page);
      try {
        const bytes = yield group.exportAsync({
          format: "PNG",
          constraint: { type: "SCALE", value: scale }
        });
        return {
          pageId: page.id,
          mimeType: "image/png",
          imageData: base64Encode(bytes)
        };
      } finally {
        figma.ungroup(group);
      }
    });
  }
  function getPageStructure() {
    return __async(this, null, function* () {
      function buildInfo(n) {
        const info = {
          id: n.id,
          name: n.name,
          type: n.type,
          position: { x: n.x, y: n.y },
          size: { width: n.width, height: n.height }
        };
        if ("children" in n && n.children.length) {
          info.children = n.children.map((c) => buildInfo(c));
        }
        return info;
      }
      const structureTree = figma.currentPage.children.map((n) => buildInfo(n));
      return {
        pageId: figma.currentPage.id,
        pageName: figma.currentPage.name,
        structureTree
      };
    });
  }
  function reorderNode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (!node.parent) throw new Error("Node has no parent \u2013 cannot reorder");
      const parent = node.parent;
      const siblings = parent.children;
      const oldIndex = siblings.findIndex((n) => n.id === params.nodeId);
      if (oldIndex === -1) throw new Error("Node not in parent.children");
      let newIndex = 0;
      switch (params.direction) {
        case "TOP":
          newIndex = siblings.length;
          break;
        case "BOTTOM":
          newIndex = 0;
          break;
        case "FORWARD":
          newIndex = Math.min(oldIndex + 2, siblings.length);
          break;
        case "BACKWARD":
          newIndex = Math.max(oldIndex - 1, 0);
          break;
      }
      if (newIndex !== oldIndex && "insertChild" in parent) {
        parent.insertChild(newIndex, node);
      }
      return {
        id: node.id,
        name: node.name,
        parentId: parent.id,
        oldIndex,
        newIndex
      };
    });
  }
  function booleanNodes(params) {
    return __async(this, null, function* () {
      var _a;
      const targets = [];
      for (const id of params.nodeIds) {
        targets.push(yield getNode(id));
      }
      const parent = (_a = targets[0].parent) != null ? _a : getCurrentParent();
      let booleanNode;
      switch (params.operation) {
        case "UNION":
          booleanNode = figma.union(targets, parent);
          break;
        case "SUBTRACT":
          booleanNode = figma.subtract(targets, parent);
          break;
        case "INTERSECT":
          booleanNode = figma.intersect(targets, parent);
          break;
        case "EXCLUDE":
          booleanNode = figma.exclude(targets, parent);
          break;
      }
      return {
        id: booleanNode.id,
        name: booleanNode.name,
        operation: booleanNode.booleanOperation,
        parentId: parent.id,
        containedIds: targets.map((n) => n.id)
      };
    });
  }
  function getStyles() {
    return __async(this, null, function* () {
      var _a, _b, _c;
      const safeGet = (fn) => __async(null, null, function* () {
        try {
          return typeof fn === "function" ? yield fn() : [];
        } catch (e) {
          return [];
        }
      });
      const styles = {
        colors: yield safeGet((_a = figma.getLocalPaintStylesAsync) == null ? void 0 : _a.bind(figma)),
        texts: yield safeGet((_b = figma.getLocalTextStylesAsync) == null ? void 0 : _b.bind(figma)),
        effects: yield safeGet((_c = figma.getLocalEffectStylesAsync) == null ? void 0 : _c.bind(figma))
      };
      return {
        colors: (styles.colors || []).map((s) => {
          var _a2;
          return {
            id: s.id,
            name: s.name,
            key: s.key,
            paint: (_a2 = s.paints) == null ? void 0 : _a2[0]
          };
        }),
        texts: (styles.texts || []).map((s) => ({
          id: s.id,
          name: s.name,
          key: s.key,
          fontSize: s.fontSize,
          fontName: s.fontName
        })),
        effects: (styles.effects || []).map((s) => ({
          id: s.id,
          name: s.name,
          key: s.key
        }))
      };
    });
  }
  function setFillGradient(params) {
    return __async(this, null, function* () {
      var _a;
      const node = yield getNode(params.nodeId);
      if (!("fills" in node)) throw new Error("Node does not support fills");
      node.fills = [
        makeGradientPaint(
          params.gradientStops,
          (_a = params.gradientType) != null ? _a : "GRADIENT_LINEAR",
          params.angle
        )
      ];
      return { id: node.id, name: node.name };
    });
  }
  function setDropShadow(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (!("effects" in node)) throw new Error("Node does not support effects");
      const shadow = makeShadowEffect(params, "DROP_SHADOW");
      node.effects = [
        ...node.effects.filter((e) => e.type !== "DROP_SHADOW"),
        shadow
      ];
      return { id: node.id, name: node.name };
    });
  }
  function setInnerShadow(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (!("effects" in node)) throw new Error("Node does not support effects");
      const shadow = makeShadowEffect(params, "INNER_SHADOW");
      node.effects = [
        ...node.effects.filter((e) => e.type !== "INNER_SHADOW"),
        shadow
      ];
      return { id: node.id, name: node.name };
    });
  }
  function copyStyle(params) {
    return __async(this, null, function* () {
      var _a;
      const src = yield getNode(params.sourceNodeId);
      const dst = yield getNode(params.targetNodeId);
      const props = (_a = params.properties) != null ? _a : ["fills", "strokes", "effects", "cornerRadius", "opacity"];
      props.forEach((prop) => {
        if (prop in src && prop in dst) {
          dst[prop] = src[prop];
        }
      });
      return {
        sourceName: src.name,
        targetName: dst.name,
        copied: props
      };
    });
  }
  function setBlendMode(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (!("blendMode" in node)) throw new Error("Node does not support blendMode");
      node.blendMode = params.blendMode;
      return { id: node.id, name: node.name, blendMode: node.blendMode };
    });
  }
  function setPadding(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
        throw new Error(`Node type "${node.type}" does not support padding`);
      }
      const frame = node;
      if (params.paddingTop !== void 0) frame.paddingTop = params.paddingTop;
      if (params.paddingRight !== void 0) frame.paddingRight = params.paddingRight;
      if (params.paddingBottom !== void 0) frame.paddingBottom = params.paddingBottom;
      if (params.paddingLeft !== void 0) frame.paddingLeft = params.paddingLeft;
      return {
        id: frame.id,
        name: frame.name,
        paddingTop: frame.paddingTop,
        paddingRight: frame.paddingRight,
        paddingBottom: frame.paddingBottom,
        paddingLeft: frame.paddingLeft
      };
    });
  }
  function setAxisAlign(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
        throw new Error(`Node type "${node.type}" does not support axis alignment`);
      }
      const frame = node;
      if (params.primaryAxisAlignItems !== void 0) {
        frame.primaryAxisAlignItems = params.primaryAxisAlignItems;
      }
      if (params.counterAxisAlignItems !== void 0) {
        frame.counterAxisAlignItems = params.counterAxisAlignItems;
      }
      return {
        id: frame.id,
        name: frame.name,
        primaryAxisAlignItems: frame.primaryAxisAlignItems,
        counterAxisAlignItems: frame.counterAxisAlignItems,
        layoutMode: frame.layoutMode
      };
    });
  }
  function setLayoutSizing(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const n = node;
      if (params.layoutSizingHorizontal !== void 0) {
        n.layoutSizingHorizontal = params.layoutSizingHorizontal;
      }
      if (params.layoutSizingVertical !== void 0) {
        n.layoutSizingVertical = params.layoutSizingVertical;
      }
      return {
        id: n.id,
        name: n.name,
        type: node.type,
        layoutSizingHorizontal: n.layoutSizingHorizontal,
        layoutSizingVertical: n.layoutSizingVertical
      };
    });
  }
  function setChildLayoutProps(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const n = node;
      if (params.layoutPositioning !== void 0) {
        n.layoutPositioning = params.layoutPositioning;
      }
      if (params.layoutGrow !== void 0) {
        n.layoutGrow = params.layoutGrow;
      }
      if (params.layoutAlign !== void 0) {
        n.layoutAlign = params.layoutAlign;
      }
      return {
        id: n.id,
        name: n.name,
        type: node.type,
        layoutPositioning: n.layoutPositioning,
        layoutGrow: n.layoutGrow,
        layoutAlign: n.layoutAlign
      };
    });
  }
  function setConstraints(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      const n = node;
      const current = n.constraints || { horizontal: "MIN", vertical: "MIN" };
      n.constraints = {
        horizontal: params.horizontal || current.horizontal,
        vertical: params.vertical || current.vertical
      };
      return {
        id: n.id,
        name: n.name,
        type: node.type,
        constraints: n.constraints
      };
    });
  }
  function setItemSpacing(params) {
    return __async(this, null, function* () {
      const node = yield getNode(params.nodeId);
      if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" && node.type !== "INSTANCE") {
        throw new Error(`Node type "${node.type}" does not support item spacing`);
      }
      const frame = node;
      frame.itemSpacing = params.itemSpacing;
      return {
        id: frame.id,
        name: frame.name,
        itemSpacing: frame.itemSpacing,
        layoutMode: frame.layoutMode
      };
    });
  }
  var init_contentHandlers = __esm({
    "src/handlers/contentHandlers.ts"() {
      "use strict";
      init_bridge();
    }
  });

  // src/handlers/chartHandlers.ts
  function resolveNode(id) {
    return __async(this, null, function* () {
      return yield lookupNode(id);
    });
  }
  function getParentNode(parentId) {
    return __async(this, null, function* () {
      if (parentId) {
        const node = yield resolveNode(parentId);
        if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
          return node;
        }
      }
      const focusedSlide = figma.currentPage.focusedSlide;
      return focusedSlide || figma.currentPage;
    });
  }
  function toFigmaColor(color) {
    return { r: color.r, g: color.g, b: color.b };
  }
  function applyScaleConstraints(parent) {
    for (const child of parent.children) {
      if ("constraints" in child) {
        child.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      }
    }
  }
  function getColor(dataPoint, index, defaultColors) {
    if (dataPoint.color) return dataPoint.color;
    return defaultColors[index % defaultColors.length];
  }
  function getSeriesColor(series, index, defaultColors) {
    if (series.color) return series.color;
    return defaultColors[index % defaultColors.length];
  }
  function createMarkerShape(shape, cx, cy, size, fillColor, strokeColor, strokeWeight) {
    const s = size * 1.3;
    const half = s / 2;
    switch (shape) {
      case "square": {
        const rect = figma.createRectangle();
        rect.resize(s, s);
        rect.x = cx - half;
        rect.y = cy - half;
        rect.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          rect.strokes = [{ type: "SOLID", color: strokeColor }];
          rect.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return rect;
      }
      case "diamond": {
        const dSize = size * 1.5;
        const rect = figma.createRectangle();
        rect.resize(dSize, dSize);
        rect.rotation = 45;
        rect.x = cx - dSize * 0.35;
        rect.y = cy - dSize * 0.5;
        rect.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          rect.strokes = [{ type: "SOLID", color: strokeColor }];
          rect.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return rect;
      }
      case "triangle_up": {
        const poly = figma.createPolygon();
        poly.pointCount = 3;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "triangle_down": {
        const poly = figma.createPolygon();
        poly.pointCount = 3;
        poly.resize(s, s);
        poly.rotation = 180;
        poly.x = cx + half;
        poly.y = cy + half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "star": {
        const star = figma.createStar();
        star.pointCount = 5;
        star.innerRadius = 0.4;
        star.resize(s, s);
        star.x = cx - half;
        star.y = cy - half;
        star.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          star.strokes = [{ type: "SOLID", color: strokeColor }];
          star.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return star;
      }
      case "pentagon": {
        const poly = figma.createPolygon();
        poly.pointCount = 5;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "hexagon": {
        const poly = figma.createPolygon();
        poly.pointCount = 6;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "x": {
        const pad = s * 0.15;
        const sw = Math.max(1.5, s * 0.2);
        const r = Math.round;
        const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
        const svgStr = `<svg width="${s}" height="${s}"><line x1="${pad}" y1="${pad}" x2="${s - pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${s - pad}" y1="${pad}" x2="${pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
        const node = figma.createNodeFromSvg(svgStr);
        node.x = cx - half;
        node.y = cy - half;
        return node;
      }
      case "plus": {
        const mid = s / 2;
        const pad = s * 0.1;
        const sw = Math.max(1.5, s * 0.2);
        const r = Math.round;
        const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
        const svgStr = `<svg width="${s}" height="${s}"><line x1="${mid}" y1="${pad}" x2="${mid}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${pad}" y1="${mid}" x2="${s - pad}" y2="${mid}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
        const node = figma.createNodeFromSvg(svgStr);
        node.x = cx - half;
        node.y = cy - half;
        return node;
      }
      case "circle":
      default: {
        const ellipse = figma.createEllipse();
        ellipse.resize(s, s);
        ellipse.x = cx - half;
        ellipse.y = cy - half;
        ellipse.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          ellipse.strokes = [{ type: "SOLID", color: strokeColor }];
          ellipse.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return ellipse;
      }
    }
  }
  function loadFont(family = "Inter", style = "Regular") {
    return __async(this, null, function* () {
      try {
        yield figma.loadFontAsync({ family, style });
      } catch (e) {
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    });
  }
  function createTextNode(_0, _1, _2) {
    return __async(this, arguments, function* (text, x, y, fontSize = 12, color = { r: 0, g: 0, b: 0, a: 1 }, align = "LEFT") {
      yield loadFont();
      const textNode = figma.createText();
      textNode.characters = text;
      textNode.fontSize = fontSize;
      textNode.x = x;
      textNode.y = y;
      textNode.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
      textNode.textAlignHorizontal = align;
      return textNode;
    });
  }
  function saveChartMetadata(node, metadata) {
    node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(metadata));
  }
  function loadChartMetadata(node) {
    const data = node.getPluginData(PLUGIN_DATA_KEY);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  function getSeriesLabels(seriesArr) {
    const labelsSet = /* @__PURE__ */ new Set();
    for (const s of seriesArr) {
      for (const d of s.data) {
        labelsSet.add(d.label);
      }
    }
    return Array.from(labelsSet);
  }
  function getSeriesValue(series, label) {
    const point = series.data.find((d) => d.label === label);
    return point ? point.value : 0;
  }
  function renderBarChartContent(_0, _1, _2, _3, _4, _5) {
    return __async(this, arguments, function* (chartGroup, data, defaultColors, width, height, title, orientation = "vertical", style = {}, seriesArr) {
      for (const child of [...chartGroup.children]) {
        child.remove();
      }
      const padding = 40;
      const titleHeight = title ? 30 : 0;
      const hasMultiSeries = seriesArr && seriesArr.length > 0;
      const showLegend = style.showLegend !== false && hasMultiSeries;
      const legendPos = style.legendPosition || "bottom";
      const legendSize = showLegend ? legendPos === "left" || legendPos === "right" ? 120 : 30 : 0;
      const chartAreaX = padding + (showLegend && legendPos === "left" ? legendSize : 0);
      const chartAreaY = padding + titleHeight + (showLegend && legendPos === "top" ? legendSize : 0);
      const chartAreaWidth = width - padding * 2 - (showLegend && (legendPos === "left" || legendPos === "right") ? legendSize : 0);
      const chartAreaHeight = height - padding * 2 - titleHeight - (showLegend && (legendPos === "top" || legendPos === "bottom") ? legendSize : 0);
      const barSpacing = 8;
      if (title) {
        const titleNode = yield createTextNode(
          title,
          width / 2,
          padding / 2,
          style.fontSize ? style.fontSize + 4 : 16,
          { r: 0.2, g: 0.2, b: 0.2, a: 1 },
          "CENTER"
        );
        titleNode.x = (width - titleNode.width) / 2;
        chartGroup.appendChild(titleNode);
      }
      if (hasMultiSeries) {
        const labels = getSeriesLabels(seriesArr);
        const seriesCount = seriesArr.length;
        const catCount = labels.length;
        let maxValue = 0;
        for (const s of seriesArr) {
          for (const d of s.data) {
            maxValue = Math.max(maxValue, d.value);
          }
        }
        if (maxValue === 0) maxValue = 1;
        if (orientation === "vertical") {
          const catStep = chartAreaWidth / catCount;
          const groupPadding = catStep * 0.12;
          const groupW = catStep - groupPadding * 2;
          const barWidth = groupW / seriesCount;
          for (let ci = 0; ci < catCount; ci++) {
            const label = labels[ci];
            for (let si = 0; si < seriesCount; si++) {
              const s = seriesArr[si];
              const val = getSeriesValue(s, label);
              const color = getSeriesColor(s, si, defaultColors);
              const barHeight = val / maxValue * chartAreaHeight;
              const bar = figma.createRectangle();
              bar.name = `Bar: ${label}-${s.name}`;
              bar.x = chartAreaX + ci * catStep + groupPadding + si * barWidth;
              bar.y = chartAreaY + chartAreaHeight - barHeight;
              bar.resize(Math.max(barWidth - 1, 1), Math.max(barHeight, 1));
              bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              bar.cornerRadius = 4;
              chartGroup.appendChild(bar);
              if (style.showValues !== false) {
                const valueNode = yield createTextNode(
                  val.toString(),
                  0,
                  0,
                  style.fontSize || 9,
                  { r: 0.2, g: 0.2, b: 0.2, a: 1 },
                  "CENTER"
                );
                valueNode.x = bar.x + (barWidth - 1) / 2 - valueNode.width / 2;
                valueNode.y = bar.y - 13;
                chartGroup.appendChild(valueNode);
              }
            }
            if (style.showLabels !== false) {
              const labelNode = yield createTextNode(
                label,
                0,
                0,
                style.fontSize || 10,
                { r: 0.4, g: 0.4, b: 0.4, a: 1 },
                "CENTER"
              );
              labelNode.x = chartAreaX + ci * catStep + catStep / 2 - labelNode.width / 2;
              labelNode.y = chartAreaY + chartAreaHeight + 5;
              chartGroup.appendChild(labelNode);
            }
          }
        } else {
          const catStep = chartAreaHeight / catCount;
          const groupPadding = catStep * 0.12;
          const groupH = catStep - groupPadding * 2;
          const barHeight = groupH / seriesCount;
          const labelWidth = 60;
          for (let ci = 0; ci < catCount; ci++) {
            const label = labels[ci];
            for (let si = 0; si < seriesCount; si++) {
              const s = seriesArr[si];
              const val = getSeriesValue(s, label);
              const color = getSeriesColor(s, si, defaultColors);
              const barWidth = val / maxValue * (chartAreaWidth - labelWidth);
              const bar = figma.createRectangle();
              bar.name = `Bar: ${label}-${s.name}`;
              bar.x = chartAreaX + labelWidth;
              bar.y = chartAreaY + ci * catStep + groupPadding + si * barHeight;
              bar.resize(Math.max(barWidth, 1), Math.max(barHeight - 1, 1));
              bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              bar.cornerRadius = 4;
              chartGroup.appendChild(bar);
              if (style.showValues !== false) {
                const valueNode = yield createTextNode(
                  val.toString(),
                  chartAreaX + labelWidth + barWidth + 5,
                  bar.y + (barHeight - 1) / 2 - 5,
                  style.fontSize || 9,
                  { r: 0.2, g: 0.2, b: 0.2, a: 1 }
                );
                chartGroup.appendChild(valueNode);
              }
            }
            if (style.showLabels !== false) {
              const labelNode = yield createTextNode(
                label,
                chartAreaX,
                chartAreaY + ci * catStep + catStep / 2 - 6,
                style.fontSize || 10,
                { r: 0.4, g: 0.4, b: 0.4, a: 1 }
              );
              chartGroup.appendChild(labelNode);
            }
          }
        }
        if (showLegend) {
          if (legendPos === "left" || legendPos === "right") {
            const lx = legendPos === "left" ? padding : chartAreaX + chartAreaWidth + 16;
            let ly = chartAreaY;
            for (let si = 0; si < seriesCount; si++) {
              const s = seriesArr[si];
              const color = getSeriesColor(s, si, defaultColors);
              const box = figma.createRectangle();
              box.name = `Legend: ${s.name}`;
              box.x = lx;
              box.y = ly;
              box.resize(10, 10);
              box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              box.cornerRadius = 2;
              chartGroup.appendChild(box);
              const legendLabel = yield createTextNode(
                s.name,
                lx + 14,
                ly - 1,
                style.fontSize || 10,
                { r: 0.3, g: 0.3, b: 0.3, a: 1 }
              );
              chartGroup.appendChild(legendLabel);
              ly += 20;
            }
          } else {
            let lx = chartAreaX;
            const ly = legendPos === "top" ? padding + titleHeight + 5 : height - padding - legendSize + 5;
            for (let si = 0; si < seriesCount; si++) {
              const s = seriesArr[si];
              const color = getSeriesColor(s, si, defaultColors);
              const box = figma.createRectangle();
              box.name = `Legend: ${s.name}`;
              box.x = lx;
              box.y = ly;
              box.resize(10, 10);
              box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              box.cornerRadius = 2;
              chartGroup.appendChild(box);
              const legendLabel = yield createTextNode(
                s.name,
                lx + 14,
                ly - 1,
                style.fontSize || 10,
                { r: 0.3, g: 0.3, b: 0.3, a: 1 }
              );
              chartGroup.appendChild(legendLabel);
              lx += 14 + legendLabel.width + 16;
            }
          }
        }
      } else {
        const maxValue = Math.max(...data.map((d) => d.value));
        const barCount = data.length;
        if (orientation === "vertical") {
          const totalSpacing = barSpacing * (barCount - 1);
          const barWidth = (chartAreaWidth - totalSpacing) / barCount;
          for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const color = getColor(d, i, defaultColors);
            const barHeight = d.value / maxValue * chartAreaHeight;
            const bar = figma.createRectangle();
            bar.name = `Bar: ${d.label}`;
            bar.x = chartAreaX + i * (barWidth + barSpacing);
            bar.y = chartAreaY + chartAreaHeight - barHeight;
            bar.resize(barWidth, barHeight);
            bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
            bar.cornerRadius = 4;
            chartGroup.appendChild(bar);
            if (style.showLabels !== false) {
              const labelNode = yield createTextNode(
                d.label,
                0,
                0,
                style.fontSize || 10,
                { r: 0.4, g: 0.4, b: 0.4, a: 1 },
                "CENTER"
              );
              labelNode.x = chartAreaX + i * (barWidth + barSpacing) + (barWidth - labelNode.width) / 2;
              labelNode.y = chartAreaY + chartAreaHeight + 5;
              chartGroup.appendChild(labelNode);
            }
            if (style.showValues !== false) {
              const valueNode = yield createTextNode(
                d.value.toString(),
                0,
                0,
                style.fontSize || 10,
                { r: 0.2, g: 0.2, b: 0.2, a: 1 },
                "CENTER"
              );
              valueNode.x = chartAreaX + i * (barWidth + barSpacing) + (barWidth - valueNode.width) / 2;
              valueNode.y = chartAreaY + chartAreaHeight - barHeight - 15;
              chartGroup.appendChild(valueNode);
            }
          }
        } else {
          const totalSpacing = barSpacing * (barCount - 1);
          const barHeight = (chartAreaHeight - totalSpacing) / barCount;
          for (let i = 0; i < data.length; i++) {
            const d = data[i];
            const color = getColor(d, i, defaultColors);
            const barWidth = d.value / maxValue * (chartAreaWidth - 60);
            const bar = figma.createRectangle();
            bar.name = `Bar: ${d.label}`;
            bar.x = chartAreaX + 60;
            bar.y = chartAreaY + i * (barHeight + barSpacing);
            bar.resize(barWidth, barHeight);
            bar.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
            bar.cornerRadius = 4;
            chartGroup.appendChild(bar);
            if (style.showLabels !== false) {
              const labelNode = yield createTextNode(
                d.label,
                chartAreaX,
                chartAreaY + i * (barHeight + barSpacing) + (barHeight - 12) / 2,
                style.fontSize || 10,
                { r: 0.4, g: 0.4, b: 0.4, a: 1 }
              );
              chartGroup.appendChild(labelNode);
            }
            if (style.showValues !== false) {
              const valueNode = yield createTextNode(
                d.value.toString(),
                chartAreaX + 60 + barWidth + 5,
                chartAreaY + i * (barHeight + barSpacing) + (barHeight - 12) / 2,
                style.fontSize || 10,
                { r: 0.2, g: 0.2, b: 0.2, a: 1 }
              );
              chartGroup.appendChild(valueNode);
            }
          }
        }
      }
    });
  }
  function renderLineChartContent(_0, _1, _2, _3, _4, _5) {
    return __async(this, arguments, function* (chartGroup, data, defaultColors, width, height, title, style = {}, seriesArr, markerShape = "circle") {
      for (const child of [...chartGroup.children]) {
        child.remove();
      }
      const padding = 50;
      const titleHeight = title ? 30 : 0;
      const hasMultiSeries = seriesArr && seriesArr.length > 0;
      const showLegend = style.showLegend !== false && hasMultiSeries;
      const legendPos = style.legendPosition || "bottom";
      const legendSize = showLegend ? legendPos === "left" || legendPos === "right" ? 120 : 30 : 0;
      const chartAreaX = padding + (showLegend && legendPos === "left" ? legendSize : 0);
      const chartAreaY = padding + titleHeight + (showLegend && legendPos === "top" ? legendSize : 0);
      const chartAreaWidth = width - padding * 2 - (showLegend && (legendPos === "left" || legendPos === "right") ? legendSize : 0);
      const chartAreaHeight = height - padding * 2 - titleHeight - (showLegend && (legendPos === "top" || legendPos === "bottom") ? legendSize : 0);
      if (title) {
        const titleNode = yield createTextNode(
          title,
          width / 2,
          padding / 2,
          style.fontSize ? style.fontSize + 4 : 16,
          { r: 0.2, g: 0.2, b: 0.2, a: 1 },
          "CENTER"
        );
        titleNode.x = (width - titleNode.width) / 2;
        chartGroup.appendChild(titleNode);
      }
      if (hasMultiSeries) {
        const labels = getSeriesLabels(seriesArr);
        const catCount = labels.length;
        let globalMin = Infinity;
        let globalMax = -Infinity;
        for (const s of seriesArr) {
          for (const d of s.data) {
            globalMin = Math.min(globalMin, d.value);
            globalMax = Math.max(globalMax, d.value);
          }
        }
        if (globalMin === globalMax) {
          globalMin -= 1;
          globalMax += 1;
        }
        const valueRange = globalMax - globalMin;
        const stepX = chartAreaWidth / (catCount - 1 || 1);
        for (let si = 0; si < seriesArr.length; si++) {
          const s = seriesArr[si];
          const lineColor = getSeriesColor(s, si, defaultColors);
          const points = [];
          for (let i = 0; i < catCount; i++) {
            const val = getSeriesValue(s, labels[i]);
            const px = chartAreaX + i * stepX;
            const py = chartAreaY + chartAreaHeight - (val - globalMin) / valueRange * chartAreaHeight;
            points.push({ x: px, y: py });
          }
          if (points.length > 1) {
            let pathD = `M ${points[0].x} ${points[0].y}`;
            for (let i = 1; i < points.length; i++) {
              pathD += ` L ${points[i].x} ${points[i].y}`;
            }
            const rgb = `rgb(${Math.round(lineColor.r * 255)},${Math.round(lineColor.g * 255)},${Math.round(lineColor.b * 255)})`;
            const lineSvg = `<svg width="${width}" height="${height}"><path d="${pathD}" fill="none" stroke="${rgb}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
            try {
              const lineNode = figma.createNodeFromSvg(lineSvg);
              lineNode.name = `Line: ${s.name}`;
              lineNode.x = 0;
              lineNode.y = 0;
              lineNode.clipsContent = false;
              chartGroup.appendChild(lineNode);
            } catch (e) {
              console.error("Error creating line:", e);
            }
          }
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const point = createMarkerShape(
              markerShape,
              p.x,
              p.y,
              8,
              toFigmaColor(lineColor),
              { r: 1, g: 1, b: 1 },
              1.5
            );
            point.name = `Point: ${s.name}-${labels[i]}`;
            chartGroup.appendChild(point);
            if (style.showValues !== false) {
              const val = getSeriesValue(s, labels[i]);
              const valueNode = yield createTextNode(
                val.toString(),
                0,
                0,
                style.fontSize || 9,
                { r: 0.2, g: 0.2, b: 0.2, a: 1 },
                "CENTER"
              );
              valueNode.x = p.x - valueNode.width / 2;
              valueNode.y = p.y - 18;
              chartGroup.appendChild(valueNode);
            }
          }
        }
        if (style.showLabels !== false) {
          for (let i = 0; i < catCount; i++) {
            const px = chartAreaX + i * stepX;
            const labelNode = yield createTextNode(
              labels[i],
              0,
              0,
              style.fontSize || 10,
              { r: 0.4, g: 0.4, b: 0.4, a: 1 },
              "CENTER"
            );
            labelNode.x = px - labelNode.width / 2;
            labelNode.y = chartAreaY + chartAreaHeight + 5;
            chartGroup.appendChild(labelNode);
          }
        }
        if (showLegend) {
          if (legendPos === "left" || legendPos === "right") {
            const lx = legendPos === "left" ? padding : chartAreaX + chartAreaWidth + 16;
            let ly = chartAreaY;
            for (let si = 0; si < seriesArr.length; si++) {
              const s = seriesArr[si];
              const color = getSeriesColor(s, si, defaultColors);
              const box = figma.createRectangle();
              box.name = `Legend: ${s.name}`;
              box.x = lx;
              box.y = ly;
              box.resize(10, 10);
              box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              box.cornerRadius = 2;
              chartGroup.appendChild(box);
              const legendLabel = yield createTextNode(
                s.name,
                lx + 14,
                ly - 1,
                style.fontSize || 10,
                { r: 0.3, g: 0.3, b: 0.3, a: 1 }
              );
              chartGroup.appendChild(legendLabel);
              ly += 20;
            }
          } else {
            let lx = chartAreaX;
            const ly = legendPos === "top" ? padding + titleHeight + 5 : height - padding - legendSize + 5;
            for (let si = 0; si < seriesArr.length; si++) {
              const s = seriesArr[si];
              const color = getSeriesColor(s, si, defaultColors);
              const box = figma.createRectangle();
              box.name = `Legend: ${s.name}`;
              box.x = lx;
              box.y = ly;
              box.resize(10, 10);
              box.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
              box.cornerRadius = 2;
              chartGroup.appendChild(box);
              const legendLabel = yield createTextNode(
                s.name,
                lx + 14,
                ly - 1,
                style.fontSize || 10,
                { r: 0.3, g: 0.3, b: 0.3, a: 1 }
              );
              chartGroup.appendChild(legendLabel);
              lx += 14 + legendLabel.width + 16;
            }
          }
        }
      } else {
        const maxValue = Math.max(...data.map((d) => d.value));
        const minValue = Math.min(...data.map((d) => d.value));
        const valueRange = maxValue - minValue || 1;
        const lineColor = defaultColors[0];
        const points = [];
        const stepX = chartAreaWidth / (data.length - 1 || 1);
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const px = chartAreaX + i * stepX;
          const py = chartAreaY + chartAreaHeight - (d.value - minValue) / valueRange * chartAreaHeight;
          points.push({ x: px, y: py });
        }
        if (points.length > 1) {
          let pathD = `M ${points[0].x} ${points[0].y}`;
          for (let i = 1; i < points.length; i++) {
            pathD += ` L ${points[i].x} ${points[i].y}`;
          }
          const lineSvg = `<svg width="${width}" height="${height}">
        <path d="${pathD}" fill="none" stroke="rgb(${Math.round(lineColor.r * 255)},${Math.round(lineColor.g * 255)},${Math.round(lineColor.b * 255)})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>`;
          try {
            const lineNode = figma.createNodeFromSvg(lineSvg);
            lineNode.name = "Line";
            lineNode.x = 0;
            lineNode.y = 0;
            lineNode.clipsContent = false;
            chartGroup.appendChild(lineNode);
          } catch (e) {
            console.error("Error creating line:", e);
          }
        }
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const p = points[i];
          const point = createMarkerShape(
            markerShape,
            p.x,
            p.y,
            8,
            toFigmaColor(lineColor)
          );
          point.name = `Point: ${d.label}`;
          chartGroup.appendChild(point);
          if (style.showLabels !== false) {
            const labelNode = yield createTextNode(
              d.label,
              0,
              0,
              style.fontSize || 10,
              { r: 0.4, g: 0.4, b: 0.4, a: 1 },
              "CENTER"
            );
            labelNode.x = p.x - labelNode.width / 2;
            labelNode.y = chartAreaY + chartAreaHeight + 5;
            chartGroup.appendChild(labelNode);
          }
          if (style.showValues !== false) {
            const valueNode = yield createTextNode(
              d.value.toString(),
              0,
              0,
              style.fontSize || 10,
              { r: 0.2, g: 0.2, b: 0.2, a: 1 },
              "CENTER"
            );
            valueNode.x = p.x - valueNode.width / 2;
            valueNode.y = p.y - 18;
            chartGroup.appendChild(valueNode);
          }
        }
      }
    });
  }
  function renderPieChartContent(_0, _1, _2, _3, _4) {
    return __async(this, arguments, function* (chartGroup, data, defaultColors, size, title, style = {}, isDonut = false, innerRadius = 0.6, centerLabel) {
      for (const child of [...chartGroup.children]) {
        child.remove();
      }
      const titleHeight = title ? 30 : 0;
      const showLegend = style.showLegend !== false;
      const legendPos = style.legendPosition || "bottom";
      const legendItemH = data.length * 20 + 10;
      const legendSideW = 140;
      const isLegendSide = legendPos === "left" || legendPos === "right";
      const legendH = showLegend && !isLegendSide ? legendItemH : 0;
      const legendW = showLegend && isLegendSide ? legendSideW : 0;
      const totalHeight = size + titleHeight + legendH + 20;
      const totalWidth = size + 40 + legendW;
      chartGroup.resize(totalWidth, totalHeight);
      const chartOffsetX = showLegend && legendPos === "left" ? legendW : 0;
      const centerX = chartOffsetX + (size + 40) / 2;
      const centerY = titleHeight + (showLegend && legendPos === "top" ? legendItemH : 0) + 10 + size / 2;
      const outerRadius = size / 2 - 10;
      if (title) {
        const titleNode = yield createTextNode(
          title,
          0,
          10,
          style.fontSize ? style.fontSize + 4 : 16,
          { r: 0.2, g: 0.2, b: 0.2, a: 1 },
          "CENTER"
        );
        titleNode.x = (size + 40 - titleNode.width) / 2;
        chartGroup.appendChild(titleNode);
      }
      const total = data.reduce((sum, d) => sum + d.value, 0);
      let currentAngle = -Math.PI / 2;
      const TWO_PI = 2 * Math.PI;
      const normalizeAngle = (a) => (a % TWO_PI + TWO_PI) % TWO_PI;
      for (let i = 0; i < data.length; i++) {
        const d = data[i];
        const color = getColor(d, i, defaultColors);
        const sliceAngle = d.value / total * TWO_PI;
        const endAngle = currentAngle + sliceAngle;
        const ellipse = figma.createEllipse();
        ellipse.resize(outerRadius * 2, outerRadius * 2);
        ellipse.x = centerX - outerRadius;
        ellipse.y = centerY - outerRadius;
        const normStart = normalizeAngle(currentAngle);
        ellipse.arcData = {
          startingAngle: normStart,
          endingAngle: normStart + sliceAngle,
          innerRadius: isDonut ? innerRadius : 0
        };
        ellipse.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
        ellipse.name = `Slice: ${d.label}`;
        chartGroup.appendChild(ellipse);
        currentAngle = endAngle;
      }
      if (isDonut && centerLabel) {
        const centerLabelNode = yield createTextNode(
          centerLabel,
          0,
          0,
          style.fontSize ? style.fontSize + 2 : 14,
          { r: 0.2, g: 0.2, b: 0.2, a: 1 },
          "CENTER"
        );
        centerLabelNode.x = centerX - centerLabelNode.width / 2;
        centerLabelNode.y = centerY - centerLabelNode.height / 2;
        chartGroup.appendChild(centerLabelNode);
      }
      if (showLegend) {
        let baseLX;
        let baseLY;
        if (legendPos === "left") {
          baseLX = 10;
          baseLY = titleHeight + 10;
        } else if (legendPos === "right") {
          baseLX = chartOffsetX + size + 40 + 10;
          baseLY = titleHeight + 10;
        } else if (legendPos === "top") {
          baseLX = chartOffsetX + 10;
          baseLY = titleHeight + 5;
        } else {
          baseLX = chartOffsetX + 10;
          baseLY = titleHeight + size + 20;
        }
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          const color = getColor(d, i, defaultColors);
          const colorBox = figma.createRectangle();
          colorBox.name = `Legend: ${d.label}`;
          colorBox.x = baseLX;
          colorBox.y = baseLY + i * 20;
          colorBox.resize(12, 12);
          colorBox.fills = [{ type: "SOLID", color: toFigmaColor(color) }];
          colorBox.cornerRadius = 2;
          chartGroup.appendChild(colorBox);
          const percentage = (d.value / total * 100).toFixed(1);
          const labelNode = yield createTextNode(
            `${d.label} (${percentage}%)`,
            baseLX + 20,
            baseLY + i * 20,
            style.fontSize || 10,
            { r: 0.3, g: 0.3, b: 0.3, a: 1 }
          );
          chartGroup.appendChild(labelNode);
        }
      }
    });
  }
  function createBarChart(params) {
    return __async(this, null, function* () {
      var _a;
      const {
        x,
        y,
        width,
        height,
        data = [],
        series,
        defaultColors = SERIES_PALETTE,
        title,
        orientation = "vertical",
        style = {},
        parentId,
        name = "Bar Chart"
      } = params;
      const parent = yield getParentNode(parentId);
      const chartGroup = figma.createFrame();
      chartGroup.name = name;
      chartGroup.x = x;
      chartGroup.y = y;
      chartGroup.resize(width, height);
      chartGroup.fills = style.backgroundColor ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (_a = style.backgroundColor.a) != null ? _a : 1
      }] : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];
      const metadata = { chartType: "bar", data, series, title, style, width, height, orientation };
      saveChartMetadata(chartGroup, metadata);
      yield renderBarChartContent(chartGroup, data, defaultColors, width, height, title, orientation, style, series);
      applyScaleConstraints(chartGroup);
      parent.appendChild(chartGroup);
      const seriesCount = series ? series.length : 1;
      const dataCount = series ? getSeriesLabels(series).length : data.length;
      return { id: chartGroup.id, name: chartGroup.name, chartType: "bar", x, y, width, height, dataCount, seriesCount };
    });
  }
  function createLineChart(params) {
    return __async(this, null, function* () {
      var _a;
      const {
        x,
        y,
        width,
        height,
        data = [],
        series,
        defaultColors = SERIES_PALETTE,
        title,
        style = {},
        parentId,
        name = "Line Chart",
        markerShape = "circle"
      } = params;
      const parent = yield getParentNode(parentId);
      const chartGroup = figma.createFrame();
      chartGroup.name = name;
      chartGroup.x = x;
      chartGroup.y = y;
      chartGroup.resize(width, height);
      chartGroup.fills = style.backgroundColor ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (_a = style.backgroundColor.a) != null ? _a : 1
      }] : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];
      const metadata = { chartType: "line", data, series, title, style, width, height };
      saveChartMetadata(chartGroup, metadata);
      yield renderLineChartContent(chartGroup, data, defaultColors, width, height, title, style, series, markerShape);
      applyScaleConstraints(chartGroup);
      parent.appendChild(chartGroup);
      const seriesCount = series ? series.length : 1;
      const dataCount = series ? getSeriesLabels(series).length : data.length;
      return { id: chartGroup.id, name: chartGroup.name, chartType: "line", x, y, width, height, dataCount, seriesCount };
    });
  }
  function createPieChart(params) {
    return __async(this, null, function* () {
      var _a;
      const { x, y, size, data, defaultColors = SERIES_PALETTE, title, style = {}, parentId, name = "Pie Chart" } = params;
      const parent = yield getParentNode(parentId);
      const chartGroup = figma.createFrame();
      chartGroup.name = name;
      chartGroup.x = x;
      chartGroup.y = y;
      chartGroup.fills = style.backgroundColor ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (_a = style.backgroundColor.a) != null ? _a : 1
      }] : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];
      const metadata = { chartType: "pie", data, title, style, width: size, height: size };
      saveChartMetadata(chartGroup, metadata);
      yield renderPieChartContent(chartGroup, data, defaultColors, size, title, style, false);
      applyScaleConstraints(chartGroup);
      parent.appendChild(chartGroup);
      const total = data.reduce((sum, d) => sum + d.value, 0);
      return { id: chartGroup.id, name: chartGroup.name, chartType: "pie", x, y, size, dataCount: data.length, total };
    });
  }
  function createDonutChart(params) {
    return __async(this, null, function* () {
      var _a;
      const { x, y, size, data, defaultColors = SERIES_PALETTE, title, innerRadius = 0.6, centerLabel, style = {}, parentId, name = "Donut Chart" } = params;
      const parent = yield getParentNode(parentId);
      const chartGroup = figma.createFrame();
      chartGroup.name = name;
      chartGroup.x = x;
      chartGroup.y = y;
      chartGroup.fills = style.backgroundColor ? [{
        type: "SOLID",
        color: toFigmaColor(style.backgroundColor),
        opacity: (_a = style.backgroundColor.a) != null ? _a : 1
      }] : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0 }];
      const metadata = { chartType: "donut", data, title, style, width: size, height: size, innerRadius, centerLabel };
      saveChartMetadata(chartGroup, metadata);
      yield renderPieChartContent(chartGroup, data, defaultColors, size, title, style, true, innerRadius, centerLabel);
      applyScaleConstraints(chartGroup);
      parent.appendChild(chartGroup);
      const total = data.reduce((sum, d) => sum + d.value, 0);
      return { id: chartGroup.id, name: chartGroup.name, chartType: "donut", x, y, size, dataCount: data.length, total };
    });
  }
  function getChartData(params) {
    return __async(this, null, function* () {
      const { chartId } = params;
      const node = yield resolveNode(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const metadata = loadChartMetadata(node);
      if (!metadata) {
        throw new Error(`No chart metadata found for: ${chartId}`);
      }
      return __spreadValues({
        id: chartId,
        name: node.name
      }, metadata);
    });
  }
  function updateChartData(params) {
    return __async(this, null, function* () {
      const { chartId, data, series, defaultColors = SERIES_PALETTE, title } = params;
      const node = yield resolveNode(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const chartFrame = node;
      const metadata = loadChartMetadata(chartFrame);
      if (!metadata) {
        throw new Error(`No chart metadata found. Use get_chart_data first to verify this is a chart.`);
      }
      if (data) metadata.data = data;
      if (series !== void 0) metadata.series = series;
      if (title !== void 0) metadata.title = title;
      saveChartMetadata(chartFrame, metadata);
      const effectiveData = metadata.data || [];
      const effectiveSeries = metadata.series;
      const { chartType, width, height, style = {}, orientation, innerRadius, centerLabel } = metadata;
      switch (chartType) {
        case "bar":
          yield renderBarChartContent(chartFrame, effectiveData, defaultColors, width, height, metadata.title, orientation, style, effectiveSeries);
          break;
        case "line":
          yield renderLineChartContent(chartFrame, effectiveData, defaultColors, width, height, metadata.title, style, effectiveSeries, "circle");
          break;
        case "pie":
          yield renderPieChartContent(chartFrame, effectiveData, defaultColors, width, metadata.title, style, false);
          break;
        case "donut":
          yield renderPieChartContent(chartFrame, effectiveData, defaultColors, width, metadata.title, style, true, innerRadius, centerLabel);
          break;
      }
      applyScaleConstraints(chartFrame);
      const dataCount = effectiveSeries ? getSeriesLabels(effectiveSeries).length : effectiveData.length;
      return { id: chartId, name: chartFrame.name, chartType, dataCount, updated: true };
    });
  }
  function changeChartType(params) {
    return __async(this, null, function* () {
      const { chartId, newType, defaultColors = SERIES_PALETTE } = params;
      const node = yield resolveNode(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const chartFrame = node;
      const metadata = loadChartMetadata(chartFrame);
      if (!metadata) {
        throw new Error(`No chart metadata found for: ${chartId}`);
      }
      const oldType = metadata.chartType;
      metadata.chartType = newType;
      const typeNames = {
        bar: "Bar Chart",
        line: "Line Chart",
        pie: "Pie Chart",
        donut: "Donut Chart"
      };
      chartFrame.name = typeNames[newType];
      if ((newType === "pie" || newType === "donut") && (oldType === "bar" || oldType === "line")) {
        metadata.width = Math.min(metadata.width, metadata.height);
        metadata.height = metadata.width;
      } else if ((newType === "bar" || newType === "line") && (oldType === "pie" || oldType === "donut")) {
        metadata.width = 400;
        metadata.height = 300;
        chartFrame.resize(400, 300);
      }
      saveChartMetadata(chartFrame, metadata);
      const { data, series, width, height, title, style = {}, orientation, innerRadius, centerLabel } = metadata;
      switch (newType) {
        case "bar":
          chartFrame.resize(width, height);
          yield renderBarChartContent(chartFrame, data, defaultColors, width, height, title, orientation, style, series);
          break;
        case "line":
          chartFrame.resize(width, height);
          yield renderLineChartContent(chartFrame, data, defaultColors, width, height, title, style, series, "circle");
          break;
        case "pie":
          yield renderPieChartContent(chartFrame, data, defaultColors, width, title, style, false);
          break;
        case "donut":
          yield renderPieChartContent(chartFrame, data, defaultColors, width, title, style, true, innerRadius != null ? innerRadius : 0.6, centerLabel);
          break;
      }
      applyScaleConstraints(chartFrame);
      return { id: chartId, name: chartFrame.name, oldType, newType, changed: true };
    });
  }
  var PLUGIN_DATA_KEY, SERIES_PALETTE;
  var init_chartHandlers = __esm({
    "src/handlers/chartHandlers.ts"() {
      "use strict";
      init_bridge();
      PLUGIN_DATA_KEY = "chart_metadata";
      SERIES_PALETTE = [
        { r: 0.918, g: 0.263, b: 0.208, a: 1 },
        // #EA4335 red
        { r: 0.259, g: 0.522, b: 0.957, a: 1 },
        // #4285F4 blue
        { r: 0.208, g: 0.659, b: 0.325, a: 1 },
        // #34A853 green
        { r: 0.984, g: 0.737, b: 0.016, a: 1 },
        // #FBBC04 yellow
        { r: 1, g: 0.42, b: 0.176, a: 1 },
        // #FF6B2D orange
        { r: 0.541, g: 0.318, b: 0.831, a: 1 },
        // #8A51D4 purple
        { r: 0, g: 0.737, b: 0.831, a: 1 },
        // #00BCD4 cyan
        { r: 0.914, g: 0.118, b: 0.388, a: 1 }
        // #E91E63 pink
      ];
    }
  });

  // src/handlers/dataChartHandlers.ts
  function toRGB(c) {
    return { r: c.r, g: c.g, b: c.b };
  }
  function loadFont2(family = "Inter", style = "Regular") {
    return __async(this, null, function* () {
      try {
        yield figma.loadFontAsync({ family, style });
      } catch (e) {
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    });
  }
  function makeText(text, x, y, fontSize, color, align = "LEFT", fontFamily) {
    return __async(this, null, function* () {
      yield loadFont2(fontFamily);
      const node = figma.createText();
      node.characters = text;
      node.fontSize = fontSize;
      node.x = x;
      node.y = y;
      node.fills = [{ type: "SOLID", color: toRGB(color) }];
      node.textAlignHorizontal = align;
      return node;
    });
  }
  function formatValue(val, fmt, symbol, decimals) {
    const d = decimals != null ? decimals : 0;
    switch (fmt) {
      case "percent":
        return `${val.toFixed(d)}%`;
      case "currency":
        return `${symbol || "$"}${val.toLocaleString(void 0, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
      default:
        return d > 0 ? val.toFixed(d) : val.toLocaleString();
    }
  }
  function createMarker2(shape, cx, cy, size, fillColor, strokeColor, strokeWeight) {
    const s = size * 1.3;
    const half = s / 2;
    switch (shape) {
      case "square": {
        const rect = figma.createRectangle();
        rect.resize(s, s);
        rect.x = cx - half;
        rect.y = cy - half;
        rect.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          rect.strokes = [{ type: "SOLID", color: strokeColor }];
          rect.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return rect;
      }
      case "diamond": {
        const rect = figma.createRectangle();
        const dSize = size * 1.5;
        rect.resize(dSize, dSize);
        rect.rotation = 45;
        rect.x = cx - dSize * 0.35;
        rect.y = cy - dSize * 0.5;
        rect.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          rect.strokes = [{ type: "SOLID", color: strokeColor }];
          rect.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return rect;
      }
      case "triangle_up": {
        const poly = figma.createPolygon();
        poly.pointCount = 3;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "triangle_down": {
        const poly = figma.createPolygon();
        poly.pointCount = 3;
        poly.resize(s, s);
        poly.rotation = 180;
        poly.x = cx + half;
        poly.y = cy + half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "star": {
        const star = figma.createStar();
        star.pointCount = 5;
        star.innerRadius = 0.4;
        star.resize(s, s);
        star.x = cx - half;
        star.y = cy - half;
        star.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          star.strokes = [{ type: "SOLID", color: strokeColor }];
          star.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return star;
      }
      case "pentagon": {
        const poly = figma.createPolygon();
        poly.pointCount = 5;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "hexagon": {
        const poly = figma.createPolygon();
        poly.pointCount = 6;
        poly.resize(s, s);
        poly.x = cx - half;
        poly.y = cy - half;
        poly.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          poly.strokes = [{ type: "SOLID", color: strokeColor }];
          poly.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return poly;
      }
      case "x": {
        const pad = s * 0.15;
        const sw = Math.max(1.5, s * 0.2);
        const r = Math.round;
        const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
        const svgStr = `<svg width="${s}" height="${s}"><line x1="${pad}" y1="${pad}" x2="${s - pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${s - pad}" y1="${pad}" x2="${pad}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
        const node = figma.createNodeFromSvg(svgStr);
        node.x = cx - half;
        node.y = cy - half;
        return node;
      }
      case "plus": {
        const mid = s / 2;
        const pad = s * 0.1;
        const sw = Math.max(1.5, s * 0.2);
        const r = Math.round;
        const rgb = `rgb(${r(fillColor.r * 255)},${r(fillColor.g * 255)},${r(fillColor.b * 255)})`;
        const svgStr = `<svg width="${s}" height="${s}"><line x1="${mid}" y1="${pad}" x2="${mid}" y2="${s - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${pad}" y1="${mid}" x2="${s - pad}" y2="${mid}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
        const node = figma.createNodeFromSvg(svgStr);
        node.x = cx - half;
        node.y = cy - half;
        return node;
      }
      case "circle":
      default: {
        const ellipse = figma.createEllipse();
        ellipse.resize(s, s);
        ellipse.x = cx - half;
        ellipse.y = cy - half;
        ellipse.fills = [{ type: "SOLID", color: fillColor }];
        if (strokeColor) {
          ellipse.strokes = [{ type: "SOLID", color: strokeColor }];
          ellipse.strokeWeight = strokeWeight != null ? strokeWeight : 0;
        }
        return ellipse;
      }
    }
  }
  function parseTabularData(data, colors) {
    const palette = colors && colors.length > 0 ? colors : DEFAULT_PALETTE;
    const categories = data.rows.map((row) => String(row[0]));
    const series = [];
    for (let col = 1; col < data.headers.length; col++) {
      series.push({
        name: data.headers[col],
        values: data.rows.map((row) => Number(row[col]) || 0),
        color: palette[(col - 1) % palette.length]
      });
    }
    return { categories, series };
  }
  function computeNiceTicks(min, max, targetCount = 5) {
    if (min === max) return [min];
    const range = max - min;
    const roughStep = range / targetCount;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    let niceStep;
    if (residual <= 1.5) niceStep = magnitude;
    else if (residual <= 3) niceStep = 2 * magnitude;
    else if (residual <= 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
      ticks.push(Math.round(v * 1e10) / 1e10);
    }
    return ticks;
  }
  function resolveParentId(id) {
    return __async(this, null, function* () {
      return yield lookupNode(id);
    });
  }
  function getParentNode2(parentId) {
    return __async(this, null, function* () {
      if (parentId) {
        const node = yield resolveParentId(parentId);
        if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
          return node;
        }
      }
      const focusedSlide = figma.currentPage.focusedSlide;
      return focusedSlide || figma.currentPage;
    });
  }
  function computeLayout(width, height, opts) {
    const showTitle = opts.showTitle !== false && !!opts.title;
    const showLegend = opts.showLegend !== false;
    const showAxis = opts.showAxis !== false;
    const legendPos = opts.legendPosition || "bottom";
    const horizontal = opts.orientation === "horizontal";
    let top = CHART_PADDING.top;
    let bottom = CHART_PADDING.bottom;
    let left = CHART_PADDING.left;
    let right = CHART_PADDING.right;
    if (showTitle) top += TITLE_FONT_SIZE + 12;
    if (showAxis) {
      if (horizontal) {
        left += 80;
        bottom += AXIS_LABEL_FONT_SIZE + 8;
        if (opts.yAxisLabel) left += AXIS_LABEL_FONT_SIZE + 6;
        if (opts.xAxisLabel) bottom += AXIS_LABEL_FONT_SIZE + 6;
      } else {
        bottom += AXIS_LABEL_FONT_SIZE + 8;
        left += 40;
        if (opts.xAxisLabel) bottom += AXIS_LABEL_FONT_SIZE + 6;
        if (opts.yAxisLabel) left += AXIS_LABEL_FONT_SIZE + 6;
      }
    }
    if (showLegend) {
      if (legendPos === "bottom") bottom += LEGEND_FONT_SIZE + 16;
      else if (legendPos === "top") top += LEGEND_FONT_SIZE + 16;
      else if (legendPos === "left") left += 120;
      else if (legendPos === "right") right += 120;
    }
    return {
      plotX: left,
      plotY: top,
      plotW: Math.max(width - left - right, 40),
      plotH: Math.max(height - top - bottom, 40)
    };
  }
  function renderTitle(frame, width, opts) {
    return __async(this, null, function* () {
      if (opts.showTitle === false || !opts.title) return;
      const fontSize = opts.fontSize ? opts.fontSize + 4 : TITLE_FONT_SIZE;
      const node = yield makeText(
        opts.title,
        0,
        CHART_PADDING.top,
        fontSize,
        TITLE_COLOR,
        "CENTER",
        opts.fontFamily
      );
      node.x = (width - node.width) / 2;
      node.name = "Title";
      frame.appendChild(node);
    });
  }
  function renderAxis(frame, layout, categories, ticks, opts) {
    return __async(this, null, function* () {
      if (opts.showAxis === false) return;
      const fontSize = opts.fontSize || AXIS_LABEL_FONT_SIZE;
      const yAxisLine = figma.createRectangle();
      yAxisLine.name = "Y-Axis";
      yAxisLine.x = layout.plotX;
      yAxisLine.y = layout.plotY;
      yAxisLine.resize(1, layout.plotH);
      yAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
      frame.appendChild(yAxisLine);
      const xAxisLine = figma.createRectangle();
      xAxisLine.name = "X-Axis";
      xAxisLine.x = layout.plotX;
      xAxisLine.y = layout.plotY + layout.plotH;
      xAxisLine.resize(layout.plotW, 1);
      xAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
      frame.appendChild(xAxisLine);
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      for (const tick of ticks) {
        const ratio = (tick - tickMin) / tickRange;
        const yPos = layout.plotY + layout.plotH - ratio * layout.plotH;
        const tickMark = figma.createRectangle();
        tickMark.name = `Tick-${tick}`;
        tickMark.x = layout.plotX - TICK_LENGTH;
        tickMark.y = yPos;
        tickMark.resize(TICK_LENGTH, 1);
        tickMark.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
        frame.appendChild(tickMark);
        const label = yield makeText(
          formatValue(tick, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "RIGHT",
          opts.fontFamily
        );
        label.x = layout.plotX - TICK_LENGTH - 4 - label.width;
        label.y = yPos - label.height / 2;
        label.name = `YLabel-${tick}`;
        frame.appendChild(label);
      }
      const catStep = layout.plotW / categories.length;
      for (let i = 0; i < categories.length; i++) {
        const cx = layout.plotX + i * catStep + catStep / 2;
        const label = yield makeText(
          categories[i],
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        label.x = cx - label.width / 2;
        label.y = layout.plotY + layout.plotH + 6;
        label.name = `XLabel-${categories[i]}`;
        frame.appendChild(label);
      }
      if (opts.xAxisLabel) {
        const xLabel = yield makeText(
          opts.xAxisLabel,
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        xLabel.x = layout.plotX + layout.plotW / 2 - xLabel.width / 2;
        xLabel.y = layout.plotY + layout.plotH + 6 + fontSize + 6;
        xLabel.name = "X-Axis Label";
        frame.appendChild(xLabel);
      }
      if (opts.yAxisLabel) {
        const yLabel = yield makeText(
          opts.yAxisLabel,
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        yLabel.x = CHART_PADDING.left;
        yLabel.y = layout.plotY + layout.plotH / 2 - yLabel.height / 2;
        yLabel.rotation = 90;
        yLabel.name = "Y-Axis Label";
        frame.appendChild(yLabel);
      }
    });
  }
  function renderGrid(frame, layout, ticks, opts) {
    return __async(this, null, function* () {
      if (!opts.showGrid) return;
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      for (const tick of ticks) {
        const ratio = (tick - tickMin) / tickRange;
        const yPos = layout.plotY + layout.plotH - ratio * layout.plotH;
        const gridLine = figma.createRectangle();
        gridLine.name = `Grid-${tick}`;
        gridLine.x = layout.plotX;
        gridLine.y = yPos;
        gridLine.resize(layout.plotW, 1);
        gridLine.fills = [{ type: "SOLID", color: toRGB(GRID_COLOR) }];
        gridLine.opacity = 0.7;
        frame.appendChild(gridLine);
      }
    });
  }
  function renderAxisHorizontal(frame, layout, categories, ticks, opts) {
    return __async(this, null, function* () {
      if (opts.showAxis === false) return;
      const fontSize = opts.fontSize || AXIS_LABEL_FONT_SIZE;
      const yAxisLine = figma.createRectangle();
      yAxisLine.name = "Y-Axis";
      yAxisLine.x = layout.plotX;
      yAxisLine.y = layout.plotY;
      yAxisLine.resize(1, layout.plotH);
      yAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
      frame.appendChild(yAxisLine);
      const xAxisLine = figma.createRectangle();
      xAxisLine.name = "X-Axis";
      xAxisLine.x = layout.plotX;
      xAxisLine.y = layout.plotY + layout.plotH;
      xAxisLine.resize(layout.plotW, 1);
      xAxisLine.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
      frame.appendChild(xAxisLine);
      const catCount = categories.length;
      const catStep = layout.plotH / catCount;
      for (let i = 0; i < catCount; i++) {
        const cy = layout.plotY + i * catStep + catStep / 2;
        const label = yield makeText(
          categories[i],
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "RIGHT",
          opts.fontFamily
        );
        label.x = layout.plotX - 6 - label.width;
        label.y = cy - label.height / 2;
        label.name = `YLabel-${categories[i]}`;
        frame.appendChild(label);
      }
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      for (const tick of ticks) {
        const ratio = (tick - tickMin) / tickRange;
        const xPos = layout.plotX + ratio * layout.plotW;
        const tickMark = figma.createRectangle();
        tickMark.name = `Tick-${tick}`;
        tickMark.x = xPos;
        tickMark.y = layout.plotY + layout.plotH;
        tickMark.resize(1, TICK_LENGTH);
        tickMark.fills = [{ type: "SOLID", color: toRGB(AXIS_COLOR) }];
        frame.appendChild(tickMark);
        const label = yield makeText(
          formatValue(tick, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        label.x = xPos - label.width / 2;
        label.y = layout.plotY + layout.plotH + TICK_LENGTH + 2;
        label.name = `XLabel-${tick}`;
        frame.appendChild(label);
      }
      if (opts.xAxisLabel) {
        const xLabel = yield makeText(
          opts.xAxisLabel,
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        xLabel.x = layout.plotX + layout.plotW / 2 - xLabel.width / 2;
        xLabel.y = layout.plotY + layout.plotH + TICK_LENGTH + 2 + fontSize + 6;
        xLabel.name = "X-Axis Label";
        frame.appendChild(xLabel);
      }
      if (opts.yAxisLabel) {
        const yLabel = yield makeText(
          opts.yAxisLabel,
          0,
          0,
          fontSize,
          LABEL_COLOR,
          "CENTER",
          opts.fontFamily
        );
        yLabel.x = CHART_PADDING.left;
        yLabel.y = layout.plotY + layout.plotH / 2 - yLabel.height / 2;
        yLabel.rotation = 90;
        yLabel.name = "Y-Axis Label";
        frame.appendChild(yLabel);
      }
    });
  }
  function renderGridHorizontal(frame, layout, ticks, opts) {
    return __async(this, null, function* () {
      if (!opts.showGrid) return;
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      for (const tick of ticks) {
        const ratio = (tick - tickMin) / tickRange;
        const xPos = layout.plotX + ratio * layout.plotW;
        const gridLine = figma.createRectangle();
        gridLine.name = `Grid-${tick}`;
        gridLine.x = xPos;
        gridLine.y = layout.plotY;
        gridLine.resize(1, layout.plotH);
        gridLine.fills = [{ type: "SOLID", color: toRGB(GRID_COLOR) }];
        gridLine.opacity = 0.7;
        frame.appendChild(gridLine);
      }
    });
  }
  function renderLegend(frame, series, width, height, layout, opts) {
    return __async(this, null, function* () {
      if (opts.showLegend === false || series.length <= 1) return;
      const pos = opts.legendPosition || "bottom";
      const fontSize = opts.fontSize || LEGEND_FONT_SIZE;
      const boxSize = 10;
      const gap = 8;
      if (pos === "bottom") {
        let curX = layout.plotX;
        const legendY = height - CHART_PADDING.bottom - fontSize - 4;
        for (const s of series) {
          const box = figma.createRectangle();
          box.name = `Legend-Box-${s.name}`;
          box.x = curX;
          box.y = legendY + (fontSize - boxSize) / 2;
          box.resize(boxSize, boxSize);
          box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
          box.cornerRadius = 2;
          frame.appendChild(box);
          const label = yield makeText(
            s.name,
            curX + boxSize + 4,
            legendY,
            fontSize,
            LABEL_COLOR,
            "LEFT",
            opts.fontFamily
          );
          label.name = `Legend-${s.name}`;
          frame.appendChild(label);
          curX += boxSize + 4 + label.width + gap + 8;
        }
      } else if (pos === "top") {
        const showTitle = opts.showTitle !== false && !!opts.title;
        let curX = layout.plotX;
        const legendY = showTitle ? CHART_PADDING.top + TITLE_FONT_SIZE + 12 : CHART_PADDING.top;
        for (const s of series) {
          const box = figma.createRectangle();
          box.name = `Legend-Box-${s.name}`;
          box.x = curX;
          box.y = legendY + (fontSize - boxSize) / 2;
          box.resize(boxSize, boxSize);
          box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
          box.cornerRadius = 2;
          frame.appendChild(box);
          const label = yield makeText(
            s.name,
            curX + boxSize + 4,
            legendY,
            fontSize,
            LABEL_COLOR,
            "LEFT",
            opts.fontFamily
          );
          label.name = `Legend-${s.name}`;
          frame.appendChild(label);
          curX += boxSize + 4 + label.width + gap + 8;
        }
      } else if (pos === "left") {
        const legendX = CHART_PADDING.left;
        let curY = layout.plotY;
        for (const s of series) {
          const box = figma.createRectangle();
          box.name = `Legend-Box-${s.name}`;
          box.x = legendX;
          box.y = curY + (fontSize - boxSize) / 2;
          box.resize(boxSize, boxSize);
          box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
          box.cornerRadius = 2;
          frame.appendChild(box);
          const label = yield makeText(
            s.name,
            legendX + boxSize + 4,
            curY,
            fontSize,
            LABEL_COLOR,
            "LEFT",
            opts.fontFamily
          );
          label.name = `Legend-${s.name}`;
          frame.appendChild(label);
          curY += fontSize + 8;
        }
      } else if (pos === "right") {
        const legendX = layout.plotX + layout.plotW + 16;
        let curY = layout.plotY;
        for (const s of series) {
          const box = figma.createRectangle();
          box.name = `Legend-Box-${s.name}`;
          box.x = legendX;
          box.y = curY + (fontSize - boxSize) / 2;
          box.resize(boxSize, boxSize);
          box.fills = [{ type: "SOLID", color: toRGB(s.color) }];
          box.cornerRadius = 2;
          frame.appendChild(box);
          const label = yield makeText(
            s.name,
            legendX + boxSize + 4,
            curY,
            fontSize,
            LABEL_COLOR,
            "LEFT",
            opts.fontFamily
          );
          label.name = `Legend-${s.name}`;
          frame.appendChild(label);
          curY += fontSize + 8;
        }
      }
    });
  }
  function renderBarChart(frame, categories, series, width, height, opts) {
    return __async(this, null, function* () {
      var _a;
      const horizontal = opts.orientation === "horizontal";
      const layout = computeLayout(width, height, opts);
      const allValues = series.flatMap((s) => s.values);
      const maxVal = Math.max(...allValues, 0);
      const ticks = computeNiceTicks(0, maxVal);
      const tickMax = ticks[ticks.length - 1];
      if (horizontal) {
        yield renderGridHorizontal(frame, layout, ticks, opts);
        yield renderAxisHorizontal(frame, layout, categories, ticks, opts);
      } else {
        yield renderGrid(frame, layout, ticks, opts);
        yield renderAxis(frame, layout, categories, ticks, opts);
      }
      yield renderTitle(frame, width, opts);
      const catCount = categories.length;
      const seriesCount = series.length;
      const cornerR = (_a = opts.barCornerRadius) != null ? _a : 3;
      if (horizontal) {
        const catStep = layout.plotH / catCount;
        const groupPadding = catStep * 0.15;
        const groupH = catStep - groupPadding * 2;
        const barH = groupH / seriesCount;
        for (let ci = 0; ci < catCount; ci++) {
          for (let si = 0; si < seriesCount; si++) {
            const val = series[si].values[ci];
            const barW = val / tickMax * layout.plotW;
            const bar = figma.createRectangle();
            bar.name = `Bar-${categories[ci]}-${series[si].name}`;
            bar.x = layout.plotX;
            bar.y = layout.plotY + ci * catStep + groupPadding + si * barH;
            bar.resize(Math.max(barW, 1), Math.max(barH - 2, 1));
            bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
            bar.cornerRadius = cornerR;
            frame.appendChild(bar);
            if (opts.showValues) {
              const valText = formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces);
              const valNode = yield makeText(valText, 0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "LEFT", opts.fontFamily);
              valNode.x = layout.plotX + barW + 4;
              valNode.y = layout.plotY + ci * catStep + groupPadding + si * barH + (barH - 2) / 2 - VALUE_FONT_SIZE / 2;
              valNode.name = `Val-${categories[ci]}-${series[si].name}`;
              frame.appendChild(valNode);
            }
          }
        }
      } else {
        const catStep = layout.plotW / catCount;
        const groupPadding = catStep * 0.15;
        const groupW = catStep - groupPadding * 2;
        const barW = groupW / seriesCount;
        for (let ci = 0; ci < catCount; ci++) {
          for (let si = 0; si < seriesCount; si++) {
            const val = series[si].values[ci];
            const barH = val / tickMax * layout.plotH;
            const bar = figma.createRectangle();
            bar.name = `Bar-${categories[ci]}-${series[si].name}`;
            bar.x = layout.plotX + ci * catStep + groupPadding + si * barW;
            bar.y = layout.plotY + layout.plotH - barH;
            bar.resize(Math.max(barW - 2, 1), Math.max(barH, 1));
            bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
            bar.cornerRadius = cornerR;
            frame.appendChild(bar);
            if (opts.showValues) {
              const valText = formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces);
              const valNode = yield makeText(valText, 0, 0, VALUE_FONT_SIZE, LABEL_COLOR, "CENTER", opts.fontFamily);
              valNode.x = layout.plotX + ci * catStep + groupPadding + si * barW + (barW - 2) / 2 - valNode.width / 2;
              valNode.y = layout.plotY + layout.plotH - barH - VALUE_FONT_SIZE - 3;
              valNode.name = `Val-${categories[ci]}-${series[si].name}`;
              frame.appendChild(valNode);
            }
          }
        }
      }
      yield renderLegend(frame, series, width, height, layout, opts);
    });
  }
  function renderStackedBarChart(frame, categories, series, width, height, opts) {
    return __async(this, null, function* () {
      var _a;
      const horizontal = opts.orientation === "horizontal";
      const layout = computeLayout(width, height, opts);
      const catCount = categories.length;
      let stackMax = 0;
      for (let ci = 0; ci < catCount; ci++) {
        let sum = 0;
        for (const s of series) sum += s.values[ci];
        stackMax = Math.max(stackMax, sum);
      }
      const ticks = computeNiceTicks(0, stackMax);
      const tickMax = ticks[ticks.length - 1];
      if (horizontal) {
        yield renderGridHorizontal(frame, layout, ticks, opts);
        yield renderAxisHorizontal(frame, layout, categories, ticks, opts);
      } else {
        yield renderGrid(frame, layout, ticks, opts);
        yield renderAxis(frame, layout, categories, ticks, opts);
      }
      yield renderTitle(frame, width, opts);
      const cornerR = (_a = opts.barCornerRadius) != null ? _a : 3;
      const segmentMode = opts.stackedValueMode === "segment";
      if (horizontal) {
        const catStep = layout.plotH / catCount;
        const barPadding = catStep * 0.2;
        const barH = catStep - barPadding * 2;
        for (let ci = 0; ci < catCount; ci++) {
          let xOffset = 0;
          for (let si = 0; si < series.length; si++) {
            const val = series[si].values[ci];
            const segW = val / tickMax * layout.plotW;
            const bar = figma.createRectangle();
            bar.name = `Stack-${categories[ci]}-${series[si].name}`;
            bar.x = layout.plotX + xOffset;
            bar.y = layout.plotY + ci * catStep + barPadding;
            bar.resize(Math.max(segW, 1), Math.max(barH, 1));
            bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
            if (si === series.length - 1) bar.cornerRadius = cornerR;
            frame.appendChild(bar);
            if (opts.showValues && segmentMode && val > 0 && segW > VALUE_FONT_SIZE * 2) {
              const segLabel = yield makeText(
                formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
                0,
                0,
                VALUE_FONT_SIZE,
                { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                "CENTER",
                opts.fontFamily
              );
              segLabel.x = layout.plotX + xOffset + segW / 2 - segLabel.width / 2;
              segLabel.y = layout.plotY + ci * catStep + barPadding + barH / 2 - VALUE_FONT_SIZE / 2;
              segLabel.name = `SegVal-${categories[ci]}-${series[si].name}`;
              frame.appendChild(segLabel);
            }
            xOffset += segW;
          }
          if (opts.showValues && !segmentMode) {
            let total = 0;
            for (const s of series) total += s.values[ci];
            const valNode = yield makeText(
              formatValue(total, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
              0,
              0,
              VALUE_FONT_SIZE,
              LABEL_COLOR,
              "LEFT",
              opts.fontFamily
            );
            valNode.x = layout.plotX + xOffset + 4;
            valNode.y = layout.plotY + ci * catStep + barPadding + barH / 2 - VALUE_FONT_SIZE / 2;
            valNode.name = `Val-${categories[ci]}`;
            frame.appendChild(valNode);
          }
        }
      } else {
        const catStep = layout.plotW / catCount;
        const barPadding = catStep * 0.2;
        const barW = catStep - barPadding * 2;
        for (let ci = 0; ci < catCount; ci++) {
          let yOffset = 0;
          for (let si = 0; si < series.length; si++) {
            const val = series[si].values[ci];
            const barH = val / tickMax * layout.plotH;
            const bar = figma.createRectangle();
            bar.name = `Stack-${categories[ci]}-${series[si].name}`;
            bar.x = layout.plotX + ci * catStep + barPadding;
            bar.y = layout.plotY + layout.plotH - yOffset - barH;
            bar.resize(Math.max(barW, 1), Math.max(barH, 1));
            bar.fills = [{ type: "SOLID", color: toRGB(series[si].color) }];
            if (si === series.length - 1) bar.cornerRadius = cornerR;
            frame.appendChild(bar);
            if (opts.showValues && segmentMode && val > 0 && barH > VALUE_FONT_SIZE + 2) {
              const segLabel = yield makeText(
                formatValue(val, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
                0,
                0,
                VALUE_FONT_SIZE,
                { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                "CENTER",
                opts.fontFamily
              );
              segLabel.x = layout.plotX + ci * catStep + barPadding + barW / 2 - segLabel.width / 2;
              segLabel.y = layout.plotY + layout.plotH - yOffset - barH / 2 - VALUE_FONT_SIZE / 2;
              segLabel.name = `SegVal-${categories[ci]}-${series[si].name}`;
              frame.appendChild(segLabel);
            }
            yOffset += barH;
          }
          if (opts.showValues && !segmentMode) {
            let total = 0;
            for (const s of series) total += s.values[ci];
            const valNode = yield makeText(
              formatValue(total, opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
              0,
              0,
              VALUE_FONT_SIZE,
              LABEL_COLOR,
              "CENTER",
              opts.fontFamily
            );
            valNode.x = layout.plotX + ci * catStep + barPadding + barW / 2 - valNode.width / 2;
            valNode.y = layout.plotY + layout.plotH - yOffset - VALUE_FONT_SIZE - 3;
            valNode.name = `Val-${categories[ci]}`;
            frame.appendChild(valNode);
          }
        }
      }
      yield renderLegend(frame, series, width, height, layout, opts);
    });
  }
  function renderLineChart(frame, categories, series, width, height, opts) {
    return __async(this, null, function* () {
      const layout = computeLayout(width, height, opts);
      const allValues = series.flatMap((s) => s.values);
      const minVal = Math.min(...allValues, 0);
      const maxVal = Math.max(...allValues, 0);
      const ticks = computeNiceTicks(minVal >= 0 ? 0 : minVal, maxVal);
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      yield renderGrid(frame, layout, ticks, opts);
      yield renderAxis(frame, layout, categories, ticks, opts);
      yield renderTitle(frame, width, opts);
      const catCount = categories.length;
      const stepX = catCount > 1 ? layout.plotW / (catCount - 1) : layout.plotW / 2;
      const showDots = opts.showDots !== false;
      const dotSize = opts.dotSize || 6;
      const lineW = opts.lineWidth || 2;
      for (const s of series) {
        const points = [];
        for (let i = 0; i < catCount; i++) {
          const ratio = (s.values[i] - tickMin) / tickRange;
          const px = layout.plotX + (catCount > 1 ? i * stepX : layout.plotW / 2);
          const py = layout.plotY + layout.plotH - ratio * layout.plotH;
          points.push({ x: px, y: py });
        }
        if (points.length > 1) {
          let pathD = `M ${points[0].x} ${points[0].y}`;
          for (let i = 1; i < points.length; i++) {
            pathD += ` L ${points[i].x} ${points[i].y}`;
          }
          const rgb = `rgb(${Math.round(s.color.r * 255)},${Math.round(s.color.g * 255)},${Math.round(s.color.b * 255)})`;
          const svg = `<svg width="${width}" height="${height}"><path d="${pathD}" fill="none" stroke="${rgb}" stroke-width="${lineW}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
          try {
            const lineNode = figma.createNodeFromSvg(svg);
            lineNode.name = `Line-${s.name}`;
            lineNode.x = 0;
            lineNode.y = 0;
            lineNode.clipsContent = false;
            frame.appendChild(lineNode);
          } catch (e) {
            console.error("SVG line error:", e);
          }
        }
        if (showDots) {
          const markerShape = opts.markerShape || "circle";
          for (let i = 0; i < points.length; i++) {
            const dot = createMarker2(
              markerShape,
              points[i].x,
              points[i].y,
              dotSize,
              toRGB(s.color),
              { r: 1, g: 1, b: 1 },
              1.5
            );
            dot.name = `Dot-${s.name}-${categories[i]}`;
            frame.appendChild(dot);
          }
        }
        if (opts.showValues) {
          for (let i = 0; i < points.length; i++) {
            const valNode = yield makeText(
              formatValue(s.values[i], opts.valueFormat, opts.currencySymbol, opts.decimalPlaces),
              0,
              0,
              VALUE_FONT_SIZE,
              LABEL_COLOR,
              "CENTER",
              opts.fontFamily
            );
            valNode.x = points[i].x - valNode.width / 2;
            valNode.y = points[i].y - dotSize / 2 - VALUE_FONT_SIZE - 3;
            valNode.name = `Val-${s.name}-${categories[i]}`;
            frame.appendChild(valNode);
          }
        }
      }
      yield renderLegend(frame, series, width, height, layout, opts);
    });
  }
  function renderAreaChart(frame, categories, series, width, height, opts) {
    return __async(this, null, function* () {
      const layout = computeLayout(width, height, opts);
      const allValues = series.flatMap((s) => s.values);
      const minVal = Math.min(...allValues, 0);
      const maxVal = Math.max(...allValues, 0);
      const ticks = computeNiceTicks(minVal >= 0 ? 0 : minVal, maxVal);
      const tickMin = ticks[0];
      const tickMax = ticks[ticks.length - 1];
      const tickRange = tickMax - tickMin || 1;
      yield renderGrid(frame, layout, ticks, opts);
      yield renderAxis(frame, layout, categories, ticks, opts);
      yield renderTitle(frame, width, opts);
      const catCount = categories.length;
      const stepX = catCount > 1 ? layout.plotW / (catCount - 1) : layout.plotW / 2;
      const showDots = opts.showDots !== false;
      const dotSize = opts.dotSize || 5;
      const lineW = opts.lineWidth || 2;
      const baseY = layout.plotY + layout.plotH;
      for (const s of series) {
        const points = [];
        for (let i = 0; i < catCount; i++) {
          const ratio = (s.values[i] - tickMin) / tickRange;
          const px = layout.plotX + (catCount > 1 ? i * stepX : layout.plotW / 2);
          const py = layout.plotY + layout.plotH - ratio * layout.plotH;
          points.push({ x: px, y: py });
        }
        if (points.length > 1) {
          let areaD = `M ${points[0].x} ${baseY} L ${points[0].x} ${points[0].y}`;
          for (let i = 1; i < points.length; i++) {
            areaD += ` L ${points[i].x} ${points[i].y}`;
          }
          areaD += ` L ${points[points.length - 1].x} ${baseY} Z`;
          const rgb = `rgb(${Math.round(s.color.r * 255)},${Math.round(s.color.g * 255)},${Math.round(s.color.b * 255)})`;
          const areaSvg = `<svg width="${width}" height="${height}"><path d="${areaD}" fill="${rgb}" fill-opacity="0.2" /><path d="M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")}" fill="none" stroke="${rgb}" stroke-width="${lineW}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
          try {
            const areaNode = figma.createNodeFromSvg(areaSvg);
            areaNode.name = `Area-${s.name}`;
            areaNode.x = 0;
            areaNode.y = 0;
            areaNode.clipsContent = false;
            frame.appendChild(areaNode);
          } catch (e) {
            console.error("SVG area error:", e);
          }
        }
        if (showDots) {
          const markerShape = opts.markerShape || "circle";
          for (let i = 0; i < points.length; i++) {
            const dot = createMarker2(
              markerShape,
              points[i].x,
              points[i].y,
              dotSize,
              toRGB(s.color)
            );
            dot.name = `Dot-${s.name}-${categories[i]}`;
            frame.appendChild(dot);
          }
        }
      }
      yield renderLegend(frame, series, width, height, layout, opts);
    });
  }
  function renderPieOrDonutChart(frame, categories, series, width, height, opts, isDonut) {
    return __async(this, null, function* () {
      var _a, _b;
      const values = series.length > 0 ? series[0].values : [];
      const total = values.reduce((sum, v) => sum + v, 0);
      if (total === 0) return;
      const showTitle = opts.showTitle !== false && !!opts.title;
      const showLegend = opts.showLegend !== false;
      const titleH = showTitle ? TITLE_FONT_SIZE + 16 : 0;
      const legendH = showLegend ? categories.length * 20 + 10 : 0;
      const chartSize = Math.min(
        width - CHART_PADDING.left - CHART_PADDING.right,
        height - CHART_PADDING.top - CHART_PADDING.bottom - titleH - legendH
      );
      const outerR = chartSize / 2;
      const innerR = isDonut ? outerR * ((_a = opts.innerRadius) != null ? _a : 0.6) : 0;
      const cx = width / 2;
      const cy = CHART_PADDING.top + titleH + outerR;
      yield renderTitle(frame, width, opts);
      let currentAngle = -Math.PI / 2;
      const palette = opts.colors && opts.colors.length > 0 ? opts.colors : DEFAULT_PALETTE;
      const TWO_PI = 2 * Math.PI;
      const normalizeAngle = (a) => (a % TWO_PI + TWO_PI) % TWO_PI;
      const donutRatio = isDonut ? (_b = opts.innerRadius) != null ? _b : 0.6 : 0;
      for (let i = 0; i < values.length; i++) {
        const sliceAngle = values[i] / total * TWO_PI;
        const endAngle = currentAngle + sliceAngle;
        const color = palette[i % palette.length];
        const ellipse = figma.createEllipse();
        ellipse.resize(outerR * 2, outerR * 2);
        ellipse.x = cx - outerR;
        ellipse.y = cy - outerR;
        const normStart = normalizeAngle(currentAngle);
        ellipse.arcData = {
          startingAngle: normStart,
          endingAngle: normStart + sliceAngle,
          innerRadius: donutRatio
        };
        ellipse.fills = [{ type: "SOLID", color: toRGB(color) }];
        ellipse.name = `Slice-${categories[i]}`;
        frame.appendChild(ellipse);
        if (opts.showValues !== false) {
          const midAngle = currentAngle + sliceAngle / 2;
          const labelR = isDonut ? (outerR + innerR) / 2 : outerR * 0.65;
          const lx = cx + labelR * Math.cos(midAngle);
          const ly = cy + labelR * Math.sin(midAngle);
          const pct = (values[i] / total * 100).toFixed(1);
          const valNode = yield makeText(
            `${pct}%`,
            0,
            0,
            VALUE_FONT_SIZE,
            { r: 1, g: 1, b: 1, a: 1 },
            "CENTER",
            opts.fontFamily
          );
          valNode.x = lx - valNode.width / 2;
          valNode.y = ly - valNode.height / 2;
          valNode.name = `Val-${categories[i]}`;
          frame.appendChild(valNode);
        }
        currentAngle = endAngle;
      }
      if (isDonut && opts.centerLabel) {
        const centerNode = yield makeText(
          opts.centerLabel,
          0,
          0,
          opts.fontSize ? opts.fontSize + 2 : 14,
          TITLE_COLOR,
          "CENTER",
          opts.fontFamily
        );
        centerNode.x = cx - centerNode.width / 2;
        centerNode.y = cy - centerNode.height / 2;
        centerNode.name = "Center Label";
        frame.appendChild(centerNode);
      }
      if (showLegend) {
        const legendY = cy + outerR + 16;
        for (let i = 0; i < categories.length; i++) {
          const color = palette[i % palette.length];
          const pct = (values[i] / total * 100).toFixed(1);
          const box = figma.createRectangle();
          box.name = `Legend-Box-${categories[i]}`;
          box.x = CHART_PADDING.left;
          box.y = legendY + i * 20;
          box.resize(10, 10);
          box.fills = [{ type: "SOLID", color: toRGB(color) }];
          box.cornerRadius = 2;
          frame.appendChild(box);
          const label = yield makeText(
            `${categories[i]}: ${formatValue(values[i], opts.valueFormat, opts.currencySymbol, opts.decimalPlaces)} (${pct}%)`,
            CHART_PADDING.left + 16,
            legendY + i * 20 - 1,
            opts.fontSize || LEGEND_FONT_SIZE,
            LABEL_COLOR,
            "LEFT",
            opts.fontFamily
          );
          label.name = `Legend-${categories[i]}`;
          frame.appendChild(label);
        }
      }
    });
  }
  function applyScaleConstraints2(parent) {
    for (const child of parent.children) {
      if ("constraints" in child) {
        child.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      }
    }
  }
  function renderChart(frame, chartType, data, width, height, opts) {
    return __async(this, null, function* () {
      for (const child of [...frame.children]) {
        child.remove();
      }
      const { categories, series } = parseTabularData(data, opts.colors);
      switch (chartType) {
        case "bar":
          yield renderBarChart(frame, categories, series, width, height, opts);
          break;
        case "stacked_bar":
          yield renderStackedBarChart(frame, categories, series, width, height, opts);
          break;
        case "line":
          yield renderLineChart(frame, categories, series, width, height, opts);
          break;
        case "area":
          yield renderAreaChart(frame, categories, series, width, height, opts);
          break;
        case "pie":
          yield renderPieOrDonutChart(frame, categories, series, width, height, opts, false);
          break;
        case "donut":
          yield renderPieOrDonutChart(frame, categories, series, width, height, opts, true);
          break;
        default:
          throw new Error(`Unknown chart type: ${chartType}`);
      }
    });
  }
  function createDataChart(params) {
    return __async(this, null, function* () {
      const {
        x = 0,
        y = 0,
        width = 600,
        height = 400,
        chartType,
        data,
        options = {},
        parentId,
        name
      } = params;
      const parent = yield getParentNode2(parentId);
      const frame = figma.createFrame();
      frame.name = name || `DataChart-${chartType}`;
      frame.x = x;
      frame.y = y;
      frame.resize(width, height);
      frame.clipsContent = true;
      frame.fills = options.backgroundColor ? [{ type: "SOLID", color: toRGB(options.backgroundColor) }] : [];
      const metadata = { chartType, data, options, width, height };
      frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));
      yield renderChart(frame, chartType, data, width, height, options);
      applyScaleConstraints2(frame);
      parent.appendChild(frame);
      return {
        id: frame.id,
        name: frame.name,
        chartType,
        x,
        y,
        width,
        height,
        categories: data.rows.length,
        series: data.headers.length - 1
      };
    });
  }
  function updateDataChart(params) {
    return __async(this, null, function* () {
      const { chartId, data, options } = params;
      let node = null;
      node = yield figma.getNodeByIdAsync(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(DATA_CHART_KEY);
      if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);
      const metadata = JSON.parse(raw);
      if (data) metadata.data = data;
      if (options) metadata.options = __spreadValues(__spreadValues({}, metadata.options), options);
      frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));
      yield renderChart(
        frame,
        metadata.chartType,
        metadata.data,
        metadata.width,
        metadata.height,
        metadata.options
      );
      applyScaleConstraints2(frame);
      return {
        id: chartId,
        name: frame.name,
        chartType: metadata.chartType,
        updated: true
      };
    });
  }
  function changeDataChartType(params) {
    return __async(this, null, function* () {
      const { chartId, newType } = params;
      let node = null;
      node = yield figma.getNodeByIdAsync(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(DATA_CHART_KEY);
      if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);
      const metadata = JSON.parse(raw);
      const oldType = metadata.chartType;
      metadata.chartType = newType;
      frame.name = `DataChart-${newType}`;
      frame.setPluginData(DATA_CHART_KEY, JSON.stringify(metadata));
      yield renderChart(
        frame,
        newType,
        metadata.data,
        metadata.width,
        metadata.height,
        metadata.options
      );
      applyScaleConstraints2(frame);
      return { id: chartId, name: frame.name, oldType, newType, changed: true };
    });
  }
  function getDataChartInfo(params) {
    return __async(this, null, function* () {
      const { chartId } = params;
      let node = null;
      node = yield figma.getNodeByIdAsync(chartId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Chart not found: ${chartId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(DATA_CHART_KEY);
      if (!raw) throw new Error(`No data chart metadata found for: ${chartId}`);
      const metadata = JSON.parse(raw);
      return __spreadValues({
        id: chartId,
        name: frame.name
      }, metadata);
    });
  }
  var DATA_CHART_KEY, DEFAULT_PALETTE, CHART_PADDING, AXIS_LABEL_FONT_SIZE, TITLE_FONT_SIZE, VALUE_FONT_SIZE, LEGEND_FONT_SIZE, TICK_LENGTH, GRID_COLOR, AXIS_COLOR, LABEL_COLOR, TITLE_COLOR;
  var init_dataChartHandlers = __esm({
    "src/handlers/dataChartHandlers.ts"() {
      "use strict";
      init_bridge();
      DATA_CHART_KEY = "data_chart_metadata";
      DEFAULT_PALETTE = [
        { r: 0.259, g: 0.522, b: 0.957, a: 1 },
        // #4285F4 blue
        { r: 0.918, g: 0.263, b: 0.208, a: 1 },
        // #EA4335 red
        { r: 0.984, g: 0.737, b: 0.016, a: 1 },
        // #FBBC04 yellow
        { r: 0.208, g: 0.659, b: 0.325, a: 1 },
        // #34A853 green
        { r: 1, g: 0.42, b: 0.176, a: 1 },
        // #FF6B2D orange
        { r: 0.541, g: 0.318, b: 0.831, a: 1 },
        // #8A51D4 purple
        { r: 0, g: 0.737, b: 0.831, a: 1 },
        // #00BCD4 cyan
        { r: 0.914, g: 0.118, b: 0.388, a: 1 }
        // #E91E63 pink
      ];
      CHART_PADDING = { top: 20, right: 20, bottom: 20, left: 20 };
      AXIS_LABEL_FONT_SIZE = 10;
      TITLE_FONT_SIZE = 16;
      VALUE_FONT_SIZE = 9;
      LEGEND_FONT_SIZE = 11;
      TICK_LENGTH = 4;
      GRID_COLOR = { r: 0.9, g: 0.9, b: 0.9, a: 1 };
      AXIS_COLOR = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
      LABEL_COLOR = { r: 0.4, g: 0.4, b: 0.4, a: 1 };
      TITLE_COLOR = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
    }
  });

  // src/handlers/tableHandlers.ts
  function detectFormat(text) {
    const lines = text.trim().split("\n");
    if (lines.some((l) => l.trim().startsWith("|") && l.trim().endsWith("|"))) {
      return "markdown";
    }
    if (lines.some((l) => l.includes("	"))) {
      return "tsv";
    }
    return "csv";
  }
  function parseCSV(text, delimiter = ",") {
    const rows = [];
    const lines = text.trim().split("\n");
    for (const line of lines) {
      const cells = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            current += ch;
          }
        } else {
          if (ch === '"') {
            inQuotes = true;
          } else if (ch === delimiter) {
            cells.push(current.trim());
            current = "";
          } else {
            current += ch;
          }
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }
    return rows;
  }
  function parseTSV(text) {
    return parseCSV(text, "	");
  }
  function parseMarkdown(text) {
    const lines = text.trim().split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const tableLines = lines.filter((l) => l.includes("|"));
    if (tableLines.length === 0) {
      return { headers: [], rows: [], alignments: [], hasHeader: false };
    }
    const parseLine = (line) => {
      let trimmed = line;
      if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
      if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
      return trimmed.split("|").map((c) => c.trim());
    };
    const isSeparator = (line) => {
      const cells = parseLine(line);
      return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
    };
    let sepIdx = -1;
    for (let i = 0; i < tableLines.length; i++) {
      if (isSeparator(tableLines[i])) {
        sepIdx = i;
        break;
      }
    }
    let headers = [];
    let dataRows = [];
    let alignments = [];
    let hasHeader = false;
    if (sepIdx >= 0) {
      const sepCells = parseLine(tableLines[sepIdx]);
      alignments = sepCells.map((c) => {
        const t = c.trim();
        if (t.startsWith(":") && t.endsWith(":")) return "CENTER";
        if (t.endsWith(":")) return "RIGHT";
        return "LEFT";
      });
      if (sepIdx > 0) {
        headers = parseLine(tableLines[sepIdx - 1]);
        hasHeader = true;
      }
      for (let i = sepIdx + 1; i < tableLines.length; i++) {
        if (!isSeparator(tableLines[i])) {
          dataRows.push(parseLine(tableLines[i]));
        }
      }
    } else {
      headers = parseLine(tableLines[0]);
      hasHeader = true;
      for (let i = 1; i < tableLines.length; i++) {
        dataRows.push(parseLine(tableLines[i]));
      }
      alignments = headers.map(() => "LEFT");
    }
    return { headers, rows: dataRows, alignments, hasHeader };
  }
  function parseText(text, format) {
    const fmt = format === "auto" ? detectFormat(text) : format;
    if (fmt === "markdown") {
      return parseMarkdown(text);
    }
    const raw = fmt === "tsv" ? parseTSV(text) : parseCSV(text);
    if (raw.length === 0) {
      return { headers: [], rows: [], alignments: [], hasHeader: false };
    }
    const headers = raw[0];
    const rows = raw.slice(1);
    const alignments = headers.map(() => "LEFT");
    return { headers, rows, alignments, hasHeader: true };
  }
  function toRGB2(c) {
    return { r: c.r, g: c.g, b: c.b };
  }
  function mergeStyle(custom) {
    return __spreadValues(__spreadValues({}, DEFAULT_STYLE), custom);
  }
  function loadFont3(family = "Inter", style = "Regular") {
    return __async(this, null, function* () {
      try {
        yield figma.loadFontAsync({ family, style });
      } catch (e) {
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    });
  }
  function loadFonts(family = "Inter") {
    return __async(this, null, function* () {
      yield Promise.all([
        loadFont3(family, "Regular"),
        loadFont3(family, "Bold")
      ]);
    });
  }
  function resolveParentId2(id) {
    return __async(this, null, function* () {
      return yield lookupNode(id);
    });
  }
  function getParentNode3(parentId) {
    return __async(this, null, function* () {
      if (parentId) {
        const node = yield resolveParentId2(parentId);
        if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
          return node;
        }
      }
      const focusedSlide = figma.currentPage.focusedSlide;
      return focusedSlide || figma.currentPage;
    });
  }
  function renderTable(frame, parsed, tableWidth, style, tableHeight) {
    return __async(this, null, function* () {
      for (const child of [...frame.children]) {
        child.remove();
      }
      yield loadFonts(style.fontFamily);
      const colCount = Math.max(
        parsed.headers.length,
        ...parsed.rows.map((r) => r.length)
      );
      if (colCount === 0) return;
      const colWidth = Math.max(tableWidth / colCount, style.minCellWidth);
      const actualWidth = colWidth * colCount;
      const createCell = (text, colIdx, isHeader, rowIdx) => __async(null, null, function* () {
        var _a;
        const cell = figma.createFrame();
        cell.name = isHeader ? `Header-${colIdx}` : `Cell-${rowIdx}-${colIdx}`;
        cell.resize(colWidth, style.minCellHeight);
        cell.layoutMode = "HORIZONTAL";
        cell.primaryAxisAlignItems = "CENTER";
        cell.counterAxisAlignItems = "CENTER";
        cell.paddingLeft = style.cellPadding;
        cell.paddingRight = style.cellPadding;
        cell.paddingTop = 8;
        cell.paddingBottom = 8;
        cell.layoutSizingHorizontal = "FIXED";
        cell.layoutSizingVertical = "HUG";
        let bgColor;
        if (isHeader) {
          bgColor = style.headerBackground;
        } else if (style.stripedRows && rowIdx % 2 === 1) {
          bgColor = style.stripedColor;
        } else {
          bgColor = style.cellBackground;
        }
        cell.fills = [{ type: "SOLID", color: toRGB2(bgColor), opacity: (_a = bgColor.a) != null ? _a : 1 }];
        const textNode = figma.createText();
        textNode.characters = text || "";
        textNode.fontSize = isHeader ? style.headerFontSize : style.fontSize;
        textNode.fontName = {
          family: style.fontFamily,
          style: isHeader ? "Bold" : "Regular"
        };
        textNode.fills = [
          {
            type: "SOLID",
            color: toRGB2(isHeader ? style.headerTextColor : style.cellTextColor)
          }
        ];
        const align = colIdx < parsed.alignments.length ? parsed.alignments[colIdx] : "LEFT";
        textNode.textAlignHorizontal = align;
        cell.appendChild(textNode);
        textNode.layoutSizingHorizontal = "FILL";
        cell.strokes = [{ type: "SOLID", color: toRGB2(style.borderColor) }];
        cell.strokeWeight = style.borderWidth;
        cell.strokeAlign = "INSIDE";
        cell.strokeTopWeight = 0;
        cell.strokeLeftWeight = 0;
        cell.strokeRightWeight = 0;
        cell.strokeBottomWeight = style.borderWidth;
        return cell;
      });
      const createRow = (name) => {
        const row = figma.createFrame();
        row.name = name;
        row.layoutMode = "HORIZONTAL";
        row.counterAxisAlignItems = "MIN";
        row.layoutSizingHorizontal = "FIXED";
        row.layoutSizingVertical = "HUG";
        row.fills = [];
        row.itemSpacing = 0;
        row.resize(actualWidth, row.height);
        return row;
      };
      const totalRows = parsed.rows.length + (parsed.hasHeader && parsed.headers.length > 0 ? 1 : 0);
      const defaultHeight = totalRows * style.minCellHeight;
      const frameHeight = tableHeight !== void 0 && tableHeight > 0 ? tableHeight : defaultHeight;
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "MIN";
      frame.itemSpacing = 0;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "FIXED";
      frame.resize(actualWidth, frameHeight);
      frame.clipsContent = true;
      frame.fills = [{ type: "SOLID", color: toRGB2(style.cellBackground) }];
      if (style.cornerRadius > 0) {
        frame.cornerRadius = style.cornerRadius;
      }
      if (parsed.hasHeader && parsed.headers.length > 0) {
        const headerRow = createRow("Header Row");
        for (let c = 0; c < colCount; c++) {
          const text = c < parsed.headers.length ? parsed.headers[c] : "";
          const cell = yield createCell(text, c, true, -1);
          headerRow.appendChild(cell);
          cell.layoutSizingHorizontal = "FILL";
          cell.layoutSizingVertical = "FILL";
        }
        frame.appendChild(headerRow);
        headerRow.layoutSizingHorizontal = "FILL";
        headerRow.layoutSizingVertical = "FILL";
      }
      for (let r = 0; r < parsed.rows.length; r++) {
        const rowFrame = createRow(`Row ${r}`);
        for (let c = 0; c < colCount; c++) {
          const text = c < parsed.rows[r].length ? parsed.rows[r][c] : "";
          const cell = yield createCell(text, c, false, r);
          rowFrame.appendChild(cell);
          cell.layoutSizingHorizontal = "FILL";
          cell.layoutSizingVertical = "FILL";
        }
        frame.appendChild(rowFrame);
        rowFrame.layoutSizingHorizontal = "FILL";
        rowFrame.layoutSizingVertical = "FILL";
      }
    });
  }
  function createTable(params) {
    return __async(this, null, function* () {
      var _a, _b;
      const {
        x = 0,
        y = 0,
        width = 600,
        height,
        text,
        format = "auto",
        style: customStyle,
        parentId,
        name
      } = params;
      const style = mergeStyle(customStyle);
      const parsed = parseText(text, format);
      if (parsed.headers.length === 0 && parsed.rows.length === 0) {
        throw new Error("No table data found in the provided text.");
      }
      if (params.hasHeader !== void 0) {
        parsed.hasHeader = params.hasHeader;
      }
      const parent = yield getParentNode3(parentId);
      const frame = figma.createFrame();
      frame.name = name || "Table";
      frame.x = x;
      frame.y = y;
      const metadata = {
        text,
        format,
        style,
        width,
        height,
        alignments: parsed.alignments,
        hasHeader: parsed.hasHeader
      };
      frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));
      yield renderTable(frame, parsed, width, style, height);
      parent.appendChild(frame);
      return {
        id: frame.id,
        name: frame.name,
        x,
        y,
        width: frame.width,
        height: frame.height,
        columns: parsed.headers.length || ((_b = (_a = parsed.rows[0]) == null ? void 0 : _a.length) != null ? _b : 0),
        rows: parsed.rows.length,
        hasHeader: parsed.hasHeader,
        format: format === "auto" ? detectFormat(text) : format
      };
    });
  }
  function updateTable(params) {
    return __async(this, null, function* () {
      var _a, _b;
      const { tableId, text, format, style: customStyle } = params;
      const node = yield figma.getNodeByIdAsync(tableId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Table not found: ${tableId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(TABLE_DATA_KEY);
      if (!raw) throw new Error(`No table metadata found for: ${tableId}`);
      const metadata = JSON.parse(raw);
      if (text !== void 0) metadata.text = text;
      if (format !== void 0) metadata.format = format;
      if (customStyle) metadata.style = __spreadValues(__spreadValues({}, metadata.style), customStyle);
      const style = mergeStyle(metadata.style);
      const parsed = parseText(metadata.text, metadata.format);
      parsed.hasHeader = metadata.hasHeader;
      if (metadata.alignments.length > 0) {
        parsed.alignments = metadata.alignments;
      }
      frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));
      yield renderTable(frame, parsed, metadata.width, style, metadata.height);
      return {
        id: tableId,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        columns: parsed.headers.length || ((_b = (_a = parsed.rows[0]) == null ? void 0 : _a.length) != null ? _b : 0),
        rows: parsed.rows.length,
        updated: true
      };
    });
  }
  function createTableFromData(params) {
    return __async(this, null, function* () {
      const {
        x = 0,
        y = 0,
        width = 600,
        headers,
        rows,
        alignments,
        style: customStyle,
        parentId,
        name
      } = params;
      const style = mergeStyle(customStyle);
      const parsed = {
        headers,
        rows,
        alignments: alignments || headers.map(() => "LEFT"),
        hasHeader: headers.length > 0
      };
      const parent = yield getParentNode3(parentId);
      const frame = figma.createFrame();
      frame.name = name || "Table";
      frame.x = x;
      frame.y = y;
      const csvLines = [];
      if (headers.length > 0) csvLines.push(headers.join(","));
      for (const row of rows) csvLines.push(row.join(","));
      const csvText = csvLines.join("\n");
      const metadata = {
        text: csvText,
        format: "csv",
        style,
        width,
        alignments: parsed.alignments,
        hasHeader: parsed.hasHeader
      };
      frame.setPluginData(TABLE_DATA_KEY, JSON.stringify(metadata));
      yield renderTable(frame, parsed, width, style);
      parent.appendChild(frame);
      return {
        id: frame.id,
        name: frame.name,
        x,
        y,
        width: frame.width,
        height: frame.height,
        columns: headers.length,
        rows: rows.length,
        hasHeader: true
      };
    });
  }
  function getTableInfo(params) {
    return __async(this, null, function* () {
      var _a, _b;
      const { tableId } = params;
      const node = yield figma.getNodeByIdAsync(tableId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`Table not found: ${tableId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(TABLE_DATA_KEY);
      if (!raw) throw new Error(`No table metadata found for: ${tableId}`);
      const metadata = JSON.parse(raw);
      const parsed = parseText(metadata.text, metadata.format);
      return {
        id: tableId,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        format: metadata.format,
        columns: parsed.headers.length || ((_b = (_a = parsed.rows[0]) == null ? void 0 : _a.length) != null ? _b : 0),
        rows: parsed.rows.length,
        hasHeader: metadata.hasHeader,
        headers: parsed.headers,
        data: parsed.rows,
        alignments: metadata.alignments,
        style: metadata.style
      };
    });
  }
  var TABLE_DATA_KEY, DEFAULT_STYLE;
  var init_tableHandlers = __esm({
    "src/handlers/tableHandlers.ts"() {
      "use strict";
      init_bridge();
      TABLE_DATA_KEY = "table_metadata";
      DEFAULT_STYLE = {
        headerBackground: { r: 0.957, g: 0.957, b: 0.961, a: 1 },
        // #F4F4F5
        headerTextColor: { r: 0.02, g: 0.02, b: 0.02, a: 1 },
        // #050505
        cellBackground: { r: 1, g: 1, b: 1, a: 1 },
        // white
        cellTextColor: { r: 0.035, g: 0.035, b: 0.043, a: 1 },
        // #09090B
        borderColor: { r: 0.894, g: 0.894, b: 0.906, a: 1 },
        // #E4E4E7
        borderWidth: 1,
        cellPadding: 12,
        fontSize: 14,
        headerFontSize: 14,
        fontFamily: "Inter",
        minCellWidth: 80,
        minCellHeight: 40,
        stripedRows: false,
        stripedColor: { r: 0.98, g: 0.98, b: 0.985, a: 1 },
        // #FAFAFB
        cornerRadius: 0
      };
    }
  });

  // src/handlers/importExportHandlers.ts
  function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
  }
  function cloneJSON(val) {
    try {
      return JSON.parse(JSON.stringify(val));
    } catch (e) {
      return val;
    }
  }
  function serializePaints(paints) {
    if (!paints || !Array.isArray(paints)) return [];
    return paints.map((p) => {
      var _a, _b, _c;
      const out = { type: p.type, visible: (_a = p.visible) != null ? _a : true };
      if (p.opacity !== void 0) out.opacity = p.opacity;
      if (p.blendMode) out.blendMode = p.blendMode;
      switch (p.type) {
        case "SOLID":
          if (p.color) {
            out.color = { r: p.color.r, g: p.color.g, b: p.color.b, a: (_b = p.opacity) != null ? _b : 1 };
          }
          break;
        case "IMAGE":
          out.imageHash = p.imageHash;
          out.scaleMode = (_c = p.scaleMode) != null ? _c : "FILL";
          if (p.imageTransform) out.imageTransform = cloneJSON(p.imageTransform);
          break;
        case "GRADIENT_LINEAR":
        case "GRADIENT_RADIAL":
        case "GRADIENT_ANGULAR":
        case "GRADIENT_DIAMOND":
          if (p.gradientTransform) out.gradientTransform = cloneJSON(p.gradientTransform);
          if (p.gradientStops) {
            out.gradientStops = p.gradientStops.map((s) => {
              var _a2;
              return {
                position: s.position,
                color: { r: s.color.r, g: s.color.g, b: s.color.b, a: (_a2 = s.color.a) != null ? _a2 : 1 }
              };
            });
          }
          break;
      }
      return out;
    });
  }
  function serializeEffects(effects) {
    if (!effects || !Array.isArray(effects)) return [];
    return cloneJSON(effects);
  }
  function computeBBox(node) {
    try {
      const t = node.absoluteTransform;
      if (t) {
        return { x: t[0][2], y: t[1][2], width: node.width, height: node.height };
      }
    } catch (e) {
    }
    return null;
  }
  function serializeText(node, json) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    json.characters = (_a = node.characters) != null ? _a : "";
    json.textAutoResize = (_b = node.textAutoResize) != null ? _b : "NONE";
    json.textAlignHorizontal = (_c = node.textAlignHorizontal) != null ? _c : "LEFT";
    json.textAlignVertical = (_d = node.textAlignVertical) != null ? _d : "TOP";
    const style = {};
    const fn = node.fontName;
    if (fn && fn !== figma.mixed) {
      style.fontFamily = fn.family;
      style.fontStyle = fn.style;
    } else if (node.characters.length > 0) {
      try {
        const fn0 = node.getRangeFontName(0, 1);
        style.fontFamily = fn0.family;
        style.fontStyle = fn0.style;
      } catch (e) {
      }
    }
    const fs = node.fontSize;
    if (fs !== void 0 && fs !== figma.mixed) {
      style.fontSize = fs;
    } else if (node.characters.length > 0) {
      try {
        style.fontSize = node.getRangeFontSize(0, 1);
      } catch (e) {
      }
    }
    try {
      const lh = node.lineHeight;
      if (lh && lh !== figma.mixed) {
        if (lh.unit === "AUTO") {
          style.lineHeightUnit = "AUTO";
        } else if (lh.unit === "PIXELS") {
          style.lineHeightPx = lh.value;
          style.lineHeightUnit = "PIXELS";
        } else if (lh.unit === "PERCENT") {
          style.lineHeightPercent = lh.value;
          style.lineHeightUnit = "PERCENT";
        }
      }
    } catch (e) {
    }
    try {
      const ls = node.letterSpacing;
      if (ls && ls !== figma.mixed) {
        style.letterSpacing = ls.value;
        style.letterSpacingUnit = ls.unit;
      }
    } catch (e) {
    }
    try {
      const tc = node.textCase;
      if (tc !== void 0 && tc !== figma.mixed) style.textCase = tc;
    } catch (e) {
    }
    try {
      const td = node.textDecoration;
      if (td !== void 0 && td !== figma.mixed) style.textDecoration = td;
    } catch (e) {
    }
    try {
      style.paragraphIndent = (_e = node.paragraphIndent) != null ? _e : 0;
    } catch (e) {
    }
    try {
      style.paragraphSpacing = (_f = node.paragraphSpacing) != null ? _f : 0;
    } catch (e) {
    }
    style.textAlignHorizontal = json.textAlignHorizontal;
    style.textAlignVertical = json.textAlignVertical;
    style.textAutoResize = json.textAutoResize;
    try {
      if (node.leadingTrim !== void 0) style.leadingTrim = node.leadingTrim;
    } catch (e) {
    }
    try {
      if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
        const liSegs = node.getStyledTextSegments(["listOptions", "indentation"]);
        if (liSegs.length > 0) {
          const hasAnyList = liSegs.some((s) => s.listOptions && s.listOptions.type && s.listOptions.type !== "NONE");
          if (hasAnyList || node.characters.includes("\u2022") || node.characters.includes("\xB7") || node.characters.includes("-\n")) {
            console.log(`[serializeText] BULLET DIAG node="${node.name}" chars="${node.characters.substring(0, 80)}..." segs=${liSegs.length}`);
            for (let si = 0; si < Math.min(liSegs.length, 5); si++) {
              const s = liSegs[si];
              console.log(`  seg[${si}] [${s.start}-${s.end}] listOptions=${JSON.stringify(s.listOptions)} indent=${s.indentation}`);
            }
          }
          if (liSegs[0].listOptions && liSegs[0].listOptions.type !== "NONE") {
            style.listOptions = { type: liSegs[0].listOptions.type };
          }
          if (liSegs[0].indentation !== void 0 && liSegs[0].indentation > 0) {
            style.indentation = liSegs[0].indentation;
          }
        }
      }
    } catch (e) {
      console.warn(`[serializeText] listOptions capture failed for "${node.name}":`, e);
    }
    json.style = style;
    try {
      if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
        const listSegs = node.getStyledTextSegments(["listOptions", "indentation"]);
        if (listSegs.length > 0) {
          const lines = node.characters.split("\n");
          const lineTypes = [];
          const lineIndentations = [];
          let charOffset = 0;
          for (const line of lines) {
            const seg = listSegs.find((s) => s.start <= charOffset && s.end > charOffset);
            if (seg && seg.listOptions && seg.listOptions.type && seg.listOptions.type !== "NONE") {
              lineTypes.push(seg.listOptions.type);
              lineIndentations.push((_g = seg.indentation) != null ? _g : 0);
            } else {
              lineTypes.push("NONE");
              lineIndentations.push((_h = seg == null ? void 0 : seg.indentation) != null ? _h : 0);
            }
            charOffset += line.length + 1;
          }
          const hasAnyList = lineTypes.some((t) => t !== "NONE");
          const hasAnyIndent = lineIndentations.some((i) => i > 0);
          if (hasAnyList || hasAnyIndent) {
            json.lineTypes = lineTypes;
            json.lineIndentations = lineIndentations;
            console.log(`[serializeText] lineTypes for "${node.name}": ${JSON.stringify(lineTypes)} indent: ${JSON.stringify(lineIndentations)}`);
          }
        }
      }
    } catch (e) {
      console.warn(`[serializeText] lineTypes capture failed for "${node.name}":`, e);
    }
    if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
      try {
        const segments = node.getStyledTextSegments([
          "fontName",
          "fontSize",
          "lineHeight",
          "letterSpacing",
          "textCase",
          "textDecoration",
          "fills",
          "listOptions",
          "indentation",
          "openTypeFeatures",
          "hyperlink"
        ]);
        const hasBulletChars = node.characters.includes("\u2022") || node.characters.includes("\xB7");
        const hasListSegs = segments.some((s) => s.listOptions && s.listOptions.type && s.listOptions.type !== "NONE");
        if (hasBulletChars || hasListSegs) {
          console.log(`[serializeText] FULL SEGMENT DIAG node="${node.name}" totalSegs=${segments.length} hasBulletChars=${hasBulletChars} hasListSegs=${hasListSegs}`);
          for (let si = 0; si < Math.min(segments.length, 8); si++) {
            const s = segments[si];
            console.log(`  fullSeg[${si}] [${s.start}-${s.end}] text="${node.characters.substring(s.start, Math.min(s.end, s.start + 40))}" listOpt=${JSON.stringify(s.listOptions)} indent=${s.indentation} font=${(_i = s.fontName) == null ? void 0 : _i.family}/${(_j = s.fontName) == null ? void 0 : _j.style} size=${s.fontSize}`);
          }
        }
        if (segments.length > 1) {
          const overrides = new Array(node.characters.length).fill(0);
          const table = {};
          let nextId = 1;
          const styleKeyMap = /* @__PURE__ */ new Map();
          const rootKey = segmentKey(segments[0]);
          for (const seg of segments) {
            const key = segmentKey(seg);
            if (key === rootKey) continue;
            if (!styleKeyMap.has(key)) {
              const id2 = nextId++;
              styleKeyMap.set(key, id2);
              table[String(id2)] = segmentToStyle(seg);
            }
            const id = styleKeyMap.get(key);
            for (let i = seg.start; i < seg.end; i++) {
              overrides[i] = id;
            }
          }
          if (Object.keys(table).length > 0) {
            json.characterStyleOverrides = overrides;
            json.styleOverrideTable = table;
          }
        }
      } catch (err) {
        console.warn("[serializeText] getStyledTextSegments failed:", err);
      }
    }
    try {
      const fills = node.fills;
      if (fills && fills !== figma.mixed && Array.isArray(fills) && fills.length > 0) {
        json.fills = serializePaints(fills);
      }
    } catch (e) {
    }
  }
  function segmentKey(seg) {
    var _a;
    return JSON.stringify({
      fn: seg.fontName ? `${seg.fontName.family}:${seg.fontName.style}` : "",
      fs: seg.fontSize,
      lh: seg.lineHeight,
      ls: seg.letterSpacing,
      tc: seg.textCase,
      td: seg.textDecoration,
      fl: seg.fills ? JSON.stringify(seg.fills) : "[]",
      lo: seg.listOptions ? seg.listOptions.type : "NONE",
      ind: (_a = seg.indentation) != null ? _a : 0,
      otf: seg.openTypeFeatures ? JSON.stringify(seg.openTypeFeatures) : "{}",
      hl: seg.hyperlink ? JSON.stringify(seg.hyperlink) : "null"
    });
  }
  function segmentToStyle(seg) {
    const s = {};
    if (seg.fontName) {
      s.fontFamily = seg.fontName.family;
      s.fontStyle = seg.fontName.style;
    }
    if (seg.fontSize !== void 0) s.fontSize = seg.fontSize;
    if (seg.lineHeight) {
      if (seg.lineHeight.unit === "AUTO") {
        s.lineHeightUnit = "AUTO";
      } else if (seg.lineHeight.unit === "PIXELS") {
        s.lineHeightPx = seg.lineHeight.value;
      } else if (seg.lineHeight.unit === "PERCENT") {
        s.lineHeightPercent = seg.lineHeight.value;
      }
    }
    if (seg.letterSpacing) {
      s.letterSpacing = seg.letterSpacing.value;
      s.letterSpacingUnit = seg.letterSpacing.unit;
    }
    if (seg.textCase) s.textCase = seg.textCase;
    if (seg.textDecoration) s.textDecoration = seg.textDecoration;
    if (seg.fills && Array.isArray(seg.fills) && seg.fills.length > 0) {
      s.fills = serializePaints(seg.fills);
    }
    if (seg.listOptions && seg.listOptions.type && seg.listOptions.type !== "NONE") {
      s.listOptions = { type: seg.listOptions.type };
    }
    if (seg.indentation !== void 0 && seg.indentation > 0) {
      s.indentation = seg.indentation;
    }
    if (seg.openTypeFeatures && typeof seg.openTypeFeatures === "object" && Object.keys(seg.openTypeFeatures).length > 0) {
      s.openTypeFeatures = __spreadValues({}, seg.openTypeFeatures);
    }
    if (seg.hyperlink) {
      s.hyperlink = { type: seg.hyperlink.type, value: seg.hyperlink.value };
    }
    return s;
  }
  function serializeNode(node) {
    var _a, _b, _c, _d, _e, _f, _g;
    let exportId = node.id;
    try {
      const sid = node.getPluginData ? node.getPluginData("sourceId") : "";
      if (sid) exportId = sid;
    } catch (e) {
    }
    const json = {
      id: exportId,
      name: (_a = node.name) != null ? _a : node.type,
      type: node.type,
      visible: (_b = node.visible) != null ? _b : true,
      scrollBehavior: "SCROLLS"
    };
    if ("width" in node && "height" in node) {
      json.size = { x: node.width, y: node.height };
      const bbox = computeBBox(node);
      if (bbox) {
        json.absoluteBoundingBox = bbox;
        json.absoluteRenderBounds = __spreadValues({}, bbox);
      }
    }
    if ("relativeTransform" in node) {
      try {
        const rt = node.relativeTransform;
        if (rt) {
          json.relativeTransform = [
            [rt[0][0], rt[0][1], rt[0][2]],
            [rt[1][0], rt[1][1], rt[1][2]]
          ];
        }
      } catch (e) {
      }
    }
    if ("rotation" in node) {
      try {
        json.rotation = node.rotation;
      } catch (e) {
      }
    }
    if (node.type !== "TEXT" && "fills" in node) {
      try {
        const fills = node.fills;
        if (fills && fills !== figma.mixed) {
          json.fills = serializePaints(fills);
        }
      } catch (e) {
      }
    }
    if ("strokes" in node) {
      try {
        const strokes = node.strokes;
        if (strokes && strokes !== figma.mixed) {
          json.strokes = serializePaints(strokes);
        }
      } catch (e) {
      }
    }
    if ("strokeWeight" in node) {
      try {
        const sw = node.strokeWeight;
        if (sw !== figma.mixed) json.strokeWeight = sw;
      } catch (e) {
      }
    }
    if ("strokeAlign" in node) try {
      json.strokeAlign = node.strokeAlign;
    } catch (e) {
    }
    if ("strokeCap" in node) {
      try {
        const sc = node.strokeCap;
        if (sc !== figma.mixed) json.strokeCap = sc;
      } catch (e) {
      }
    }
    if ("strokeJoin" in node) {
      try {
        const sj = node.strokeJoin;
        if (sj !== figma.mixed) json.strokeJoin = sj;
      } catch (e) {
      }
    }
    if ("dashPattern" in node) {
      try {
        json.dashPattern = [...node.dashPattern];
      } catch (e) {
      }
    }
    if ("strokeMiterLimit" in node) {
      try {
        json.strokeMiterLimit = node.strokeMiterLimit;
      } catch (e) {
      }
    }
    if ("strokeTopWeight" in node) {
      try {
        json.individualStrokeWeights = {
          top: node.strokeTopWeight,
          right: node.strokeRightWeight,
          bottom: node.strokeBottomWeight,
          left: node.strokeLeftWeight
        };
      } catch (e) {
      }
    }
    if ("cornerRadius" in node) {
      try {
        const cr = node.cornerRadius;
        if (cr !== figma.mixed) json.cornerRadius = cr;
      } catch (e) {
      }
    }
    if ("topLeftRadius" in node) {
      try {
        json.rectangleCornerRadii = [
          node.topLeftRadius,
          node.topRightRadius,
          node.bottomRightRadius,
          node.bottomLeftRadius
        ];
        json.topLeftRadius = node.topLeftRadius;
        json.topRightRadius = node.topRightRadius;
        json.bottomRightRadius = node.bottomRightRadius;
        json.bottomLeftRadius = node.bottomLeftRadius;
      } catch (e) {
      }
    }
    if ("cornerSmoothing" in node) {
      try {
        json.cornerSmoothing = node.cornerSmoothing;
      } catch (e) {
      }
    }
    if ("effects" in node) {
      try {
        json.effects = serializeEffects(node.effects);
      } catch (e) {
      }
    }
    if ("opacity" in node) try {
      json.opacity = node.opacity;
    } catch (e) {
    }
    if ("blendMode" in node) try {
      json.blendMode = node.blendMode;
    } catch (e) {
    }
    if ("isMask" in node) try {
      json.isMask = node.isMask;
    } catch (e) {
    }
    if ("maskType" in node) try {
      json.maskType = node.maskType;
    } catch (e) {
    }
    if ("constraints" in node) {
      try {
        json.constraints = cloneJSON(node.constraints);
      } catch (e) {
      }
    }
    if ("clipsContent" in node) {
      try {
        json.clipsContent = node.clipsContent;
      } catch (e) {
      }
    }
    if ("layoutMode" in node) {
      try {
        json.layoutMode = node.layoutMode;
        if (node.layoutMode !== "NONE") {
          json.layoutSizingHorizontal = node.layoutSizingHorizontal;
          json.layoutSizingVertical = node.layoutSizingVertical;
          json.primaryAxisSizingMode = node.primaryAxisSizingMode;
          json.counterAxisSizingMode = node.counterAxisSizingMode;
          json.primaryAxisAlignItems = node.primaryAxisAlignItems;
          json.counterAxisAlignItems = node.counterAxisAlignItems;
          if (node.layoutWrap !== void 0) json.layoutWrap = node.layoutWrap;
          if (node.counterAxisSpacing !== void 0) json.counterAxisSpacing = node.counterAxisSpacing;
          json.itemSpacing = (_c = node.itemSpacing) != null ? _c : 0;
          json.paddingLeft = (_d = node.paddingLeft) != null ? _d : 0;
          json.paddingRight = (_e = node.paddingRight) != null ? _e : 0;
          json.paddingTop = (_f = node.paddingTop) != null ? _f : 0;
          json.paddingBottom = (_g = node.paddingBottom) != null ? _g : 0;
        }
      } catch (e) {
      }
    }
    if ("layoutPositioning" in node) try {
      json.layoutPositioning = node.layoutPositioning;
    } catch (e) {
    }
    if ("layoutAlign" in node) try {
      json.layoutAlign = node.layoutAlign;
    } catch (e) {
    }
    if ("layoutGrow" in node) try {
      json.layoutGrow = node.layoutGrow;
    } catch (e) {
    }
    if ("backgrounds" in node) {
      try {
        json.background = serializePaints(node.backgrounds);
      } catch (e) {
      }
    }
    if (node.type === "TEXT") {
      serializeText(node, json);
    }
    if (node.type === "VECTOR") {
      try {
        const vp = node.vectorPaths;
        if (vp && vp.length > 0) {
          json.fillGeometry = vp.map((v) => {
            var _a2;
            return {
              path: v.data,
              windingRule: (_a2 = v.windingRule) != null ? _a2 : "NONZERO"
            };
          });
        }
      } catch (e) {
      }
    }
    switch (node.type) {
      case "ELLIPSE":
        try {
          if (node.arcData) json.arcData = cloneJSON(node.arcData);
        } catch (e) {
        }
        break;
      case "POLYGON":
        try {
          if (node.pointCount) json.pointCount = node.pointCount;
        } catch (e) {
        }
        break;
      case "STAR":
        try {
          if (node.pointCount) json.pointCount = node.pointCount;
          if (node.innerRadius !== void 0) json.innerRadius = node.innerRadius;
        } catch (e) {
        }
        break;
      case "BOOLEAN_OPERATION":
        try {
          json.booleanOperation = node.booleanOperation;
        } catch (e) {
        }
        break;
      case "SHAPE_WITH_TEXT":
        try {
          if (node.shapeType) json.shapeType = node.shapeType;
        } catch (e) {
        }
        break;
    }
    if ("children" in node && Array.isArray(node.children)) {
      json.children = [];
      for (const child of node.children) {
        try {
          const childJson = serializeNode(child);
          if (childJson) json.children.push(childJson);
        } catch (err) {
          console.warn(`[serializeNode] failed to serialize "${child.name}":`, err);
        }
      }
    }
    return json;
  }
  function buildSourceIdMap() {
    const map = /* @__PURE__ */ new Map();
    function walk(n) {
      try {
        const sid = n.getPluginData ? n.getPluginData("sourceId") : "";
        if (sid) map.set(n.id, sid);
      } catch (e) {
      }
      if ("children" in n && Array.isArray(n.children)) {
        for (const c of n.children) walk(c);
      }
    }
    for (const c of figma.currentPage.children) walk(c);
    return map;
  }
  function applySourceIdOverride(json, map) {
    if (Array.isArray(json)) {
      for (const it of json) applySourceIdOverride(it, map);
      return;
    }
    if (json && typeof json === "object") {
      if (typeof json.id === "string" && map.has(json.id)) {
        json.id = map.get(json.id);
      }
      for (const k of Object.keys(json)) {
        const v = json[k];
        if (v && typeof v === "object") applySourceIdOverride(v, map);
      }
    }
  }
  function exportJson() {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e;
      yield figma.loadAllPagesAsync();
      const sourceIdMap = buildSourceIdMap();
      console.log(`[exportJson] sourceId map size: ${sourceIdMap.size}`);
      const page = figma.currentPage;
      console.log(`[exportJson] Page: "${page.name}", children: ${page.children.length}`);
      for (let i = 0; i < page.children.length; i++) {
        const c = page.children[i];
        console.log(`  slide[${i}]: type=${c.type}, name="${c.name}", id=${c.id}, children=${"children" in c ? c.children.length : "N/A"}`);
      }
      const fileMeta = {
        fileName: figma.root.name,
        fileKey: (_a = figma.fileKey) != null ? _a : null
      };
      try {
        const rootJson = yield figma.root.exportAsync({
          format: "JSON_REST_V1"
        });
        const rootDoc = rootJson == null ? void 0 : rootJson.document;
        if (rootDoc) {
          const pages = (_b = rootDoc.children) != null ? _b : [];
          const hasContent = pages.some((p) => {
            var _a2;
            return ((_a2 = p.children) != null ? _a2 : []).length > 0;
          });
          if (hasContent) {
            console.log(`[exportJson] Root-level export succeeded (${pages.length} pages)`);
            applySourceIdOverride(rootJson, sourceIdMap);
            return __spreadValues(__spreadValues({}, rootJson), fileMeta);
          }
        }
      } catch (err) {
        console.warn("[exportJson] Root-level export failed:", err);
      }
      try {
        const pageJson = yield page.exportAsync({ format: "JSON_REST_V1" });
        const pageChildren = (_d = (_c = pageJson == null ? void 0 : pageJson.document) == null ? void 0 : _c.children) != null ? _d : [];
        if (pageChildren.length > 0) {
          console.log(`[exportJson] Page-level export succeeded (${pageChildren.length} children)`);
          applySourceIdOverride(pageJson, sourceIdMap);
          return __spreadValues(__spreadValues({}, pageJson), fileMeta);
        }
      } catch (err) {
        console.warn("[exportJson] Page-level export failed:", err);
      }
      console.log(`[exportJson] Using manual node-tree serialization...`);
      function collectSlides(node) {
        const CONTAINER_TYPES = ["SLIDE_GRID", "SLIDE_ROW"];
        if (node.type === "SLIDE") return [node];
        if (CONTAINER_TYPES.includes(node.type) && "children" in node) {
          const slides = [];
          for (const child of node.children) {
            slides.push(...collectSlides(child));
          }
          return slides;
        }
        return [node];
      }
      const actualSlides = [];
      for (const topChild of page.children) {
        actualSlides.push(...collectSlides(topChild));
      }
      console.log(`[exportJson] Found ${actualSlides.length} actual slide(s)`);
      const slideFrames = [];
      let totalChildren = 0;
      for (const slide of actualSlides) {
        let stripAbsBBox2 = function(json) {
          delete json.absoluteBoundingBox;
          delete json.absoluteRenderBounds;
          if (Array.isArray(json.children)) {
            for (const c of json.children) stripAbsBBox2(c);
          }
        };
        var stripAbsBBox = stripAbsBBox2;
        const slideChildren = "children" in slide ? slide.children : [];
        console.log(`  Slide "${slide.name}" (type=${slide.type}): ${slideChildren.length} children`);
        const childJsons = [];
        for (const child of slideChildren) {
          try {
            const childJson = serializeNode(child);
            if (childJson) {
              childJsons.push(childJson);
              totalChildren++;
            }
          } catch (err) {
            console.warn(`  Failed to serialize child "${child.name}":`, err);
          }
        }
        for (const cj of childJsons) stripAbsBBox2(cj);
        let slideExportId = slide.id;
        try {
          const sid = slide.getPluginData ? slide.getPluginData("sourceId") : "";
          if (sid) slideExportId = sid;
        } catch (e) {
        }
        const slideFrame = {
          id: slideExportId,
          name: slide.name,
          type: "FRAME",
          scrollBehavior: "SCROLLS",
          children: childJsons,
          absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
          absoluteRenderBounds: { x: 0, y: 0, width: 1920, height: 1080 },
          constraints: { vertical: "TOP", horizontal: "LEFT" },
          clipsContent: true,
          background: [],
          fills: [],
          strokes: [],
          strokeWeight: 0,
          strokeAlign: "INSIDE",
          effects: []
        };
        try {
          const w = slide.width;
          const h = slide.height;
          if (w && h) {
            slideFrame.absoluteBoundingBox = { x: 0, y: 0, width: w, height: h };
            slideFrame.absoluteRenderBounds = { x: 0, y: 0, width: w, height: h };
            slideFrame.size = { x: w, y: h };
          }
        } catch (e) {
        }
        try {
          const fills = slide.fills;
          if (fills && Array.isArray(fills)) {
            slideFrame.fills = serializePaints(fills);
          }
        } catch (e) {
        }
        try {
          const strokes = slide.strokes;
          if (strokes && strokes !== figma.mixed && Array.isArray(strokes)) {
            slideFrame.strokes = serializePaints(strokes);
          }
          const sw = slide.strokeWeight;
          if (sw != null && sw !== figma.mixed) slideFrame.strokeWeight = sw;
          const sa = slide.strokeAlign;
          if (sa) slideFrame.strokeAlign = sa;
        } catch (e) {
        }
        slideFrames.push(slideFrame);
      }
      let bgColor = { r: 0.118, g: 0.118, b: 0.118, a: 1 };
      try {
        const pageBg = page.backgrounds;
        if (pageBg && pageBg.length > 0 && pageBg[0].color) {
          bgColor = { r: pageBg[0].color.r, g: pageBg[0].color.g, b: pageBg[0].color.b, a: (_e = pageBg[0].opacity) != null ? _e : 1 };
        }
      } catch (e) {
      }
      console.log(`[exportJson] Manual serialization: ${slideFrames.length} slides, ${totalChildren} total children`);
      return __spreadProps(__spreadValues({}, fileMeta), {
        document: {
          id: figma.root.id,
          name: figma.root.name,
          type: "DOCUMENT",
          children: [
            {
              id: page.id,
              name: page.name,
              type: "CANVAS",
              scrollBehavior: "SCROLLS",
              children: slideFrames,
              backgroundColor: bgColor,
              prototypeStartNodeID: null,
              flowStartingPoints: [],
              prototypeDevice: { type: "NONE", rotation: "NONE" }
            }
          ]
        },
        components: {},
        componentSets: {},
        schemaVersion: 0,
        styles: {}
      });
    });
  }
  function importJson(params) {
    return __async(this, null, function* () {
      var _a, _b, _c, _d;
      nodeIdMap.clear();
      imageHashMap.clear();
      imagePaintStats.total = 0;
      imagePaintStats.resolved = 0;
      imagePaintStats.unresolved = 0;
      imagePaintStats.refs = [];
      resetImportLogs();
      const { jsonString, imageData } = params != null ? params : {};
      if (!jsonString) {
        throw new Error('No "jsonString" param supplied');
      }
      function decodeBase64(b64) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const lookup = new Uint8Array(256);
        for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
        let len = b64.length;
        while (len > 0 && b64[len - 1] === "=") len--;
        const outLen = len * 3 >> 2;
        const bytes = new Uint8Array(outLen);
        let p = 0;
        for (let i = 0; i < len; i += 4) {
          const a = lookup[b64.charCodeAt(i)];
          const b = i + 1 < len ? lookup[b64.charCodeAt(i + 1)] : 0;
          const c = i + 2 < len ? lookup[b64.charCodeAt(i + 2)] : 0;
          const d = i + 3 < len ? lookup[b64.charCodeAt(i + 3)] : 0;
          bytes[p++] = a << 2 | b >> 4;
          if (i + 2 < len) bytes[p++] = (b & 15) << 4 | c >> 2;
          if (i + 3 < len) bytes[p++] = (c & 3) << 6 | d;
        }
        return bytes;
      }
      const imageErrors = [];
      if (imageData && typeof imageData === "object") {
        for (const [ref, b64] of Object.entries(imageData)) {
          try {
            const b64Str = typeof b64 === "string" ? b64 : String(b64);
            console.log(`[importJson] Decoding image ${ref}: b64 length=${b64Str.length}`);
            const raw = decodeBase64(b64Str);
            console.log(`[importJson] Decoded ${ref}: ${raw.length} bytes, PNG header=[${raw[0]},${raw[1]},${raw[2]},${raw[3]}]`);
            const img = figma.createImage(raw);
            imageHashMap.set(ref, img.hash);
            console.log(`[importJson] Registered image: ${ref} \u2192 ${img.hash}`);
          } catch (err) {
            const errMsg = `${ref}: ${err instanceof Error ? err.message : String(err)}`;
            imageErrors.push(errMsg);
            console.warn(`[importJson] Failed to register image ${ref}:`, err);
          }
        }
        console.log(`[importJson] ${imageHashMap.size}/${Object.keys(imageData).length} images registered`);
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch (err) {
        throw new Error(
          "[importJson] Invalid JSON \u2013 " + getErrorMessage(err)
        );
      }
      function stripBoundVarsFromJson(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const item of obj) stripBoundVarsFromJson(item);
          return;
        }
        delete obj.boundVariables;
        for (const val of Object.values(obj)) {
          if (val && typeof val === "object") stripBoundVarsFromJson(val);
        }
      }
      stripBoundVarsFromJson(parsed);
      function splitMultiFillVectors(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const item of obj) splitMultiFillVectors(item);
          return;
        }
        if (Array.isArray(obj.children) && obj.children.length) {
          const newChildren = [];
          for (const child of obj.children) {
            splitMultiFillVectors(child);
            const split = trySplitVectorByOverride(child);
            if (split) newChildren.push(...split);
            else newChildren.push(child);
          }
          obj.children = newChildren;
        }
        for (const [k, v] of Object.entries(obj)) {
          if (k === "children") continue;
          if (v && typeof v === "object") splitMultiFillVectors(v);
        }
      }
      function trySplitVectorByOverride(node) {
        if (!node || node.type !== "VECTOR") return null;
        const fot = node.fillOverrideTable;
        const fg = node.fillGeometry;
        if (!fot || typeof fot !== "object") return null;
        if (!Array.isArray(fg) || fg.length === 0) return null;
        const defaultFills = Array.isArray(node.fills) && node.fills.length ? node.fills : [];
        const perPathFills = [];
        let distinctOverrides = 0;
        for (const g of fg) {
          const oid = g.overrideID;
          const ovEntry = oid != null ? fot[String(oid)] : null;
          if (ovEntry && Array.isArray(ovEntry.fills) && ovEntry.fills.length) {
            perPathFills.push(ovEntry.fills);
            distinctOverrides++;
          } else {
            perPathFills.push(defaultFills);
          }
        }
        if (distinctOverrides === 0) return null;
        const pbb = node.absoluteBoundingBox || {};
        const pSize = node.size || {};
        const pX = typeof pbb.x === "number" ? pbb.x : 0;
        const pY = typeof pbb.y === "number" ? pbb.y : 0;
        const pW = typeof pbb.width === "number" ? pbb.width : pSize.x;
        const pH = typeof pbb.height === "number" ? pbb.height : pSize.y;
        function pathBBox(d) {
          const nums = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
          if (!nums || nums.length < 4) return null;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let i = 0; i + 1 < nums.length; i += 2) {
            const x = parseFloat(nums[i]);
            const y = parseFloat(nums[i + 1]);
            if (!isFinite(x) || !isFinite(y)) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
          if (!isFinite(minX)) return null;
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        function translatePath(d, dx, dy) {
          let out = "";
          let i = 0;
          let cmd = "";
          while (i < d.length) {
            const ch = d[i];
            if (/[a-zA-Z]/.test(ch)) {
              cmd = ch;
              out += ch;
              i++;
              continue;
            }
            if (/[\s,]/.test(ch)) {
              out += ch;
              i++;
              continue;
            }
            const numRe = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/y;
            numRe.lastIndex = i;
            const m1 = numRe.exec(d);
            if (!m1) {
              out += d[i];
              i++;
              continue;
            }
            i = numRe.lastIndex;
            while (i < d.length && /[\s,]/.test(d[i])) {
              out += d[i];
              i++;
            }
            numRe.lastIndex = i;
            const m2 = numRe.exec(d);
            if (!m2) {
              out += m1[0];
              continue;
            }
            const x = parseFloat(m1[0]);
            const y = parseFloat(m2[0]);
            i = numRe.lastIndex;
            const isAbs = !!cmd && cmd === cmd.toUpperCase() && cmd !== "Z";
            if (isAbs) {
              out += `${(x - dx).toFixed(4)} ${(y - dy).toFixed(4)}`;
            } else {
              out += `${m1[0]} ${m2[0]}`;
            }
          }
          return out;
        }
        const baseProps = {};
        for (const key of [
          "constraints",
          "blendMode",
          "opacity",
          "visible",
          "effects",
          "strokeWeight",
          "strokeAlign",
          "strokes",
          "strokeGeometry",
          "complexStrokeProperties"
        ]) {
          if (key in node) baseProps[key] = node[key];
        }
        return fg.map((g, i) => {
          var _a2, _b2;
          const bb = pathBBox(g.path || "");
          let childX = pX, childY = pY, childW = pW, childH = pH;
          let translatedPath = g.path;
          if (bb && bb.w > 0 && bb.h > 0) {
            childX = pX + bb.x;
            childY = pY + bb.y;
            childW = bb.w;
            childH = bb.h;
            translatedPath = translatePath(g.path, bb.x, bb.y);
          }
          return __spreadProps(__spreadValues({}, baseProps), {
            id: `${(_a2 = node.id) != null ? _a2 : "vec"}_split_${i}`,
            name: `${(_b2 = node.name) != null ? _b2 : "Vector"}_${i}`,
            type: "VECTOR",
            fills: perPathFills[i],
            fillGeometry: [{
              path: translatedPath,
              windingRule: g.windingRule
            }],
            absoluteBoundingBox: {
              x: childX,
              y: childY,
              width: childW,
              height: childH
            },
            size: { x: childW, y: childH }
          });
        });
      }
      splitMultiFillVectors(parsed);
      if (!((_a = parsed == null ? void 0 : parsed.document) == null ? void 0 : _a.children) || !Array.isArray(parsed.document.children)) {
        throw new Error("[importJson] document.children not found");
      }
      let pageNode;
      if (parsed.document.type === "DOCUMENT") {
        pageNode = parsed.document.children[0];
      } else {
        pageNode = parsed.document;
      }
      if (!(pageNode == null ? void 0 : pageNode.children) || !Array.isArray(pageNode.children)) {
        throw new Error("[importJson] No page children (slides) found in document");
      }
      function extractSlideFrames(children) {
        const CONTAINER_TYPES = ["SLIDE_GRID", "SLIDE_ROW", "SECTION"];
        const result = [];
        for (const child of children) {
          if (CONTAINER_TYPES.includes(child.type) && Array.isArray(child.children)) {
            result.push(...extractSlideFrames(child.children));
          } else if (child.type === "SLIDE" && Array.isArray(child.children)) {
            result.push(__spreadProps(__spreadValues({}, child), { type: "FRAME" }));
          } else if (child.type === "FRAME" && Array.isArray(child.children) && child.children.some(
            (c) => CONTAINER_TYPES.includes(c.type) || c.type === "SLIDE"
          )) {
            result.push(...extractSlideFrames(child.children));
          } else {
            result.push(child);
          }
        }
        return result;
      }
      const slideJsons = extractSlideFrames(pageNode.children);
      const page = figma.currentPage;
      function collectExistingSlides(node) {
        if (node.type === "SLIDE") return [node];
        const result = [];
        if ("children" in node && Array.isArray(node.children)) {
          for (const child of node.children) {
            result.push(...collectExistingSlides(child));
          }
        }
        return result;
      }
      const existingSlides = [];
      const existingOrphans = [];
      const CONTAINER_TYPES_SET = /* @__PURE__ */ new Set(["SLIDE_GRID", "SLIDE_ROW"]);
      for (const child of page.children) {
        existingSlides.push(...collectExistingSlides(child));
        if (!CONTAINER_TYPES_SET.has(child.type) && child.type !== "SLIDE") {
          existingOrphans.push(child);
        }
      }
      const slideIds = [];
      const indicesToImport = new Set((_b = params.slideIndicesToImport) != null ? _b : []);
      const requestedSelective = Array.isArray(params.slideIndicesToImport) && params.slideIndicesToImport.length > 0;
      const selectiveMode = requestedSelective && existingSlides.length > 0;
      if (requestedSelective && !selectiveMode) {
        console.log(`[importJson] Selective import requested but canvas is empty (${existingSlides.length} existing slides). Falling back to full import.`);
      }
      if (selectiveMode) {
        console.log(`[importJson] Selective import mode: importing slides at indices [${[...indicesToImport]}] out of ${slideJsons.length} total (${existingSlides.length} existing slides)`);
      }
      function mapExistingNodeIds(jsonNode, liveNode) {
        var _a2;
        if (jsonNode.id && liveNode.id) {
          nodeIdMap.set(jsonNode.id, liveNode.id);
        }
        const jc = (_a2 = jsonNode.children) != null ? _a2 : [];
        const lc = "children" in liveNode ? Array.from(liveNode.children) : [];
        if (jc.length === 0 || lc.length === 0) return;
        if (jc.length === lc.length) {
          for (let i = 0; i < jc.length; i++) {
            mapExistingNodeIds(jc[i], lc[i]);
          }
          return;
        }
        const usedLive = /* @__PURE__ */ new Set();
        const matchedJson = /* @__PURE__ */ new Set();
        for (let ji = 0; ji < jc.length; ji++) {
          for (let li = 0; li < lc.length; li++) {
            if (usedLive.has(li)) continue;
            if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
              usedLive.add(li);
              matchedJson.add(ji);
              mapExistingNodeIds(jc[ji], lc[li]);
              break;
            }
          }
        }
        const remJ = jc.map((_, i) => i).filter((i) => !matchedJson.has(i));
        const remL = lc.map((_, i) => i).filter((i) => !usedLive.has(i));
        for (let k = 0; k < Math.min(remJ.length, remL.length); k++) {
          mapExistingNodeIds(jc[remJ[k]], lc[remL[k]]);
        }
      }
      for (let slideIdx = 0; slideIdx < slideJsons.length; slideIdx++) {
        const slideJson = slideJsons[slideIdx];
        if (selectiveMode && !indicesToImport.has(slideIdx)) {
          if (slideIdx < existingSlides.length) {
            const existingSlide = existingSlides[slideIdx];
            console.log(`[importJson] Keeping existing slide ${slideIdx} (id=${existingSlide.id}, name="${existingSlide.name}")`);
            mapExistingNodeIds(slideJson, existingSlide);
            slideIds.push(existingSlide.id);
          } else {
            console.warn(`[importJson] Selective skip slide ${slideIdx} but no existing slide at that index`);
          }
          continue;
        }
        const slide = figma.createSlide();
        slide.name = (_c = slideJson.name) != null ? _c : "Imported Slide";
        try {
          const bv = slide.boundVariables;
          if (bv) {
            for (const field of Object.keys(bv)) {
              try {
                slide.setBoundVariable(field, null);
              } catch (e) {
              }
            }
          }
        } catch (e) {
          try {
            const fills = slide.fills;
            if (fills && fills !== figma.mixed && Array.isArray(fills)) {
              slide.fills = fills.map((f) => __spreadValues({}, f));
            }
          } catch (e2) {
          }
          try {
            const strokes = slide.strokes;
            if (strokes && Array.isArray(strokes)) {
              slide.strokes = strokes.map((s) => __spreadValues({}, s));
            }
          } catch (e2) {
          }
          try {
            const effects = slide.effects;
            if (effects && Array.isArray(effects)) {
              slide.effects = effects.map((e2) => __spreadValues({}, e2));
            }
          } catch (e2) {
          }
        }
        if (slideJson.id) {
          nodeIdMap.set(slideJson.id, slide.id);
          try {
            slide.setPluginData("sourceId", String(slideJson.id));
          } catch (e) {
          }
        }
        try {
          if ("layoutMode" in slide) {
            slide.layoutMode = (_d = slideJson.layoutMode) != null ? _d : "NONE";
          }
        } catch (err) {
          console.warn("[importJson] Could not set slide layoutMode:", err);
        }
        try {
          if ("clipsContent" in slide && slideJson.clipsContent !== void 0) {
            slide.clipsContent = slideJson.clipsContent;
          }
        } catch (e) {
        }
        try {
          if (Array.isArray(slideJson.fills) && slideJson.fills.length > 0) {
            const paints = slideJson.fills.map((f) => formatPaint(f)).filter(Boolean);
            if (paints.length > 0) {
              slide.fills = paints;
            }
          } else if (slideJson.backgroundColor) {
            const { r, g, b, a } = slideJson.backgroundColor;
            slide.fills = [
              { type: "SOLID", color: { r, g, b }, opacity: a != null ? a : 1 }
            ];
          }
        } catch (err) {
          console.warn("[importJson] Could not apply slide background:", err);
        }
        if (Array.isArray(slideJson.children)) {
          for (const childJson of slideJson.children) {
            try {
              const childNode = yield createNode(childJson, slide, slideJson);
              if (childNode) {
                slide.appendChild(childNode);
                if (Array.isArray(childJson.relativeTransform) && childJson.relativeTransform.length === 2 && "relativeTransform" in childNode) {
                  try {
                    const M = childJson.relativeTransform;
                    const target = [
                      [M[0][0], M[0][1], M[0][2]],
                      [M[1][0], M[1][1], M[1][2]]
                    ];
                    const hasRotation = Math.abs(M[0][1]) > 1e-3 || Math.abs(M[1][0]) > 1e-3;
                    if (hasRotation) {
                      console.log(`[importJson] Re-applying ROTATED transform for "${childJson.name}" (${childJson.type}): tx=${M[0][2].toFixed(1)} ty=${M[1][2].toFixed(1)} cos=${M[0][0].toFixed(4)} sin=${M[0][1].toFixed(4)}`);
                    }
                    childNode.relativeTransform = target;
                    if (hasRotation) {
                      const actual = childNode.relativeTransform;
                      console.log(`[importJson] After re-apply: tx=${actual[0][2].toFixed(1)} ty=${actual[1][2].toFixed(1)} cos=${actual[0][0].toFixed(4)} sin=${actual[0][1].toFixed(4)}`);
                    }
                  } catch (e) {
                    console.warn(`[importJson] \u26A0\uFE0F Re-apply relativeTransform FAILED for "${childJson.name}" (${childJson.type}): ${e instanceof Error ? e.message : e}`);
                  }
                }
              }
            } catch (err) {
              console.warn(
                `[importJson] Failed to create child "${childJson.name}":`,
                getErrorMessage(err)
              );
            }
          }
        }
        slideIds.push(slide.id);
      }
      const newSlideIdSetPreStab = new Set(slideIds);
      for (const oldSlide of existingSlides) {
        if (newSlideIdSetPreStab.has(oldSlide.id)) continue;
        try {
          oldSlide.remove();
        } catch (err) {
          console.warn("[importJson] Could not remove old slide:", getErrorMessage(err));
        }
      }
      if (!selectiveMode) {
        for (const orphan of existingOrphans) {
          try {
            orphan.remove();
          } catch (err) {
            console.warn("[importJson] Could not remove orphan:", getErrorMessage(err));
          }
        }
      }
      yield figma.loadAllPagesAsync();
      const freshSlides = [];
      function findFreshSlides(node) {
        if (node.type === "SLIDE") {
          freshSlides.push(node);
          return;
        }
        if ("children" in node) {
          for (const child of node.children) findFreshSlides(child);
        }
      }
      findFreshSlides(page);
      let remapCount = 0;
      function rebuildMapping(jsonNode, liveNode) {
        var _a2;
        if (jsonNode.id) {
          const prev = nodeIdMap.get(jsonNode.id);
          nodeIdMap.set(jsonNode.id, liveNode.id);
          if (prev && prev !== liveNode.id) remapCount++;
        }
        const jc = (_a2 = jsonNode.children) != null ? _a2 : [];
        const lc = "children" in liveNode ? Array.from(liveNode.children) : [];
        if (jc.length === 0 || lc.length === 0) return;
        if (jc.length === lc.length) {
          for (let i = 0; i < jc.length; i++) {
            rebuildMapping(jc[i], lc[i]);
          }
          return;
        }
        const usedLive = /* @__PURE__ */ new Set();
        const matchedJson = /* @__PURE__ */ new Set();
        for (let ji = 0; ji < jc.length; ji++) {
          for (let li = 0; li < lc.length; li++) {
            if (usedLive.has(li)) continue;
            if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
              usedLive.add(li);
              matchedJson.add(ji);
              rebuildMapping(jc[ji], lc[li]);
              break;
            }
          }
        }
        for (let ji = 0; ji < jc.length; ji++) {
          if (matchedJson.has(ji)) continue;
          for (let li = 0; li < lc.length; li++) {
            if (usedLive.has(li)) continue;
            if (jc[ji].name && lc[li].name === jc[ji].name) {
              usedLive.add(li);
              matchedJson.add(ji);
              rebuildMapping(jc[ji], lc[li]);
              break;
            }
          }
        }
        const remainingJson = jc.map((_, i) => i).filter((i) => !matchedJson.has(i));
        const remainingLive = lc.map((_, i) => i).filter((i) => !usedLive.has(i));
        for (let k = 0; k < Math.min(remainingJson.length, remainingLive.length); k++) {
          rebuildMapping(jc[remainingJson[k]], lc[remainingLive[k]]);
        }
      }
      slideIds.length = 0;
      for (let i = 0; i < Math.min(slideJsons.length, freshSlides.length); i++) {
        rebuildMapping(slideJsons[i], freshSlides[i]);
        slideIds.push(freshSlides[i].id);
      }
      if (remapCount > 0) {
        console.log(`[importJson] Stabilization: remapped ${remapCount} stale node ID(s)`);
      }
      if (freshSlides.length > slideJsons.length) {
        const surplus = freshSlides.slice(slideJsons.length);
        console.warn(`[importJson] Removing ${surplus.length} surplus slide(s) created during stabilization`);
        for (const extra of surplus) {
          try {
            extra.remove();
          } catch (err) {
            console.warn(`[importJson] Could not remove surplus slide "${extra.name}":`, getErrorMessage(err));
          }
        }
      }
      let imgFixCount = 0;
      let imgFixFailed = 0;
      function reapplyImagesFromJson(jsonNode, liveNode) {
        var _a2;
        if (jsonNode.type !== "TEXT" && Array.isArray(jsonNode.fills) && "fills" in liveNode) {
          const hasJsonImage = jsonNode.fills.some((f) => f.type === "IMAGE");
          if (hasJsonImage) {
            try {
              const paints = jsonNode.fills.map((f) => formatPaint(f)).filter((p) => p !== void 0);
              if (paints.length > 0) {
                console.log(`[reapplyImages] Applying ${paints.length} paint(s) to "${liveNode.name}" (${liveNode.type}, id=${liveNode.id}) \u2014 JSON: "${jsonNode.name}" (${jsonNode.type}, id=${jsonNode.id})`);
                liveNode.fills = paints;
                const readBack = liveNode.fills;
                const imgAfter = Array.isArray(readBack) ? readBack.filter((p) => p.type === "IMAGE") : [];
                if (imgAfter.length > 0) {
                  imgFixCount++;
                  console.log(`[reapplyImages] OK: "${liveNode.name}" now has ${imgAfter.length} IMAGE fill(s), hash=${imgAfter.map((p) => p.imageHash).join(",")}`);
                } else {
                  imgFixFailed++;
                  console.warn(`[reapplyImages] FAILED: "${liveNode.name}" (${liveNode.type}, id=${liveNode.id}) \u2014 readback has 0 IMAGE fills (paints set: ${paints.length})`);
                  imagePaintStats.refs.push(`REAPPLY_FAIL:${liveNode.name}(${liveNode.type})`);
                }
              }
            } catch (err) {
              imgFixFailed++;
              console.warn(`[reapplyImages] ERROR for "${jsonNode.name}":`, getErrorMessage(err));
              imagePaintStats.refs.push(`REAPPLY_ERR:${jsonNode.name}:${getErrorMessage(err)}`);
            }
          }
        }
        if ("fills" in liveNode) {
          try {
            const fills = liveNode.fills;
            if (fills && fills !== figma.mixed && Array.isArray(fills)) {
              if (fills.some((f) => f.type === "IMAGE")) {
                liveNode.fills = fills.map((f) => __spreadValues({}, f));
              }
            }
          } catch (e) {
          }
        }
        const jc = (_a2 = jsonNode.children) != null ? _a2 : [];
        const lc = "children" in liveNode ? Array.from(liveNode.children) : [];
        if (jc.length > 0 && lc.length > 0) {
          if (jc.length === lc.length) {
            for (let i = 0; i < jc.length; i++) {
              reapplyImagesFromJson(jc[i], lc[i]);
            }
          } else {
            const usedLive = /* @__PURE__ */ new Set();
            const matchedJson = /* @__PURE__ */ new Set();
            for (let ji = 0; ji < jc.length; ji++) {
              for (let li = 0; li < lc.length; li++) {
                if (usedLive.has(li)) continue;
                if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
                  usedLive.add(li);
                  matchedJson.add(ji);
                  reapplyImagesFromJson(jc[ji], lc[li]);
                  break;
                }
              }
            }
            const remJ = jc.map((_, i) => i).filter((i) => !matchedJson.has(i));
            const remL = lc.map((_, i) => i).filter((i) => !usedLive.has(i));
            for (let k = 0; k < Math.min(remJ.length, remL.length); k++) {
              reapplyImagesFromJson(jc[remJ[k]], lc[remL[k]]);
            }
          }
        }
      }
      const keptSlideIdSet = new Set(slideIds);
      for (let i = 0; i < Math.min(slideJsons.length, freshSlides.length); i++) {
        if (keptSlideIdSet.has(freshSlides[i].id)) {
          reapplyImagesFromJson(slideJsons[i], freshSlides[i]);
        }
      }
      if (imgFixCount > 0 || imgFixFailed > 0) {
        console.log(`[importJson] Stabilization: re-applied IMAGE fills on ${imgFixCount} node(s)${imgFixFailed > 0 ? `, ${imgFixFailed} failed` : ""}`);
      }
      let textFixCount = 0;
      function collectTextProps(jsonNode) {
        const map = /* @__PURE__ */ new Map();
        function walk(node) {
          if (!node || typeof node !== "object") return;
          if (node.type === "TEXT" && node.id) {
            const props = {};
            if (Array.isArray(node.lineTypes)) props.lineTypes = node.lineTypes;
            if (Array.isArray(node.lineIndentations)) props.lineIndentations = node.lineIndentations;
            if (node.characters) props.characters = node.characters;
            if (Object.keys(props).length > 0) map.set(node.id, props);
          }
          if (Array.isArray(node.children)) {
            for (const child of node.children) walk(child);
          }
        }
        walk(jsonNode);
        return map;
      }
      const textPropsMap = /* @__PURE__ */ new Map();
      for (const sj of slideJsons) {
        const m = collectTextProps(sj);
        for (const [id, props] of m) textPropsMap.set(id, props);
      }
      const orderedNumberMap = /* @__PURE__ */ new Map();
      function findOrderedGroups(jsonNode) {
        var _a2;
        if (!jsonNode || typeof jsonNode !== "object") return;
        if (Array.isArray(jsonNode.children)) {
          const orderedKids = [];
          for (const child of jsonNode.children) {
            if (child.type !== "TEXT" || !child.id) continue;
            if (!Array.isArray(child.lineTypes) || child.lineTypes.length === 0) continue;
            if (child.lineTypes[0] !== "ORDERED") continue;
            const chars = (_a2 = child.characters) != null ? _a2 : "";
            if (chars.length === 0 || chars.includes("\n")) continue;
            orderedKids.push(child.id);
          }
          if (orderedKids.length > 1) {
            for (let i = 0; i < orderedKids.length; i++) {
              orderedNumberMap.set(orderedKids[i], i + 1);
            }
          }
          for (const child of jsonNode.children) findOrderedGroups(child);
        }
      }
      for (const sj of slideJsons) findOrderedGroups(sj);
      if (orderedNumberMap.size > 0) {
        console.log(`[importJson] Found ${orderedNumberMap.size} ORDERED list items in ${Math.ceil(orderedNumberMap.size / 2)}+ sibling groups`);
      }
      function reapplyTextProps(node) {
        return __async(this, null, function* () {
          var _a2, _b2, _c2;
          if (node.type === "TEXT") {
            let jsonId;
            for (const [oldId, newId] of nodeIdMap) {
              if (newId === node.id) {
                jsonId = oldId;
                break;
              }
            }
            if (jsonId && textPropsMap.has(jsonId)) {
              const props = textPropsMap.get(jsonId);
              try {
                if (orderedNumberMap.has(jsonId)) {
                  const num = orderedNumberMap.get(jsonId);
                  try {
                    const fontAtStart = node.getRangeFontName(0, 1);
                    if (fontAtStart && fontAtStart !== figma.mixed) {
                      yield figma.loadFontAsync(fontAtStart);
                    } else if (node.fontName && node.fontName !== figma.mixed) {
                      yield figma.loadFontAsync(node.fontName);
                    }
                  } catch (e) {
                  }
                  node.insertCharacters(0, `${num}. `);
                  const totalLen = node.characters.length;
                  if (totalLen > 0) {
                    try {
                      node.setRangeListOptions(0, totalLen, { type: "NONE" });
                    } catch (e) {
                    }
                  }
                  textFixCount++;
                  console.log(`[importJson] Prepended "${num}. " to "${node.name}" (jsonId=${jsonId})`);
                } else if (Array.isArray(props.lineTypes) && props.lineTypes.some((t) => t !== "NONE")) {
                  const chars = (_a2 = node.characters) != null ? _a2 : "";
                  if (chars.length > 0) {
                    try {
                      const fontName = node.fontName;
                      if (fontName && fontName !== figma.mixed) {
                        yield figma.loadFontAsync(fontName);
                      }
                    } catch (e) {
                    }
                    const lines = chars.split("\n");
                    let charOffset = 0;
                    for (let li = 0; li < lines.length && li < props.lineTypes.length; li++) {
                      const lineStart = charOffset;
                      const lineEnd = charOffset + lines[li].length;
                      charOffset = lineEnd + 1;
                      if (lineEnd <= lineStart) continue;
                      const lt = props.lineTypes[li];
                      if (lt && lt !== "NONE") {
                        try {
                          node.setRangeListOptions(lineStart, lineEnd, { type: lt });
                          textFixCount++;
                        } catch (e) {
                        }
                      }
                      const indent = (_c2 = (_b2 = props.lineIndentations) == null ? void 0 : _b2[li]) != null ? _c2 : 0;
                      if (indent > 0) {
                        try {
                          node.setRangeIndentation(lineStart, lineEnd, indent);
                        } catch (e) {
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn(`[importJson] reapplyTextProps failed for "${node.name}":`, e);
              }
            }
          }
          if ("children" in node) {
            for (const child of node.children) {
              yield reapplyTextProps(child);
            }
          }
        });
      }
      for (const slide of freshSlides) {
        if (keptSlideIdSet.has(slide.id)) yield reapplyTextProps(slide);
      }
      if (textFixCount > 0) {
        console.log(`[importJson] Stabilization: re-applied ${textFixCount} TEXT property fix(es)`);
      }
      const newSlideIdSet = new Set(slideIds);
      const containerWhitelist = /* @__PURE__ */ new Set();
      for (const child of page.children) {
        if (["SLIDE_GRID", "SLIDE_ROW"].includes(child.type) && "children" in child) {
          const hasOurSlide = Array.from(child.children).some(
            (c) => newSlideIdSet.has(c.id) || "children" in c && Array.from(c.children).some((sc) => newSlideIdSet.has(sc.id))
          );
          if (hasOurSlide) containerWhitelist.add(child.id);
        }
      }
      const orphans = [];
      for (const child of page.children) {
        if (!newSlideIdSet.has(child.id) && !containerWhitelist.has(child.id)) {
          orphans.push(child);
        }
      }
      if (orphans.length > 0) {
        console.warn(`[importJson] Removing ${orphans.length} orphan node(s) from page root`);
        for (const orphan of orphans) {
          try {
            orphan.remove();
          } catch (err) {
            console.warn(`[importJson] Could not remove orphan "${orphan.name}":`, getErrorMessage(err));
          }
        }
      }
      const imageDiag = [];
      function dumpImageNodes(node, slideIdx, depth) {
        var _a2, _b2, _c2, _d2, _e, _f;
        if ("fills" in node) {
          try {
            const fills = node.fills;
            if (fills && fills !== figma.mixed && Array.isArray(fills)) {
              const imgFills = fills.filter((f) => f.type === "IMAGE");
              if (imgFills.length > 0) {
                const entry = {
                  slide: slideIdx,
                  depth,
                  name: node.name,
                  type: node.type,
                  id: node.id,
                  width: node.width,
                  height: node.height,
                  visible: node.visible,
                  opacity: "opacity" in node ? node.opacity : "N/A",
                  x: node.x,
                  y: node.y,
                  fillsCount: fills.length,
                  imgFillsCount: imgFills.length,
                  imgHashes: imgFills.map((f) => {
                    var _a3;
                    return (_a3 = f.imageHash) != null ? _a3 : "null";
                  }),
                  imgScaleModes: imgFills.map((f) => {
                    var _a3;
                    return (_a3 = f.scaleMode) != null ? _a3 : "null";
                  }),
                  imgOpacities: imgFills.map((f) => {
                    var _a3;
                    return (_a3 = f.opacity) != null ? _a3 : "null";
                  }),
                  imgVisible: imgFills.map((f) => {
                    var _a3;
                    return (_a3 = f.visible) != null ? _a3 : "null";
                  }),
                  parentName: (_b2 = (_a2 = node.parent) == null ? void 0 : _a2.name) != null ? _b2 : "null",
                  parentType: (_d2 = (_c2 = node.parent) == null ? void 0 : _c2.type) != null ? _d2 : "null"
                };
                imageDiag.push(entry);
                console.log(`[imageDiag] slide=${slideIdx} depth=${depth} "${node.name}" (${node.type}, id=${node.id}) ${node.width}x${node.height} at (${node.x},${node.y}) visible=${node.visible} opacity=${"opacity" in node ? node.opacity : "?"} fills=${fills.length} imgFills=${imgFills.length} hashes=[${imgFills.map((f) => {
                  var _a3;
                  return ((_a3 = f.imageHash) != null ? _a3 : "null").substring(0, 12);
                }).join(",")}] parent="${(_e = node.parent) == null ? void 0 : _e.name}" (${(_f = node.parent) == null ? void 0 : _f.type})`);
              }
            }
          } catch (e) {
          }
        }
        if ("children" in node) {
          try {
            for (const child of node.children) {
              dumpImageNodes(child, slideIdx, depth + 1);
            }
          } catch (e) {
          }
        }
      }
      for (let si = 0; si < freshSlides.length; si++) {
        dumpImageNodes(freshSlides[si], si, 0);
      }
      const idMapping = {};
      for (const [oldId, newId] of nodeIdMap) {
        idMapping[oldId] = newId;
      }
      console.log(`[importJson] ID mapping: ${nodeIdMap.size} entries`);
      return {
        success: true,
        slideIds,
        slideCount: slideIds.length,
        nodeIdMap: idMapping,
        imagesRegistered: imageHashMap.size,
        imageHashMapEntries: Object.fromEntries(imageHashMap),
        imageDataReceived: !!(imageData && Object.keys(imageData).length > 0),
        imageDataKeys: imageData ? Object.keys(imageData).length : 0,
        imageErrors: imageErrors.length > 0 ? imageErrors : void 0,
        imagePaintStats: __spreadProps(__spreadValues({}, imagePaintStats), { refs: imagePaintStats.refs.slice(0, 30) }),
        imgFixCount,
        imgFixFailed,
        imageDiag,
        importLogs: importLogs.slice(0, 2e3),
        message: `Imported ${slideIds.length} slide(s) successfully, ${nodeIdMap.size} node IDs mapped, ${imageHashMap.size} images registered, IMAGE fills: ${imagePaintStats.total} total (${imagePaintStats.resolved} resolved, ${imagePaintStats.unresolved} unresolved), reapply: ${imgFixCount} ok / ${imgFixFailed} failed`
      };
    });
  }
  var init_importExportHandlers = __esm({
    "src/handlers/importExportHandlers.ts"() {
      "use strict";
      init_bridge();
    }
  });

  // src/handlers/smartArtHandlers.ts
  function toRGB3(c) {
    return { r: c.r, g: c.g, b: c.b };
  }
  function getPalette(style) {
    if (style.colorPalette === "custom" && style.customColors && style.customColors.length > 0) {
      return style.customColors;
    }
    return PALETTES[style.colorPalette || "dark"] || PALETTES.dark;
  }
  function getColor2(palette, index) {
    return palette[index % palette.length];
  }
  function rgbString(c) {
    return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  }
  function isLightColor(c) {
    const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    return luminance > 0.5;
  }
  function textColorFor(bg) {
    return isLightColor(bg) ? DARK_TEXT : WHITE;
  }
  function loadFont4(family = "Inter", style = "Regular") {
    return __async(this, null, function* () {
      try {
        yield figma.loadFontAsync({ family, style });
      } catch (e) {
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
      }
    });
  }
  function loadFonts2(family = "Inter") {
    return __async(this, null, function* () {
      yield Promise.all([
        loadFont4(family, "Regular"),
        loadFont4(family, "Bold")
      ]);
    });
  }
  function resolveParentId3(id) {
    return __async(this, null, function* () {
      return yield lookupNode(id);
    });
  }
  function getParentNode4(parentId) {
    return __async(this, null, function* () {
      if (parentId) {
        const node = yield resolveParentId3(parentId);
        if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
          return node;
        }
      }
      const focusedSlide = figma.currentPage.focusedSlide;
      return focusedSlide || figma.currentPage;
    });
  }
  function computeIndentLevel(whitespace) {
    let spaces = 0;
    for (const ch of whitespace) {
      if (ch === "	") spaces += 2;
      else if (ch === " ") spaces += 1;
    }
    return Math.floor(spaces / 2);
  }
  function parseBulletText(text) {
    var _a;
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const rootItems = [];
    const stack = [];
    let maxDepth = 0;
    let totalCount = 0;
    for (const line of lines) {
      const leadingWS = ((_a = line.match(/^(\s*)/)) == null ? void 0 : _a[1]) || "";
      const indentLevel = computeIndentLevel(leadingWS);
      const content = line.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
      if (!content) continue;
      const item = {
        text: content,
        level: indentLevel,
        children: []
      };
      totalCount++;
      maxDepth = Math.max(maxDepth, indentLevel);
      while (stack.length > 0 && stack[stack.length - 1].level >= indentLevel) {
        stack.pop();
      }
      if (stack.length === 0) {
        rootItems.push(item);
      } else {
        stack[stack.length - 1].item.children.push(item);
      }
      stack.push({ item, level: indentLevel });
    }
    return { items: rootItems, maxDepth, totalCount };
  }
  function flattenItems(tree) {
    const result = [];
    function walk(items) {
      for (const item of items) {
        result.push(item.text);
        walk(item.children);
      }
    }
    walk(tree.items);
    return result;
  }
  function makeTextNode(text, fontSize, fontFamily, color, bold = false) {
    return __async(this, null, function* () {
      var _a;
      const node = figma.createText();
      node.fontName = { family: fontFamily, style: bold ? "Bold" : "Regular" };
      node.characters = text;
      node.fontSize = fontSize;
      node.fills = [{ type: "SOLID", color: toRGB3(color), opacity: (_a = color.a) != null ? _a : 1 }];
      return node;
    });
  }
  function createBlock(text, w, h, bgColor, fontSize, fontFamily, cornerRadius) {
    return __async(this, null, function* () {
      var _a;
      const frame = figma.createFrame();
      frame.resize(w, h);
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.cornerRadius = cornerRadius;
      frame.fills = [
        { type: "SOLID", color: toRGB3(bgColor), opacity: (_a = bgColor.a) != null ? _a : 1 }
      ];
      const tc = textColorFor(bgColor);
      const textNode = yield makeTextNode(text, fontSize, fontFamily, tc, true);
      textNode.textAlignHorizontal = "CENTER";
      frame.appendChild(textNode);
      textNode.layoutSizingHorizontal = "FILL";
      return frame;
    });
  }
  function renderBasicBlockList(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      var _a;
      const items = flattenItems(tree);
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.fontSize || DEFAULTS.fontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      frame.layoutMode = "HORIZONTAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.itemSpacing = DEFAULTS.itemSpacing;
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "FIXED";
      const availW = width - DEFAULTS.blockPadding * 2 - DEFAULTS.itemSpacing * (items.length - 1);
      const blockW = Math.max(100, Math.floor(availW / items.length));
      const blockH = height - DEFAULTS.blockPadding * 2;
      for (let i = 0; i < items.length; i++) {
        const block = yield createBlock(
          items[i],
          blockW,
          blockH,
          getColor2(palette, i),
          fontSize,
          fontFamily,
          cr
        );
        block.name = `Block ${i + 1}`;
        frame.appendChild(block);
        block.layoutSizingHorizontal = "FILL";
        block.layoutSizingVertical = "FILL";
      }
    });
  }
  function renderVerticalBlockList(frame, tree, width, _height, style) {
    return __async(this, null, function* () {
      var _a;
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const titleFontSize = style.titleFontSize || DEFAULTS.titleFontSize;
      const descFontSize = style.fontSize || DEFAULTS.descFontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisAlignItems = "MIN";
      frame.counterAxisAlignItems = "MIN";
      frame.itemSpacing = 12;
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "HUG";
      for (let i = 0; i < tree.items.length; i++) {
        const item = tree.items[i];
        const color = getColor2(palette, i);
        const row = figma.createFrame();
        row.name = `Item ${i + 1}`;
        row.layoutMode = "HORIZONTAL";
        row.counterAxisAlignItems = "MIN";
        row.itemSpacing = 12;
        row.fills = [];
        row.layoutSizingVertical = "HUG";
        const bar = figma.createRectangle();
        bar.resize(6, 48);
        bar.cornerRadius = 3;
        bar.fills = [{ type: "SOLID", color: toRGB3(color) }];
        row.appendChild(bar);
        const textArea = figma.createFrame();
        textArea.layoutMode = "VERTICAL";
        textArea.itemSpacing = 4;
        textArea.fills = [];
        textArea.layoutSizingVertical = "HUG";
        const titleNode = yield makeTextNode(
          item.text,
          titleFontSize,
          fontFamily,
          DARK_TEXT,
          true
        );
        textArea.appendChild(titleNode);
        titleNode.layoutSizingHorizontal = "FILL";
        if (item.children.length > 0) {
          const desc = item.children.map((c) => c.text).join(", ");
          const descNode = yield makeTextNode(
            desc,
            descFontSize,
            fontFamily,
            { r: 0.4, g: 0.4, b: 0.4, a: 1 }
          );
          textArea.appendChild(descNode);
          descNode.layoutSizingHorizontal = "FILL";
        }
        row.appendChild(textArea);
        textArea.layoutSizingHorizontal = "FILL";
        frame.appendChild(row);
        row.layoutSizingHorizontal = "FILL";
      }
    });
  }
  function renderBasicProcess(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      var _a;
      const items = flattenItems(tree);
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.fontSize || DEFAULTS.fontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      const connColor = style.connectorColor || CONNECTOR_DEFAULT;
      const arrowGap = 10;
      frame.layoutMode = "HORIZONTAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.itemSpacing = arrowGap;
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "FIXED";
      const arrowCount = Math.max(0, items.length - 1);
      const arrowW = DEFAULTS.arrowSize;
      const totalArrowW = arrowCount * arrowW;
      const totalGaps = (items.length + arrowCount - 1) * arrowGap;
      const availW = width - DEFAULTS.blockPadding * 2 - totalArrowW - totalGaps;
      const blockW = Math.max(80, Math.floor(availW / items.length));
      const blockH = height - DEFAULTS.blockPadding * 2;
      for (let i = 0; i < items.length; i++) {
        const block = yield createBlock(
          items[i],
          blockW,
          blockH,
          getColor2(palette, i),
          fontSize,
          fontFamily,
          cr
        );
        block.name = `Step ${i + 1}`;
        frame.appendChild(block);
        block.layoutSizingHorizontal = "FILL";
        block.layoutSizingVertical = "FILL";
        if (i < items.length - 1) {
          const arrowH = Math.min(blockH * 0.35, 20);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${arrowW}" height="${arrowH}" viewBox="0 0 ${arrowW} ${arrowH}">
        <polygon points="2,2 ${arrowW - 2},${arrowH / 2} 2,${arrowH - 2}" fill="${rgbString(connColor)}" stroke="${rgbString(connColor)}" stroke-width="1" stroke-linejoin="round"/>
      </svg>`;
          const arrowNode = figma.createNodeFromSvg(svg);
          arrowNode.name = `Arrow ${i + 1}`;
          arrowNode.resize(arrowW, arrowH);
          frame.appendChild(arrowNode);
        }
      }
    });
  }
  function renderChevronProcess(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      const items = flattenItems(tree);
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.fontSize || DEFAULTS.fontSize;
      const pd = DEFAULTS.chevronPointDepth;
      frame.layoutMode = "HORIZONTAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.itemSpacing = -pd / 2;
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "FIXED";
      const innerH = height - DEFAULTS.blockPadding * 2;
      const totalW = width - DEFAULTS.blockPadding * 2;
      const chevronW = Math.max(
        100,
        Math.floor((totalW + pd / 2 * (items.length - 1)) / items.length)
      );
      for (let i = 0; i < items.length; i++) {
        const color = getColor2(palette, i);
        const isFirst = i === 0;
        const w = chevronW;
        const h = innerH;
        const rgb = rgbString(color);
        let path;
        if (isFirst) {
          path = `M 0 0 L ${w - pd} 0 L ${w} ${h / 2} L ${w - pd} ${h} L 0 ${h} Z`;
        } else {
          path = `M 0 0 L ${w - pd} 0 L ${w} ${h / 2} L ${w - pd} ${h} L 0 ${h} L ${pd} ${h / 2} Z`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <path d="${path}" fill="${rgb}"/>
    </svg>`;
        const container = figma.createFrame();
        container.name = `Chevron ${i + 1}`;
        container.resize(w, h);
        container.fills = [];
        container.clipsContent = false;
        const chevronNode = figma.createNodeFromSvg(svg);
        chevronNode.x = 0;
        chevronNode.y = 0;
        chevronNode.resize(w, h);
        container.appendChild(chevronNode);
        const tc = textColorFor(color);
        const textNode = yield makeTextNode(
          items[i],
          fontSize,
          fontFamily,
          tc,
          true
        );
        textNode.textAlignHorizontal = "CENTER";
        textNode.resize(w - pd * 2, fontSize * 2);
        textNode.x = pd;
        textNode.y = (h - fontSize * 2) / 2;
        container.appendChild(textNode);
        frame.appendChild(container);
      }
    });
  }
  function renderOrgChart(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      var _a;
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.fontSize || DEFAULTS.fontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      const connColor = style.connectorColor || CONNECTOR_DEFAULT;
      const connWidth = style.connectorWidth || 2;
      const nw = DEFAULTS.orgNodeWidth;
      const nh = DEFAULTS.orgNodeHeight;
      const levelGap = DEFAULTS.orgLevelGap;
      const sibGap = DEFAULTS.orgSiblingGap;
      frame.layoutMode = "NONE";
      frame.fills = [];
      function computeWidth(item) {
        if (item.children.length === 0) return nw;
        let total = 0;
        for (let i = 0; i < item.children.length; i++) {
          if (i > 0) total += sibGap;
          total += computeWidth(item.children[i]);
        }
        return Math.max(nw, total);
      }
      function layoutTree(item, cx, y, depth) {
        const sw = computeWidth(item);
        const childLayouts = [];
        if (item.children.length > 0) {
          let startX2 = cx - sw / 2;
          for (const child of item.children) {
            const cw = computeWidth(child);
            const childCx = startX2 + cw / 2;
            childLayouts.push(
              layoutTree(child, childCx, y + nh + levelGap, depth + 1)
            );
            startX2 += cw + sibGap;
          }
        }
        return {
          item,
          x: cx - nw / 2,
          y,
          subtreeWidth: sw,
          children: childLayouts
        };
      }
      let totalWidth = 0;
      for (let i = 0; i < tree.items.length; i++) {
        if (i > 0) totalWidth += sibGap * 2;
        totalWidth += computeWidth(tree.items[i]);
      }
      const layouts = [];
      let startX = width / 2 - totalWidth / 2;
      for (const rootItem of tree.items) {
        const sw = computeWidth(rootItem);
        layouts.push(layoutTree(rootItem, startX + sw / 2, DEFAULTS.blockPadding, 0));
        startX += sw + sibGap * 2;
      }
      let colorIdx = 0;
      function renderNode(layout, depth) {
        return __async(this, null, function* () {
          const color = getColor2(palette, colorIdx++);
          const block = yield createBlock(
            layout.item.text,
            nw,
            nh,
            color,
            fontSize,
            fontFamily,
            cr
          );
          block.name = layout.item.text;
          block.x = layout.x;
          block.y = layout.y;
          frame.appendChild(block);
          if (layout.children.length > 0) {
            const parentCx = layout.x + nw / 2;
            const parentBottom = layout.y + nh;
            const midY = parentBottom + levelGap / 2;
            const childCxs = layout.children.map((c) => c.x + nw / 2);
            const minCx = Math.min(...childCxs);
            const maxCx = Math.max(...childCxs);
            const svgW = Math.max(maxCx - minCx + connWidth * 2, connWidth * 2);
            const svgH = levelGap;
            const offsetX = layout.children.length > 1 ? minCx : parentCx - connWidth;
            let paths = "";
            const sw = connWidth;
            const rgb = rgbString(connColor);
            const localPCx = parentCx - offsetX;
            paths += `<line x1="${localPCx}" y1="0" x2="${localPCx}" y2="${svgH / 2}" stroke="${rgb}" stroke-width="${sw}"/>`;
            if (layout.children.length > 1) {
              const localMin = minCx - offsetX;
              const localMax = maxCx - offsetX;
              paths += `<line x1="${localMin}" y1="${svgH / 2}" x2="${localMax}" y2="${svgH / 2}" stroke="${rgb}" stroke-width="${sw}"/>`;
            }
            for (const ccx of childCxs) {
              const localCcx = ccx - offsetX;
              paths += `<line x1="${localCcx}" y1="${svgH / 2}" x2="${localCcx}" y2="${svgH}" stroke="${rgb}" stroke-width="${sw}"/>`;
            }
            const connSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">${paths}</svg>`;
            const connNode = figma.createNodeFromSvg(connSvg);
            connNode.name = "Connector";
            connNode.x = offsetX;
            connNode.y = parentBottom;
            frame.appendChild(connNode);
            for (const child of layout.children) {
              yield renderNode(child, depth + 1);
            }
          }
        });
      }
      for (const layout of layouts) {
        yield renderNode(layout, 0);
      }
    });
  }
  function renderBasicVenn(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      const items = flattenItems(tree).slice(0, 3);
      if (items.length < 2) {
        throw new Error("Venn diagram requires at least 2 items.");
      }
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.titleFontSize || DEFAULTS.titleFontSize;
      frame.layoutMode = "NONE";
      frame.fills = [];
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.3;
      const overlap = radius * DEFAULTS.vennOverlapRatio;
      let positions;
      if (items.length === 2) {
        positions = [
          { x: cx - radius + overlap, y: cy },
          { x: cx + radius - overlap, y: cy }
        ];
      } else {
        const dist = radius - overlap;
        positions = [
          { x: cx, y: cy - dist * 0.7 },
          { x: cx - dist * 0.8, y: cy + dist * 0.5 },
          { x: cx + dist * 0.8, y: cy + dist * 0.5 }
        ];
      }
      for (let i = 0; i < items.length; i++) {
        const color = getColor2(palette, i);
        const pos = positions[i];
        const ellipse = figma.createEllipse();
        ellipse.resize(radius * 2, radius * 2);
        ellipse.x = pos.x - radius;
        ellipse.y = pos.y - radius;
        ellipse.fills = [
          { type: "SOLID", color: toRGB3(color), opacity: 0.55 }
        ];
        ellipse.name = items[i];
        frame.appendChild(ellipse);
        const tc = textColorFor(color);
        const label = yield makeTextNode(items[i], fontSize, fontFamily, DARK_TEXT, true);
        label.textAlignHorizontal = "CENTER";
        label.x = pos.x - 50;
        label.y = pos.y - fontSize / 2;
        label.resize(100, fontSize * 1.5);
        frame.appendChild(label);
      }
    });
  }
  function renderBasicCycle(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      var _a;
      const items = flattenItems(tree);
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.fontSize || DEFAULTS.fontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      const connColor = style.connectorColor || CONNECTOR_DEFAULT;
      frame.layoutMode = "NONE";
      frame.fills = [];
      const cx = width / 2;
      const cy = height / 2;
      const nodeSize = DEFAULTS.cycleNodeSize;
      const radius = Math.min(width, height) / 2 - nodeSize - 10;
      for (let i = 0; i < items.length; i++) {
        const angle = 2 * Math.PI * i / items.length - Math.PI / 2;
        const nx = cx + radius * Math.cos(angle) - nodeSize / 2;
        const ny = cy + radius * Math.sin(angle) - nodeSize / 2;
        const color = getColor2(palette, i);
        const block = yield createBlock(
          items[i],
          nodeSize,
          nodeSize,
          color,
          fontSize - 2,
          fontFamily,
          cr
        );
        block.name = items[i];
        block.x = nx;
        block.y = ny;
        frame.appendChild(block);
      }
      if (items.length >= 2) {
        const arrowRadius = radius * 0.72;
        let arrowPaths = "";
        const rgb = rgbString(connColor);
        for (let i = 0; i < items.length; i++) {
          const a1 = 2 * Math.PI * i / items.length - Math.PI / 2 + 0.3 / items.length * Math.PI;
          const a2 = 2 * Math.PI * ((i + 1) % items.length) / items.length - Math.PI / 2 - 0.3 / items.length * Math.PI;
          const x1 = cx + arrowRadius * Math.cos(a1);
          const y1 = cy + arrowRadius * Math.sin(a1);
          const x2 = cx + arrowRadius * Math.cos(a2);
          const y2 = cy + arrowRadius * Math.sin(a2);
          const midA = (a1 + a2) / 2;
          const ctrlR = arrowRadius * 1.15;
          const ctrlX = cx + ctrlR * Math.cos(midA);
          const ctrlY = cy + ctrlR * Math.sin(midA);
          arrowPaths += `<path d="M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}" fill="none" stroke="${rgb}" stroke-width="2"/>`;
          const headSize = 6;
          const endAngle = Math.atan2(y2 - ctrlY, x2 - ctrlX);
          const hx1 = x2 - headSize * Math.cos(endAngle - Math.PI / 6);
          const hy1 = y2 - headSize * Math.sin(endAngle - Math.PI / 6);
          const hx2 = x2 - headSize * Math.cos(endAngle + Math.PI / 6);
          const hy2 = y2 - headSize * Math.sin(endAngle + Math.PI / 6);
          arrowPaths += `<polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${rgb}"/>`;
        }
        const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${arrowPaths}</svg>`;
        const arrowNode = figma.createNodeFromSvg(arrowSvg);
        arrowNode.name = "Cycle Arrows";
        arrowNode.x = 0;
        arrowNode.y = 0;
        frame.insertChild(0, arrowNode);
      }
    });
  }
  function renderBasicMatrix(frame, tree, width, height, style) {
    return __async(this, null, function* () {
      var _a;
      const items = flattenItems(tree).slice(0, 4);
      while (items.length < 4) items.push("");
      const palette = getPalette(style);
      const fontFamily = style.fontFamily || "Inter";
      const fontSize = style.titleFontSize || DEFAULTS.titleFontSize;
      const cr = (_a = style.blockCornerRadius) != null ? _a : DEFAULTS.blockCornerRadius;
      const gap = 6;
      frame.layoutMode = "VERTICAL";
      frame.primaryAxisAlignItems = "CENTER";
      frame.counterAxisAlignItems = "CENTER";
      frame.itemSpacing = gap;
      frame.paddingLeft = DEFAULTS.blockPadding;
      frame.paddingRight = DEFAULTS.blockPadding;
      frame.paddingTop = DEFAULTS.blockPadding;
      frame.paddingBottom = DEFAULTS.blockPadding;
      frame.layoutSizingHorizontal = "FIXED";
      frame.layoutSizingVertical = "FIXED";
      const cellW = (width - DEFAULTS.blockPadding * 2 - gap) / 2;
      const cellH = (height - DEFAULTS.blockPadding * 2 - gap) / 2;
      for (let row = 0; row < 2; row++) {
        const rowFrame = figma.createFrame();
        rowFrame.name = `Row ${row + 1}`;
        rowFrame.layoutMode = "HORIZONTAL";
        rowFrame.itemSpacing = gap;
        rowFrame.fills = [];
        for (let col = 0; col < 2; col++) {
          const idx = row * 2 + col;
          const block = yield createBlock(
            items[idx],
            cellW,
            cellH,
            getColor2(palette, idx),
            fontSize,
            fontFamily,
            cr
          );
          block.name = `Cell ${idx + 1}`;
          rowFrame.appendChild(block);
          block.layoutSizingHorizontal = "FILL";
          block.layoutSizingVertical = "FILL";
        }
        frame.appendChild(rowFrame);
        rowFrame.layoutSizingHorizontal = "FILL";
        rowFrame.layoutSizingVertical = "FILL";
      }
    });
  }
  function renderSmartArt(frame, smartArtType, tree, width, height, style) {
    return __async(this, null, function* () {
      for (const child of [...frame.children]) {
        child.remove();
      }
      yield loadFonts2(style.fontFamily || "Inter");
      switch (smartArtType) {
        case "basic_block_list":
          yield renderBasicBlockList(frame, tree, width, height, style);
          break;
        case "vertical_block_list":
          yield renderVerticalBlockList(frame, tree, width, height, style);
          break;
        case "basic_process":
          yield renderBasicProcess(frame, tree, width, height, style);
          break;
        case "chevron_process":
          yield renderChevronProcess(frame, tree, width, height, style);
          break;
        case "org_chart":
          yield renderOrgChart(frame, tree, width, height, style);
          break;
        case "basic_venn":
          yield renderBasicVenn(frame, tree, width, height, style);
          break;
        case "basic_cycle":
          yield renderBasicCycle(frame, tree, width, height, style);
          break;
        case "basic_matrix":
          yield renderBasicMatrix(frame, tree, width, height, style);
          break;
        default:
          throw new Error(`Unknown SmartArt type: ${smartArtType}`);
      }
    });
  }
  function createSmartArt(params) {
    return __async(this, null, function* () {
      var _a;
      const {
        x = 0,
        y = 0,
        width = 800,
        height = 400,
        smartArtType,
        bulletText,
        style = {},
        parentId,
        name
      } = params;
      const tree = parseBulletText(bulletText);
      if (tree.totalCount === 0) {
        throw new Error("No items found in the provided bullet text.");
      }
      const parent = yield getParentNode4(parentId);
      const frame = figma.createFrame();
      frame.name = name || `SmartArt-${smartArtType}`;
      frame.x = x;
      frame.y = y;
      frame.resize(width, height);
      frame.clipsContent = true;
      frame.fills = style.backgroundColor ? [
        {
          type: "SOLID",
          color: toRGB3(style.backgroundColor),
          opacity: (_a = style.backgroundColor.a) != null ? _a : 1
        }
      ] : [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      const metadata = {
        smartArtType,
        bulletText,
        style,
        width,
        height
      };
      frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));
      yield renderSmartArt(frame, smartArtType, tree, width, height, style);
      parent.appendChild(frame);
      return {
        id: frame.id,
        name: frame.name,
        smartArtType,
        x,
        y,
        width,
        height,
        itemCount: tree.totalCount,
        maxDepth: tree.maxDepth
      };
    });
  }
  function updateSmartArt(params) {
    return __async(this, null, function* () {
      const { smartArtId, bulletText, style: customStyle } = params;
      const node = yield figma.getNodeByIdAsync(smartArtId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`SmartArt not found: ${smartArtId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(SMARTART_DATA_KEY);
      if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);
      const metadata = JSON.parse(raw);
      if (bulletText !== void 0) metadata.bulletText = bulletText;
      if (customStyle) metadata.style = __spreadValues(__spreadValues({}, metadata.style), customStyle);
      const tree = parseBulletText(metadata.bulletText);
      if (tree.totalCount === 0) {
        throw new Error("No items found in the provided bullet text.");
      }
      frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));
      yield renderSmartArt(
        frame,
        metadata.smartArtType,
        tree,
        metadata.width,
        metadata.height,
        metadata.style
      );
      return {
        id: smartArtId,
        name: frame.name,
        smartArtType: metadata.smartArtType,
        width: frame.width,
        height: frame.height,
        itemCount: tree.totalCount,
        updated: true
      };
    });
  }
  function changeSmartArtType(params) {
    return __async(this, null, function* () {
      const { smartArtId, newType } = params;
      const node = yield figma.getNodeByIdAsync(smartArtId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`SmartArt not found: ${smartArtId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(SMARTART_DATA_KEY);
      if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);
      const metadata = JSON.parse(raw);
      const oldType = metadata.smartArtType;
      metadata.smartArtType = newType;
      const tree = parseBulletText(metadata.bulletText);
      frame.setPluginData(SMARTART_DATA_KEY, JSON.stringify(metadata));
      yield renderSmartArt(
        frame,
        newType,
        tree,
        metadata.width,
        metadata.height,
        metadata.style
      );
      frame.name = frame.name.replace(oldType, newType);
      return {
        id: smartArtId,
        name: frame.name,
        oldType,
        newType,
        itemCount: tree.totalCount
      };
    });
  }
  function getSmartArtInfo(params) {
    return __async(this, null, function* () {
      const { smartArtId } = params;
      const node = yield figma.getNodeByIdAsync(smartArtId);
      if (!node || node.type !== "FRAME") {
        throw new Error(`SmartArt not found: ${smartArtId}`);
      }
      const frame = node;
      const raw = frame.getPluginData(SMARTART_DATA_KEY);
      if (!raw) throw new Error(`No SmartArt metadata found for: ${smartArtId}`);
      const metadata = JSON.parse(raw);
      const tree = parseBulletText(metadata.bulletText);
      return {
        id: smartArtId,
        name: frame.name,
        smartArtType: metadata.smartArtType,
        width: frame.width,
        height: frame.height,
        bulletText: metadata.bulletText,
        style: metadata.style,
        itemCount: tree.totalCount,
        maxDepth: tree.maxDepth,
        items: tree.items.map((item) => ({
          text: item.text,
          children: item.children.map((c) => c.text)
        }))
      };
    });
  }
  var SMARTART_DATA_KEY, PALETTES, DEFAULTS, WHITE, DARK_TEXT, CONNECTOR_DEFAULT;
  var init_smartArtHandlers = __esm({
    "src/handlers/smartArtHandlers.ts"() {
      "use strict";
      init_bridge();
      SMARTART_DATA_KEY = "smartart_metadata";
      PALETTES = {
        dark: [
          { r: 0.176, g: 0.224, b: 0.318, a: 1 },
          // #2D3951 dark navy
          { r: 0.204, g: 0.255, b: 0.353, a: 1 },
          // #34415A slightly lighter
          { r: 0.231, g: 0.286, b: 0.388, a: 1 },
          // #3B4963
          { r: 0.192, g: 0.243, b: 0.341, a: 1 },
          // #313E57
          { r: 0.216, g: 0.267, b: 0.365, a: 1 },
          // #37445D
          { r: 0.165, g: 0.212, b: 0.306, a: 1 },
          // #2A364E
          { r: 0.243, g: 0.298, b: 0.4, a: 1 },
          // #3E4C66
          { r: 0.196, g: 0.251, b: 0.349, a: 1 }
          // #324059
        ],
        colorful: [
          { r: 0.259, g: 0.522, b: 0.957, a: 1 },
          // #4285F4 blue
          { r: 0.918, g: 0.263, b: 0.208, a: 1 },
          // #EA4335 red
          { r: 0.984, g: 0.737, b: 0.016, a: 1 },
          // #FBBC04 yellow
          { r: 0.208, g: 0.659, b: 0.325, a: 1 },
          // #34A853 green
          { r: 1, g: 0.42, b: 0.176, a: 1 },
          // #FF6B2D orange
          { r: 0.541, g: 0.318, b: 0.831, a: 1 },
          // #8A51D4 purple
          { r: 0, g: 0.737, b: 0.831, a: 1 },
          // #00BCD4 cyan
          { r: 0.914, g: 0.118, b: 0.388, a: 1 }
          // #E91E63 pink
        ],
        monochrome: [
          { r: 0.2, g: 0.4, b: 0.7, a: 1 },
          { r: 0.35, g: 0.55, b: 0.8, a: 1 },
          { r: 0.5, g: 0.68, b: 0.88, a: 1 },
          { r: 0.65, g: 0.78, b: 0.92, a: 1 },
          { r: 0.78, g: 0.86, b: 0.95, a: 1 },
          { r: 0.88, g: 0.92, b: 0.97, a: 1 }
        ],
        accent1: [
          { r: 0.89, g: 0.26, b: 0.2, a: 1 },
          { r: 0.96, g: 0.4, b: 0.22, a: 1 },
          { r: 1, g: 0.6, b: 0.24, a: 1 },
          { r: 1, g: 0.76, b: 0.3, a: 1 },
          { r: 1, g: 0.88, b: 0.46, a: 1 }
        ],
        accent2: [
          { r: 0.12, g: 0.3, b: 0.52, a: 1 },
          { r: 0.16, g: 0.47, b: 0.7, a: 1 },
          { r: 0.2, g: 0.6, b: 0.8, a: 1 },
          { r: 0.3, g: 0.75, b: 0.78, a: 1 },
          { r: 0.46, g: 0.84, b: 0.74, a: 1 }
        ],
        accent3: [
          { r: 0.36, g: 0.2, b: 0.58, a: 1 },
          { r: 0.54, g: 0.32, b: 0.72, a: 1 },
          { r: 0.72, g: 0.44, b: 0.82, a: 1 },
          { r: 0.86, g: 0.56, b: 0.88, a: 1 },
          { r: 0.94, g: 0.72, b: 0.92, a: 1 }
        ]
      };
      DEFAULTS = {
        blockPadding: 16,
        blockCornerRadius: 8,
        itemSpacing: 16,
        arrowSize: 24,
        chevronPointDepth: 20,
        orgNodeWidth: 160,
        orgNodeHeight: 50,
        orgLevelGap: 60,
        orgSiblingGap: 24,
        vennOverlapRatio: 0.35,
        cycleNodeSize: 80,
        fontSize: 14,
        titleFontSize: 16,
        descFontSize: 12
      };
      WHITE = { r: 1, g: 1, b: 1, a: 1 };
      DARK_TEXT = { r: 0.15, g: 0.15, b: 0.15, a: 1 };
      CONNECTOR_DEFAULT = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
    }
  });

  // src/handlers/imageHandlers.ts
  function resolveParentId4(id) {
    return __async(this, null, function* () {
      return yield lookupNode(id);
    });
  }
  function getParentNode5(parentId) {
    return __async(this, null, function* () {
      if (parentId) {
        const node = yield resolveParentId4(parentId);
        if (node && (node.type === "FRAME" || node.type === "SLIDE" || node.type === "PAGE")) {
          return node;
        }
      }
      const focusedSlide = figma.currentPage.focusedSlide;
      return focusedSlide || figma.currentPage;
    });
  }
  function base64ToBytes(base64) {
    let len = base64.length;
    while (len > 0 && base64[len - 1] === "=") len--;
    const outputLen = len * 3 >> 2;
    const bytes = new Uint8Array(outputLen);
    let p = 0;
    for (let i = 0; i < len; ) {
      const c0 = B64_LOOKUP[base64.charCodeAt(i++)];
      const c1 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;
      const c2 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;
      const c3 = i < len ? B64_LOOKUP[base64.charCodeAt(i++)] : 0;
      bytes[p++] = c0 << 2 | c1 >> 4;
      if (p < outputLen) bytes[p++] = (c1 & 15) << 4 | c2 >> 2;
      if (p < outputLen) bytes[p++] = (c2 & 3) << 6 | c3;
    }
    return bytes;
  }
  function insertImage(params) {
    return __async(this, null, function* () {
      const {
        imageBase64,
        x = 0,
        y = 0,
        width,
        height,
        originalWidth,
        originalHeight,
        name = "Image",
        parentId,
        photographerName,
        photographerUsername
      } = params;
      const parent = yield getParentNode5(parentId);
      const bytes = base64ToBytes(imageBase64);
      const image = figma.createImage(bytes);
      let w = width || 400;
      let h = height || 300;
      if (originalWidth && originalHeight) {
        const aspectRatio = originalHeight / originalWidth;
        if (width && !height) {
          h = Math.round(w * aspectRatio);
        } else if (height && !width) {
          w = Math.round(h / aspectRatio);
        } else if (!width && !height) {
          w = Math.min(originalWidth, 800);
          h = Math.round(w * aspectRatio);
        }
      }
      const hasAttribution = photographerName && photographerUsername;
      if (hasAttribution) {
        const wrapper = figma.createFrame();
        wrapper.name = name;
        wrapper.x = x;
        wrapper.y = y;
        wrapper.layoutMode = "VERTICAL";
        wrapper.primaryAxisSizingMode = "AUTO";
        wrapper.counterAxisSizingMode = "AUTO";
        wrapper.itemSpacing = 4;
        wrapper.fills = [];
        const rect = figma.createRectangle();
        rect.name = "Photo";
        rect.resize(w, h);
        rect.fills = [
          {
            type: "IMAGE",
            imageHash: image.hash,
            scaleMode: "FILL"
          }
        ];
        wrapper.appendChild(rect);
        const profileUrl = `https://unsplash.com/@${photographerUsername}?utm_source=figma_slides_mcp&utm_medium=referral`;
        const unsplashUrl = `https://unsplash.com/?utm_source=figma_slides_mcp&utm_medium=referral`;
        const attributionStr = `Photo by ${photographerName} on Unsplash`;
        const attrText = figma.createText();
        yield figma.loadFontAsync({ family: "Inter", style: "Regular" });
        attrText.fontName = { family: "Inter", style: "Regular" };
        attrText.fontSize = 10;
        attrText.characters = attributionStr;
        attrText.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
        attrText.name = "Attribution";
        attrText.setPluginData("photographerUrl", profileUrl);
        attrText.setPluginData("unsplashUrl", unsplashUrl);
        const nameStart = "Photo by ".length;
        const nameEnd = nameStart + photographerName.length;
        attrText.setRangeTextDecoration(nameStart, nameEnd, "UNDERLINE");
        const unsplashStart = attributionStr.indexOf("Unsplash");
        const unsplashEnd = unsplashStart + "Unsplash".length;
        attrText.setRangeTextDecoration(unsplashStart, unsplashEnd, "UNDERLINE");
        wrapper.appendChild(attrText);
        parent.appendChild(wrapper);
        return {
          id: wrapper.id,
          name: wrapper.name,
          x,
          y,
          width: w,
          height: h,
          attribution: attributionStr,
          photographerUrl: profileUrl,
          unsplashUrl
        };
      } else {
        const rect = figma.createRectangle();
        rect.name = name;
        rect.x = x;
        rect.y = y;
        rect.resize(w, h);
        rect.fills = [
          {
            type: "IMAGE",
            imageHash: image.hash,
            scaleMode: "FILL"
          }
        ];
        parent.appendChild(rect);
        return {
          id: rect.id,
          name: rect.name,
          x,
          y,
          width: w,
          height: h
        };
      }
    });
  }
  var B64_CHARS, B64_LOOKUP;
  var init_imageHandlers = __esm({
    "src/handlers/imageHandlers.ts"() {
      "use strict";
      init_bridge();
      B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      B64_LOOKUP = new Uint8Array(128);
      for (let i = 0; i < B64_CHARS.length; i++) {
        B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
      }
    }
  });

  // src/code.ts
  var require_code = __commonJS({
    "src/code.ts"(exports) {
      init_slideHandlers();
      init_contentHandlers();
      init_chartHandlers();
      init_dataChartHandlers();
      init_tableHandlers();
      init_importExportHandlers();
      init_smartArtHandlers();
      init_imageHandlers();
      init_bridge();
      function handleCommand(command, params) {
        return __async(this, null, function* () {
          switch (command) {
            // Slide Management
            case "create_slide":
              return yield createSlide(params);
            case "delete_slide":
              return yield deleteSlide(params);
            case "clone_slide":
              return yield cloneSlide(params);
            case "focus_slide":
              return yield focusSlide(params);
            case "get_focused_slide":
              return yield getFocusedSlide();
            case "get_slide_grid":
              return yield getSlideGrid();
            case "get_all_slides":
              return yield getAllSlides();
            case "reorder_slides":
              return yield reorderSlides(params);
            case "set_slide_transition":
              return yield setSlideTransition(params);
            case "skip_slide":
              return yield skipSlide(params);
            case "get_slide_properties":
              return yield getSlideProperties(params);
            case "get_slide_speaker_notes":
              return yield getSlideSpeakerNotes(params);
            case "set_slide_speaker_notes":
              return yield setSlideSpeakerNotes(params);
            // Content Creation
            case "create_rectangle":
              return yield createRectangle(params);
            case "create_frame":
              return yield createFrame(params);
            case "create_text":
              return yield createText(params);
            case "create_ellipse":
              return yield createEllipse(params);
            case "create_graphic":
              return yield createGraphic(params);
            case "create_marker":
              return yield createMarker(params);
            case "create_polygon":
              return yield createPolygon(params);
            case "create_star":
              return yield createStar(params);
            case "create_line":
              return yield createLine(params);
            case "create_mask":
              return yield createMask(params);
            // Content Operations
            case "move_node":
              return yield moveNode(params);
            case "resize_node":
              return yield resizeNode(params);
            case "delete_node":
              return yield deleteNode(params);
            case "clone_node":
              return yield cloneNode(params);
            case "group_nodes":
              return yield groupNodes(params);
            case "reparent_node":
              return yield reparentNode(params);
            case "ungroup_nodes":
              return yield ungroupNodes(params);
            case "reorder_node":
              return yield reorderNode(params);
            case "boolean_nodes":
              return yield booleanNodes(params);
            // Styling
            case "set_fill_color":
              return yield setFillColor(params);
            case "set_fill_gradient":
              return yield setFillGradient(params);
            case "set_stroke":
              return yield setStroke(params);
            case "set_opacity":
              return yield setOpacity(params);
            case "set_corner_radius":
              return yield setCornerRadius(params);
            case "set_drop_shadow":
              return yield setDropShadow(params);
            case "set_inner_shadow":
              return yield setInnerShadow(params);
            case "set_blend_mode":
              return yield setBlendMode(params);
            case "copy_style":
              return yield copyStyle(params);
            // Text
            case "set_text_content":
              return yield setTextContent(params);
            case "set_text_properties":
              return yield setTextProperties(params);
            case "get_text_node_info":
              return yield getTextNodeInfo(params);
            case "set_text_decoration":
              return yield setTextDecoration(params);
            case "set_text_font":
              return yield setTextFont(params);
            case "set_text_range_style":
              return yield setTextRangeStyle(params);
            // Text Styles
            case "get_local_text_styles":
              return yield getLocalTextStyles();
            case "set_text_style":
              return yield setTextStyle(params);
            case "get_text_style":
              return yield getTextStyle(params);
            // Inspection
            case "get_page_info":
              return yield getPageInfo();
            case "get_page_structure":
              return yield getPageStructure();
            case "get_node_info":
              return yield getNodeInfo(params);
            case "get_node_info_by_types":
              return yield getNodeInfoByTypes(params);
            case "get_selection_info":
              return yield getSelectionInfo();
            case "get_result_image":
              return yield getResultImage(params);
            case "get_styles":
              return yield getStyles();
            // Rename
            case "rename_node":
              return yield renameNode(params);
            case "rename_layers":
              return yield renameLayers(params);
            // Layout
            case "set_layout_mode":
              return yield setLayoutMode(params);
            case "set_padding":
              return yield setPadding(params);
            case "set_axis_align":
              return yield setAxisAlign(params);
            case "set_layout_sizing":
              return yield setLayoutSizing(params);
            case "set_item_spacing":
              return yield setItemSpacing(params);
            case "set_child_layout_props":
              return yield setChildLayoutProps(params);
            case "set_constraints":
              return yield setConstraints(params);
            // Export
            case "export_slide_image":
              return yield exportSlideImage(params);
            // Transform
            case "rotate_node":
              return yield rotateNode(params);
            // Color
            case "replace_color":
              return yield replaceColor(params);
            // Charts
            case "create_bar_chart":
              return yield createBarChart(params);
            case "create_line_chart":
              return yield createLineChart(params);
            case "create_pie_chart":
              return yield createPieChart(params);
            case "create_donut_chart":
              return yield createDonutChart(params);
            case "update_chart_data":
              return yield updateChartData(params);
            case "get_chart_data":
              return yield getChartData(params);
            case "change_chart_type":
              return yield changeChartType(params);
            // Data Charts (tabular data → rich charts)
            case "create_data_chart":
              return yield createDataChart(params);
            case "update_data_chart":
              return yield updateDataChart(params);
            case "change_data_chart_type":
              return yield changeDataChartType(params);
            case "get_data_chart_info":
              return yield getDataChartInfo(params);
            // Tables (text/CSV/TSV/Markdown → Figma table)
            case "create_table":
              return yield createTable(params);
            case "create_table_from_data":
              return yield createTableFromData(params);
            case "update_table":
              return yield updateTable(params);
            case "get_table_info":
              return yield getTableInfo(params);
            // SmartArt
            case "create_smartart":
              return yield createSmartArt(params);
            case "update_smartart":
              return yield updateSmartArt(params);
            case "change_smartart_type":
              return yield changeSmartArtType(params);
            case "get_smartart_info":
              return yield getSmartArtInfo(params);
            // Image
            case "insert_image":
              return yield insertImage(params);
            // Import / Export
            case "export_json":
              return yield exportJson();
            case "import_json":
              return yield importJson(params);
            case "clear_canvas": {
              let collectAllSlides2 = function(node) {
                if (node.type === "SLIDE") return [node];
                const slides = [];
                if ("children" in node) {
                  for (const child of node.children) {
                    slides.push(...collectAllSlides2(child));
                  }
                }
                return slides;
              };
              var collectAllSlides = collectAllSlides2;
              const page = figma.currentPage;
              let removed = 0;
              const allSlides = collectAllSlides2(page);
              for (const slide of allSlides) {
                try {
                  slide.remove();
                  removed++;
                } catch (e) {
                }
              }
              for (const child of Array.from(page.children)) {
                try {
                  child.remove();
                  removed++;
                } catch (e) {
                }
              }
              nodeIdMap.clear();
              return { success: true, removed, message: `Removed ${removed} node(s)` };
            }
            // Batch execution
            case "batch_execute": {
              const results = [];
              for (const op of params.operations) {
                try {
                  const result = yield handleCommand(op.command, op.params);
                  results.push({ command: op.command, success: true, result });
                } catch (error) {
                  results.push({
                    command: op.command,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }
              return {
                results,
                total: params.operations.length,
                succeeded: results.filter((r) => r.success).length
              };
            }
            default:
              throw new Error(`Unknown command: ${command}`);
          }
        });
      }
      figma.showUI(__html__, { width: 350, height: 500 });
      figma.ui.onmessage = (msg) => __async(null, null, function* () {
        switch (msg.type) {
          case "execute-command":
            try {
              const result = yield handleCommand(msg.command, msg.params);
              figma.ui.postMessage({
                type: "command-result",
                id: msg.id,
                result
              });
            } catch (error) {
              figma.ui.postMessage({
                type: "command-error",
                id: msg.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
            break;
          case "notify":
            figma.notify(msg.message);
            break;
          case "close-plugin":
            figma.closePlugin();
            break;
        }
      });
    }
  });
  require_code();
})();
