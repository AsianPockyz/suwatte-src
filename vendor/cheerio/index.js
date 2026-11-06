"use strict";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_TEXT_TAGS = new Set(["script", "style"]);

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "\u00a9",
  reg: "\u00ae",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  hearts: "\u2665",
  times: "\u00d7",
};

function decodeEntities(str) {
  if (!str || typeof str !== "string" || str.indexOf("&") === -1) {
    return str || "";
  }
  return str.replace(/&(#(?:x[0-9a-fA-F]+|\d+)|[a-zA-Z0-9]+);/g, (full, entity) => {
    if (entity.charCodeAt(0) === 35) {
      const isHex = entity.charCodeAt(1) === 120 || entity.charCodeAt(1) === 88;
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isNaN(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return full;
    }
    const lower = entity.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)
      ? NAMED_ENTITIES[lower]
      : full;
  });
}

function parseAttributes(attrString) {
  const attribs = {};
  if (!attrString || !attrString.trim()) {
    return attribs;
  }
  const attrRegex =
    /([a-zA-Z0-9_:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1].toLowerCase();
    const rawVal =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
          ? match[3]
          : match[4] !== undefined
            ? match[4]
            : "";
    attribs[key] = decodeEntities(rawVal);
  }
  return attribs;
}

function parseHTML(html) {
  const root = {
    type: "root",
    name: "root",
    attribs: {},
    children: [],
    parent: null,
  };

  if (typeof html !== "string" || html.length === 0) {
    return root;
  }

  const stack = [root];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    const currentParent = stack[stack.length - 1];

    // If inside <script> or <style>, consume until matching closing tag
    if (currentParent.type === "tag" && RAW_TEXT_TAGS.has(currentParent.name)) {
      const closePattern = new RegExp(`</${currentParent.name}\\s*>`, "ig");
      closePattern.lastIndex = pos;
      const closeMatch = closePattern.exec(html);
      if (closeMatch) {
        const rawText = html.slice(pos, closeMatch.index);
        if (rawText.length > 0) {
          currentParent.children.push({
            type: "text",
            name: "#text",
            data: rawText,
            attribs: {},
            children: [],
            parent: currentParent,
          });
        }
        stack.pop();
        pos = closeMatch.index + closeMatch[0].length;
        continue;
      } else {
        const rawText = html.slice(pos);
        if (rawText.length > 0) {
          currentParent.children.push({
            type: "text",
            name: "#text",
            data: rawText,
            attribs: {},
            children: [],
            parent: currentParent,
          });
        }
        break;
      }
    }

    const ltIdx = html.indexOf("<", pos);
    if (ltIdx === -1) {
      const text = decodeEntities(html.slice(pos));
      if (text.length > 0) {
        currentParent.children.push({
          type: "text",
          name: "#text",
          data: text,
          attribs: {},
          children: [],
          parent: currentParent,
        });
      }
      break;
    }

    if (ltIdx > pos) {
      const text = decodeEntities(html.slice(pos, ltIdx));
      if (text.length > 0) {
        currentParent.children.push({
          type: "text",
          name: "#text",
          data: text,
          attribs: {},
          children: [],
          parent: currentParent,
        });
      }
    }

    // Check for HTML comment <!-- ... -->
    if (html.startsWith("<!--", ltIdx)) {
      const endComment = html.indexOf("-->", ltIdx + 4);
      pos = endComment === -1 ? len : endComment + 3;
      continue;
    }

    // Check for <!DOCTYPE ...> or <![CDATA[...]]>
    if (html.startsWith("<!", ltIdx) || html.startsWith("<?", ltIdx)) {
      const gtIdx = html.indexOf(">", ltIdx + 2);
      pos = gtIdx === -1 ? len : gtIdx + 1;
      continue;
    }

    // Find closing '>' respecting quotes
    let gtIdx = ltIdx + 1;
    let quoteChar = null;
    while (gtIdx < len) {
      const ch = html[gtIdx];
      if (quoteChar) {
        if (ch === quoteChar) {
          quoteChar = null;
        }
      } else if (ch === '"' || ch === "'") {
        quoteChar = ch;
      } else if (ch === ">") {
        break;
      }
      gtIdx++;
    }

    if (gtIdx >= len) {
      break;
    }

    const tagContent = html.slice(ltIdx + 1, gtIdx).trim();
    pos = gtIdx + 1;

    if (!tagContent) {
      continue;
    }

    // Closing tag: </tag>
    if (tagContent.charCodeAt(0) === 47) {
      const closeName = tagContent
        .slice(1)
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].name === closeName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const selfClosing = tagContent.charCodeAt(tagContent.length - 1) === 47;
    const cleanContent = selfClosing
      ? tagContent.slice(0, -1).trim()
      : tagContent;

    const spaceMatch = /^([a-zA-Z0-9_:-]+)([\s\S]*)$/.exec(cleanContent);
    if (!spaceMatch) {
      continue;
    }

    const tagName = spaceMatch[1].toLowerCase();
    const attrPart = spaceMatch[2] || "";

    // Implicitly close previous <li ...> or <p ...> when a sibling of the same tag opens
    if (
      (tagName === "li" || tagName === "p" || tagName === "option") &&
      currentParent.type === "tag" &&
      currentParent.name === tagName &&
      stack.length > 1
    ) {
      stack.pop();
    }

    const parentNode = stack[stack.length - 1];
    const element = {
      type: "tag",
      name: tagName,
      attribs: parseAttributes(attrPart),
      children: [],
      parent: parentNode,
    };

    parentNode.children.push(element);

    if (!selfClosing && !VOID_TAGS.has(tagName)) {
      stack.push(element);
    }
  }

  return root;
}

