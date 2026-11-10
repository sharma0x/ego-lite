// Read-only view over the node list returned by Accessibility.getFullAXTree.

const SKIPPED_ROLES = new Set(["InlineTextBox", "ListMarker", "LineBreak"]);
const TRANSPARENT_ROLES = new Set(["none", "presentation", "Ignored"]);

// Ego Lite prints its own role names for structural nodes; keep every other
// Chromium role as-is so locators resolve against the same AX tree.
const ROLE_ALIASES = {
  RootWebArea: "root",
  StaticText: "text",
  generic: "container",
  group: "container",
  Section: "container",
  img: "image",
  Iframe: "iframe",
  IframePresentational: "iframe",
  Canvas: "canvas",
  "graphics-document": "svg_root",
};

export class AxTree {
  #nodesById = new Map();
  #root;

  constructor(nodes) {
    for (const node of nodes) this.#nodesById.set(node.nodeId, node);
    this.#root = nodes.find((node) => !node.parentId) ?? nodes[0];
  }

  get root() {
    return this.#root;
  }

  /** Children with ignored/presentational wrappers flattened away. */
  children(node) {
    const result = [];
    for (const childId of node.childIds ?? []) {
      const child = this.#nodesById.get(childId);
      if (!child || isSkipped(child)) continue;
      if (isTransparent(child)) result.push(...this.children(child));
      else result.push(child);
    }
    return result;
  }

  findByBackendNodeId(backendNodeId) {
    for (const node of this.#nodesById.values()) {
      if (node.backendDOMNodeId === backendNodeId && !isTransparent(node))
        return node;
    }
    return undefined;
  }

  *nodes() {
    yield* this.#nodesById.values();
  }
}

export function chromiumRole(node) {
  return String(node.role?.value ?? "");
}

export function egoRole(node) {
  const role = chromiumRole(node);
  return ROLE_ALIASES[role] ?? role.toLowerCase();
}

export function nodeName(node) {
  return String(node.name?.value ?? "").trim();
}

export function nodeProperty(node, name) {
  return node.properties?.find((property) => property.name === name)?.value
    ?.value;
}

function isSkipped(node) {
  return SKIPPED_ROLES.has(chromiumRole(node));
}

function isTransparent(node) {
  return Boolean(node.ignored) || TRANSPARENT_ROLES.has(chromiumRole(node));
}
