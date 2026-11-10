import {
  AxTree,
  chromiumRole,
  egoRole,
  nodeName,
  nodeProperty,
} from "./ax-tree.mjs";

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "listbox",
  "treeitem",
  "iframe",
]);
const VALUE_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "slider",
  "spinbutton",
]);
const NEVER_REFERENCED = new Set(["root", "text"]);

export class SnapshotRootNotFoundError extends Error {}

/**
 * Render an AX tree in Ego Lite's native snapshot format: a `root` line, then
 * two-space indented `role "name" [ref=<backendNodeId>, loc=...]` lines. The
 * harness compacts unnamed containers itself (compactSnapshotContent).
 *
 * @param {object[]} axNodes   Accessibility.getFullAXTree nodes
 * @param {object}   options   native ego.snapshot() options
 * @param {(backendNodeId: number) => boolean | undefined} isVisible
 * @returns {{ content: string, refs: object[] }}
 */
export function renderAxSnapshot(
  axNodes,
  options = {},
  isVisible = () => true,
) {
  const tree = new AxTree(axNodes);
  const start =
    options.scope === "subtree"
      ? tree.findByBackendNodeId(options.root)
      : tree.root;
  if (!start)
    throw new SnapshotRootNotFoundError(
      `Snapshot root not found: ${options.root}`,
    );
  const writer = new SnapshotWriter(
    tree,
    options,
    viewportPredicate(options, isVisible),
  );
  writer.write(start, 0, "");
  return writer.result(options.maxResultLength);
}

function viewportPredicate(options, isVisible) {
  return options.scope === "only_within_viewport" ? isVisible : () => true;
}

class SnapshotWriter {
  #tree;
  #options;
  #isVisible;
  #locators;
  #keep = new Map();
  #lines = [];

  constructor(tree, options, isVisible) {
    this.#tree = tree;
    this.#options = options;
    this.#isVisible = isVisible;
    this.#locators = options.includeStableLocator
      ? uniqueLocators(tree)
      : new Map();
  }

  write(node, depth, parentName) {
    if (!this.#isKept(node)) return;
    const role = egoRole(node);
    if (role === "text") return this.#writeText(node, depth, parentName);
    const ref = this.#refFor(node, role);
    const listed = !this.#options.interactiveOnly || ref;
    if (listed)
      this.#push(depth, describe(node, role, ref, this.#options), ref);
    const childDepth =
      listed && !this.#options.interactiveOnly ? depth + 1 : depth;
    for (const child of this.#tree.children(node))
      this.write(child, childDepth, nodeName(node));
  }

  result(maxResultLength) {
    const kept = truncateLines(this.#lines, maxResultLength);
    const visibleRefIds = new Set(
      kept.map((line) => line.ref?.refId).filter(Boolean),
    );
    return {
      content: kept.map((line) => line.text).join("\n"),
      refs: this.#lines
        .map((line) => line.ref)
        .filter((ref) => ref && visibleRefIds.has(ref.refId)),
    };
  }

  #writeText(node, depth, parentName) {
    const text = nodeName(node);
    if (!text || this.#options.interactiveOnly || text === parentName) return;
    this.#push(depth, `text ${JSON.stringify(text)}`);
  }

  #refFor(node, role) {
    if (NEVER_REFERENCED.has(role) || node.backendDOMNodeId === undefined)
      return undefined;
    if (
      !INTERACTIVE_ROLES.has(role) &&
      nodeProperty(node, "focusable") !== true
    )
      return undefined;
    const ref = {
      refId: node.backendDOMNodeId,
      backendNodeId: node.backendDOMNodeId,
      role,
    };
    const name = nodeName(node);
    if (name) ref.name = name;
    const loc = this.#locators.get(node.nodeId);
    if (loc) ref.loc = loc;
    return ref;
  }

  #push(depth, text, ref) {
    this.#lines.push({ text: `${"  ".repeat(depth)}${text}`, ref });
  }

  /** A node is kept when it, or any descendant, is visible (memoized). */
  #isKept(node) {
    if (this.#keep.has(node.nodeId)) return this.#keep.get(node.nodeId);
    const own =
      node.backendDOMNodeId === undefined
        ? undefined
        : this.#isVisible(node.backendDOMNodeId);
    const kept =
      node === this.#tree.root ||
      own === true ||
      this.#tree.children(node).some((child) => this.#isKept(child));
    this.#keep.set(node.nodeId, kept);
    return kept;
  }
}

function describe(node, role, ref, options) {
  if (role === "root") return "root";
  const parts = [role];
  const name = nodeName(node);
  if (name) parts.push(JSON.stringify(name));
  parts.push(...stateTokens(node, role));
  if (ref && options.includeActionMarks !== false) {
    parts.push(`[ref=${ref.refId}${ref.loc ? `, loc=${ref.loc}` : ""}]`);
  }
  return parts.join(" ");
}

function stateTokens(node, role) {
  const tokens = [];
  const value = node.value?.value;
  if (VALUE_ROLES.has(role) && value !== undefined && value !== "")
    tokens.push(`value=${JSON.stringify(String(value))}`);
  const checked = nodeProperty(node, "checked");
  if (checked === "true" || checked === true) tokens.push("checked");
  if (checked === "mixed") tokens.push("checked=mixed");
  if (nodeProperty(node, "disabled") === true) tokens.push("disabled");
  const expanded = nodeProperty(node, "expanded");
  if (expanded !== undefined) tokens.push(expanded ? "expanded" : "collapsed");
  const url = role === "link" ? nodeProperty(node, "url") : undefined;
  if (url) tokens.push(`url=${url}`);
  return tokens;
}

/** `role:<role>[name="..."]` for interactive nodes whose role+name is unique. */
function uniqueLocators(tree) {
  const groups = new Map();
  for (const node of tree.nodes()) {
    const role = chromiumRole(node).toLowerCase();
    const name = nodeName(node);
    if (
      node.ignored ||
      !name ||
      !INTERACTIVE_ROLES.has(egoRole(node)) ||
      role === "iframe"
    )
      continue;
    const key = `${role}\u0000${name}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const locators = new Map();
  for (const [key, nodes] of groups) {
    if (nodes.length !== 1) continue;
    const [role, name] = key.split("\u0000");
    locators.set(nodes[0].nodeId, `role:${role}[name=${JSON.stringify(name)}]`);
  }
  return locators;
}

function truncateLines(lines, maxResultLength) {
  if (!(maxResultLength > 0)) return lines;
  const kept = [];
  let length = 0;
  for (const line of lines) {
    length += line.text.length + (kept.length ? 1 : 0);
    if (length > maxResultLength && kept.length) break;
    kept.push(line);
  }
  return kept;
}