function getElementText(node) {
  if (!node) return "";
  if (node.type === "text") {
    return node.data || "";
  }
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return "";
  }
  let out = "";
  for (let i = 0; i < node.children.length; i++) {
    out += getElementText(node.children[i]);
  }
  return out;
}

function serializeNode(node) {
  if (!node) return "";
  if (node.type === "text") {
    return node.data || "";
  }
  if (node.type === "root") {
    return (node.children || []).map(serializeNode).join("");
  }
  const attrs = Object.entries(node.attribs || {})
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
    .join(" ");
  const open = attrs ? `<${node.name} ${attrs}>` : `<${node.name}>`;
  if (VOID_TAGS.has(node.name)) {
    return open;
  }
  const inner = (node.children || []).map(serializeNode).join("");
  return `${open}${inner}</${node.name}>`;
}

function serializeInnerHTML(node) {
  if (!node || !Array.isArray(node.children)) return "";
  return node.children.map(serializeNode).join("");
}

function cloneNode(node, parent = null) {
  if (!node) return null;
  const copy = {
    type: node.type,
    name: node.name,
    attribs: { ...(node.attribs || {}) },
    children: [],
    parent,
  };
  if (node.data !== undefined) {
    copy.data = node.data;
  }
  if (Array.isArray(node.children)) {
    copy.children = node.children.map((ch) => cloneNode(ch, copy));
  }
  return copy;
}

function splitTopLevel(selector, delimiter) {
  const parts = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0 && ch === delimiter) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function tokenizeCombinators(selector) {
  const tokens = [];
  let current = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = null;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }
    if (bracketDepth === 0 && parenDepth === 0) {
      if (ch === ">") {
        if (current.trim()) {
          tokens.push({ type: "compound", value: current.trim() });
          current = "";
        }
        tokens.push({ type: "combinator", value: ">" });
        continue;
      }
      if (/\s/.test(ch)) {
        if (current.trim()) {
          tokens.push({ type: "compound", value: current.trim() });
          current = "";
          // Peek ahead to see if next non-space is '>'
          let j = i + 1;
          while (j < selector.length && /\s/.test(selector[j])) j++;
          if (j < selector.length && selector[j] !== ">") {
            tokens.push({ type: "combinator", value: " " });
          }
          i = j - 1;
        }
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    tokens.push({ type: "compound", value: current.trim() });
  }
  return tokens;
}

