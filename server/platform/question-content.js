import sanitizeHtml from "sanitize-html";

const allowedTags = [
  "blockquote", "br", "caption", "cite", "col", "colgroup", "div", "em", "figure", "i", "img",
  "itembody", "li", "ol", "p", "span", "strong", "sub", "sup", "table", "tbody", "td", "th",
  "thead", "tr", "u", "ul",
  "math", "menclose", "mfenced", "mfrac", "mi", "mn", "mo", "mover", "mroot", "mrow", "msqrt",
  "mstyle", "msub", "msup", "mtext",
  "svg", "circle", "clippath", "defs", "g", "line", "marker", "path", "pattern", "polygon",
  "polyline", "rect", "text", "use"
];

const svgAttributes = [
  "clip-path", "cx", "cy", "d", "dominant-baseline", "dx", "dy", "fill", "font-family", "font-size",
  "height", "id", "isolation", "marker-end", "marker-start", "markerHeight", "markerUnits", "markerWidth",
  "opacity", "orient", "patternTransform", "patternUnits", "points", "r", "refX", "refY", "stroke",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-width", "text-anchor",
  "transform", "values", "version", "viewBox", "width", "x", "x1", "x2", "xlink:href", "xmlns",
  "xmlns:xlink", "y", "y1", "y2"
];

const options = {
  allowedTags,
  allowedAttributes: {
    "*": ["class", "lang", "role", "aria-hidden", "aria-label", "aria-level", "data-ae_invis", "style"],
    img: ["alt", "height", "src", "width"],
    table: ["align", "border"],
    col: ["width"],
    td: ["align", "colspan", "rowspan"],
    th: ["align", "colspan", "rowspan", "scope"],
    math: ["alttext", "display", "displaystyle", "xmlns"],
    mfenced: ["close", "open"],
    mo: ["fence", "stretchy"],
    mstyle: ["displaystyle", "mathvariant"],
    menclose: ["notation"],
    svg: svgAttributes,
    circle: svgAttributes,
    clippath: svgAttributes,
    defs: svgAttributes,
    g: svgAttributes,
    line: svgAttributes,
    marker: svgAttributes,
    path: svgAttributes,
    pattern: svgAttributes,
    polygon: svgAttributes,
    polyline: svgAttributes,
    rect: svgAttributes,
    text: svgAttributes,
    use: svgAttributes
  },
  allowedStyles: {
    "*": {
      "clip-path": [/^url\(#[A-Za-z][A-Za-z0-9_.:-]*\)$/],
      "dominant-baseline": [/^(?:auto|central|middle|text-after-edge|text-before-edge)$/],
      "fill": [/^(?:none|white|currentColor|#[0-9a-fA-F]{3,8}|url\(#[A-Za-z][A-Za-z0-9_.:-]*\))$/],
      "font-family": [/^[A-Za-z][A-Za-z0-9 ,_-]{0,80}$/],
      "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/],
      "font-style": [/^(?:normal|italic)$/],
      "padding-left": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
      "stroke": [/^(?:none|currentColor|#[0-9a-fA-F]{3,8})$/],
      "stroke-linecap": [/^(?:butt|round|square)$/],
      "stroke-linejoin": [/^(?:bevel|miter|round)$/],
      "stroke-width": [/^\d+(?:\.\d+)?(?:px|pt)?$/],
      "text-align": [/^(?:left|right|center|justify)$/],
      "text-anchor": [/^(?:end|middle|start)$/],
      "text-decoration": [/^(?:none|underline|line-through)$/]
    }
  },
  allowedSchemes: ["https", "data"],
  allowedSchemesByTag: { img: ["https", "data"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  parser: { lowerCaseAttributeNames: false, lowerCaseTags: true }
};

export function sanitizeQuestionHtml(value) {
  return sanitizeHtml(String(value || ""), options);
}

function sanitizeAnswerOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 10)
      .map(([key, html]) => [String(key).slice(0, 8), sanitizeQuestionHtml(html)])
  );
}

export function sanitizeQuestionContent(content) {
  const source = content && typeof content === "object" ? content : {};
  return {
    ...source,
    answerOptions: sanitizeAnswerOptions(source.answerOptions),
    rationale: sanitizeQuestionHtml(source.rationale),
    stem: sanitizeQuestionHtml(source.stem),
    stimulus: sanitizeQuestionHtml(source.stimulus)
  };
}