function matchesCompound(node, compound) {
  if (!node || node.type !== "tag") {
    return false;
  }
  if (compound === "*") {
    return true;
  }

  let rem = compound;

  // Extract attribute selectors [...]
  const attrChecks = [];
  rem = rem.replace(/\[([^\]]+)\]/g, (_, inner) => {
    attrChecks.push(inner.trim());
    return "";
  });

  // Extract pseudo selectors :contains(...), :not(...), :first-child, :last-child, :nth-child(...)
  const pseudoChecks = [];
  rem = rem.replace(/:([a-zA-Z-]+)(?:\(([^)]*)\))?/g, (_, name, arg) => {
    pseudoChecks.push({ name: name.toLowerCase(), arg: arg !== undefined ? arg.trim() : null });
    return "";
  });

  // Extract ID #id
  let requiredId = null;
  rem = rem.replace(/#([a-zA-Z0-9_-]+)/g, (_, id) => {
    requiredId = id;
    return "";
  });

  // Extract classes .class
  const requiredClasses = [];
  rem = rem.replace(/\.([a-zA-Z0-9_-]+)/g, (_, cls) => {
    requiredClasses.push(cls);
    return "";
  });

  const tagName = rem.trim().toLowerCase();
  if (tagName && tagName !== "*" && node.name !== tagName) {
    return false;
  }

  if (requiredId !== null && (node.attribs?.id || "") !== requiredId) {
    return false;
  }

  if (requiredClasses.length > 0) {
    const classAttr = node.attribs?.class || "";
    if (!classAttr) return false;
    const nodeClasses = classAttr.trim().split(/\s+/);
    for (let i = 0; i < requiredClasses.length; i++) {
      if (!nodeClasses.includes(requiredClasses[i])) {
        return false;
      }
    }
  }

  for (let i = 0; i < attrChecks.length; i++) {
    const expr = attrChecks[i];
    const m = /^([a-zA-Z0-9_:@.-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"']*)))?$/.exec(
      expr
    );
    if (!m) return false;
    const attrName = m[1].toLowerCase();
    const op = m[2];
    const expected =
      m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || "";
    const hasAttr =
      node.attribs && Object.prototype.hasOwnProperty.call(node.attribs, attrName);
    if (!op) {
      if (!hasAttr) return false;
      continue;
    }
    const actual = hasAttr ? String(node.attribs[attrName]) : "";
    if (!hasAttr) return false;
    if (op === "=" && actual !== expected) return false;
    if (op === "*=" && !actual.includes(expected)) return false;
    if (op === "^=" && !actual.startsWith(expected)) return false;
    if (op === "$=" && !actual.endsWith(expected)) return false;
    if (op === "~=" && !actual.trim().split(/\s+/).includes(expected)) return false;
    if (op === "|=" && actual !== expected && !actual.startsWith(`${expected}-`))
      return false;
  }

  for (let i = 0; i < pseudoChecks.length; i++) {
    const { name, arg } = pseudoChecks[i];
    if (name === "contains") {
      const needle = (arg || "").replace(/^["']|["']$/g, "");
      if (!getElementText(node).includes(needle)) {
        return false;
      }
    } else if (name === "not" && arg) {
      if (matchesSelector(node, arg)) {
        return false;
      }
    } else if (name === "first-child" || name === "first") {
      const siblings = (node.parent?.children || []).filter((c) => c.type === "tag");
      if (siblings[0] !== node) return false;
    } else if (name === "last-child" || name === "last") {
      const siblings = (node.parent?.children || []).filter((c) => c.type === "tag");
      if (siblings[siblings.length - 1] !== node) return false;
    } else if (name === "nth-child" && arg) {
      const siblings = (node.parent?.children || []).filter((c) => c.type === "tag");
      const idx = siblings.indexOf(node) + 1;
      const n = parseInt(arg, 10);
      if (!Number.isNaN(n) && idx !== n) return false;
    }
  }

  return true;
}

function matchesTokenSequence(node, tokens, tokenIndex) {
  if (tokenIndex < 0) return true;
  const token = tokens[tokenIndex];
  if (!token || token.type !== "compound") return false;
  if (!matchesCompound(node, token.value)) return false;
  if (tokenIndex === 0) return true;

  const combinator = tokens[tokenIndex - 1];
  if (!combinator || combinator.type !== "combinator") return false;

  if (combinator.value === ">") {
    return (
      node.parent !== null &&
      node.parent.type === "tag" &&
      matchesTokenSequence(node.parent, tokens, tokenIndex - 2)
    );
  }

  // Descendant combinator " "
  let curr = node.parent;
  while (curr && curr.type === "tag") {
    if (matchesTokenSequence(curr, tokens, tokenIndex - 2)) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

function matchesSelector(node, selector) {
  if (!node || node.type !== "tag" || !selector) return false;
  const groups = splitTopLevel(selector, ",");
  for (let i = 0; i < groups.length; i++) {
    const tokens = tokenizeCombinators(groups[i]);
    if (tokens.length > 0 && matchesTokenSequence(node, tokens, tokens.length - 1)) {
      return true;
    }
  }
  return false;
}

function collectDescendants(rootNode, out) {
  if (!rootNode || !Array.isArray(rootNode.children)) return;
  for (let i = 0; i < rootNode.children.length; i++) {
    const child = rootNode.children[i];
    if (child.type === "tag") {
      out.push(child);
      collectDescendants(child, out);
    }
  }
}

function querySelectorAll(roots, selector) {
  if (!selector || typeof selector !== "string") return [];
  const results = [];
  const seen = new Set();
  const candidates = [];

  for (let i = 0; i < roots.length; i++) {
    collectDescendants(roots[i], candidates);
  }

  const groups = splitTopLevel(selector, ",");
  const groupTokens = groups.map(tokenizeCombinators).filter((t) => t.length > 0);

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (seen.has(el)) continue;
    for (let g = 0; g < groupTokens.length; g++) {
      const tokens = groupTokens[g];
      if (matchesTokenSequence(el, tokens, tokens.length - 1)) {
        seen.add(el);
        results.push(el);
        break;
      }
    }
  }
  return results;
}

class CheerioCollection {
  constructor(elements = [], root = null) {
    this._root = root;
    const list = Array.isArray(elements) ? elements : [elements];
    this.length = list.length;
    for (let i = 0; i < list.length; i++) {
      this[i] = list[i];
    }
  }

  [Symbol.iterator]() {
    let index = 0;
    const len = this.length;
    return {
      next: () => {
        if (index < len) {
          return { value: this[index++], done: false };
        }
        return { value: undefined, done: true };
      },
    };
  }

  toArray() {
    const arr = [];
    for (let i = 0; i < this.length; i++) {
      arr.push(this[i]);
    }
    return arr;
  }

  get(index) {
    if (index === undefined) {
      return this.toArray();
    }
    const idx = index < 0 ? this.length + index : index;
    return this[idx];
  }

  eq(index) {
    const el = this.get(index);
    return new CheerioCollection(el ? [el] : [], this._root);
  }

  first() {
    return this.eq(0);
  }

  last() {
    return this.eq(this.length - 1);
  }

  find(selector) {
    return new CheerioCollection(
      querySelectorAll(this.toArray(), selector),
      this._root
    );
  }

  filter(predicate) {
    const matched = [];
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      if (typeof predicate === "string") {
        if (matchesSelector(el, predicate)) {
          matched.push(el);
        }
      } else if (typeof predicate === "function") {
        if (predicate.call(el, i, el)) {
          matched.push(el);
        }
      }
    }
    return new CheerioCollection(matched, this._root);
  }

  not(predicate) {
    const matched = [];
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      if (typeof predicate === "string") {
        if (!matchesSelector(el, predicate)) {
          matched.push(el);
        }
      } else if (typeof predicate === "function") {
        if (!predicate.call(el, i, el)) {
          matched.push(el);
        }
      }
    }
    return new CheerioCollection(matched, this._root);
  }

  children(selector) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.length; i++) {
      const children = this[i]?.children || [];
      for (let j = 0; j < children.length; j++) {
        const ch = children[j];
        if (ch.type === "tag" && !seen.has(ch)) {
          if (!selector || matchesSelector(ch, selector)) {
            seen.add(ch);
            out.push(ch);
          }
        }
      }
    }
    return new CheerioCollection(out, this._root);
  }

  parent(selector) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.length; i++) {
      const p = this[i]?.parent;
      if (p && p.type === "tag" && !seen.has(p)) {
        if (!selector || matchesSelector(p, selector)) {
          seen.add(p);
          out.push(p);
        }
      }
    }
    return new CheerioCollection(out, this._root);
  }

  parents(selector) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.length; i++) {
      let p = this[i]?.parent;
      while (p && p.type === "tag") {
        if (!seen.has(p) && (!selector || matchesSelector(p, selector))) {
          seen.add(p);
          out.push(p);
        }
        p = p.parent;
      }
    }
    return new CheerioCollection(out, this._root);
  }

  closest(selector) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.length; i++) {
      let curr = this[i];
      while (curr && curr.type === "tag") {
        if (matchesSelector(curr, selector)) {
          if (!seen.has(curr)) {
            seen.add(curr);
            out.push(curr);
          }
          break;
        }
        curr = curr.parent;
      }
    }
    return new CheerioCollection(out, this._root);
  }

  next(selector) {
    const out = [];
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      const siblings = (el?.parent?.children || []).filter((c) => c.type === "tag");
      const idx = siblings.indexOf(el);
      if (idx !== -1 && idx + 1 < siblings.length) {
        const nxt = siblings[idx + 1];
        if (!selector || matchesSelector(nxt, selector)) {
          out.push(nxt);
        }
      }
    }
    return new CheerioCollection(out, this._root);
  }

  prev(selector) {
    const out = [];
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      const siblings = (el?.parent?.children || []).filter((c) => c.type === "tag");
      const idx = siblings.indexOf(el);
      if (idx > 0) {
        const prv = siblings[idx - 1];
        if (!selector || matchesSelector(prv, selector)) {
          out.push(prv);
        }
      }
    }
    return new CheerioCollection(out, this._root);
  }

  siblings(selector) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      const siblings = (el?.parent?.children || []).filter((c) => c.type === "tag");
      for (let j = 0; j < siblings.length; j++) {
        const s = siblings[j];
        if (s !== el && !seen.has(s) && (!selector || matchesSelector(s, selector))) {
          seen.add(s);
          out.push(s);
        }
      }
    }
    return new CheerioCollection(out, this._root);
  }

  each(callback) {
    for (let i = 0; i < this.length; i++) {
      if (callback.call(this[i], i, this[i]) === false) {
        break;
      }
    }
    return this;
  }

  map(callback) {
    const mapped = [];
    for (let i = 0; i < this.length; i++) {
      const res = callback.call(this[i], i, this[i]);
      if (res !== null && res !== undefined) {
        mapped.push(res);
      }
    }
    return new CheerioCollection(mapped, this._root);
  }

  text() {
    let out = "";
    for (let i = 0; i < this.length; i++) {
      out += getElementText(this[i]);
    }
    return out;
  }

  html() {
    if (this.length === 0) return null;
    return serializeInnerHTML(this[0]);
  }

  attr(name, value) {
    if (!name) return undefined;
    const key = String(name).toLowerCase();
    if (value !== undefined) {
      for (let i = 0; i < this.length; i++) {
        if (this[i] && this[i].attribs) {
          this[i].attribs[key] = String(value);
        }
      }
      return this;
    }
    const first = this[0];
    if (!first || !first.attribs) return undefined;
    return Object.prototype.hasOwnProperty.call(first.attribs, key)
      ? first.attribs[key]
      : undefined;
  }

  data(name) {
    if (!name) return undefined;
    const dashed = String(name)
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase();
    return this.attr(`data-${dashed}`) ?? this.attr(String(name));
  }

  val() {
    if (this.length === 0) return undefined;
    const first = this[0];
    if (!first) return undefined;
    if (first.name === "textarea") {
      return getElementText(first);
    }
    return this.attr("value");
  }

  hasClass(className) {
    if (!className) return false;
    for (let i = 0; i < this.length; i++) {
      const cls = this[i]?.attribs?.class;
      if (cls && cls.trim().split(/\s+/).includes(className)) {
        return true;
      }
    }
    return false;
  }

  is(selector) {
    if (!selector) return false;
    for (let i = 0; i < this.length; i++) {
      if (matchesSelector(this[i], selector)) {
        return true;
      }
    }
    return false;
  }

  clone() {
    const cloned = [];
    for (let i = 0; i < this.length; i++) {
      cloned.push(cloneNode(this[i], null));
    }
    return new CheerioCollection(cloned, this._root);
  }

  remove() {
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      if (el && el.parent && Array.isArray(el.parent.children)) {
        const idx = el.parent.children.indexOf(el);
        if (idx !== -1) {
          el.parent.children.splice(idx, 1);
        }
        el.parent = null;
      }
    }
    return this;
  }
}

function load(html) {
  const root = parseHTML(typeof html === "string" ? html : String(html ?? ""));

  function $(selector, context) {
    if (!selector) {
      return new CheerioCollection([], root);
    }
    if (selector instanceof CheerioCollection) {
      return selector;
    }
    if (typeof selector === "object" && selector !== null) {
      if (Array.isArray(selector)) {
        return new CheerioCollection(selector, root);
      }
      return new CheerioCollection([selector], root);
    }
    if (typeof selector === "string") {
      const trimmed = selector.trim();
      if (trimmed.charCodeAt(0) === 60 && trimmed.charCodeAt(trimmed.length - 1) === 62) {
        const frag = parseHTML(trimmed);
        return new CheerioCollection(frag.children, root);
      }
      let searchRoots = [root];
      if (context) {
        if (typeof context === "string") {
          searchRoots = querySelectorAll([root], context);
        } else if (context instanceof CheerioCollection) {
          searchRoots = context.toArray();
        } else if (typeof context === "object") {
          searchRoots = [context];
        }
      }
      return new CheerioCollection(
        querySelectorAll(searchRoots, trimmed),
        root
      );
    }
    return new CheerioCollection([], root);
  }

  $.load = load;
  $.root = () => new CheerioCollection([root], root);
  $.html = (el) => {
    if (!el) return serializeNode(root);
    if (el instanceof CheerioCollection) {
      return el.toArray().map(serializeNode).join("");
    }
    return serializeNode(el);
  };
  $.text = (els) => {
    if (!els) return getElementText(root);
    if (els instanceof CheerioCollection) return els.text();
    if (Array.isArray(els)) return els.map(getElementText).join("");
    return getElementText(els);
  };

  return $;
}

module.exports = {
  load,
  default: { load },
};
