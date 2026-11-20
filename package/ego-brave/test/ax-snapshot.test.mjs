import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SnapshotRootNotFoundError,
  renderAxSnapshot,
} from "../src/snapshot/ax-snapshot.mjs";

const role = (value) => ({ type: "role", value });
const name = (value) => ({ type: "computedString", value });
const focusable = [
  { name: "focusable", value: { type: "booleanOrUndefined", value: true } },
];

// RootWebArea > generic > [button "Save", button "Save", link "Docs" > StaticText "Docs", StaticText "Hello"]
//            > ignored none > textbox "Email" (value) ; InlineTextBox under StaticText is skipped
function fixture() {
  return [
    {
      nodeId: "1",
      role: role("RootWebArea"),
      name: name("Page title"),
      childIds: ["2", "8"],
      backendDOMNodeId: 1,
    },
    {
      nodeId: "2",
      parentId: "1",
      role: role("generic"),
      childIds: ["3", "4", "5", "7"],
      backendDOMNodeId: 2,
    },
    {
      nodeId: "3",
      parentId: "2",
      role: role("button"),
      name: name("Save"),
      childIds: [],
      backendDOMNodeId: 30,
      properties: focusable,
    },
    {
      nodeId: "4",
      parentId: "2",
      role: role("button"),
      name: name("Save"),
      childIds: [],
      backendDOMNodeId: 40,
      properties: focusable,
    },
    {
      nodeId: "5",
      parentId: "2",
      role: role("link"),
      name: name("Docs"),
      childIds: ["6"],
      backendDOMNodeId: 50,
      properties: [
        { name: "url", value: { value: "https://example.test/docs" } },
      ],
    },
    {
      nodeId: "6",
      parentId: "5",
      role: role("StaticText"),
      name: name("Docs"),
      childIds: ["6a"],
      backendDOMNodeId: 51,
    },
    {
      nodeId: "6a",
      parentId: "6",
      role: role("InlineTextBox"),
      name: name("Docs"),
      childIds: [],
    },
    {
      nodeId: "7",
      parentId: "2",
      role: role("StaticText"),
      name: name('Hello "world"'),
      childIds: [],
      backendDOMNodeId: 70,
    },
    {
      nodeId: "8",
      parentId: "1",
      ignored: true,
      role: role("none"),
      childIds: ["9"],
      backendDOMNodeId: 8,
    },
    {
      nodeId: "9",
      parentId: "8",
      role: role("textbox"),
      name: name("Email"),
      value: { value: "a@b.c" },
      childIds: [],
      backendDOMNodeId: 90,
    },
  ];
}

test("renders the native format: root line, two-space indent, refs and quoted names", () => {
  const { content } = renderAxSnapshot(fixture(), {
    includeStableLocator: true,
  });
  assert.equal(
    content,
    [
      "root",
      "  container",
      '    button "Save" [ref=30]',
      '    button "Save" [ref=40]',
      '    link "Docs" url=https://example.test/docs [ref=50, loc=role:link[name="Docs"]]',
      '    text "Hello \\"world\\""',
      '  textbox "Email" value="a@b.c" [ref=90, loc=role:textbox[name="Email"]]',
    ].join("\n"),
  );
});

test("omits locators for duplicated role+name pairs and keeps ref ids equal to backend node ids", () => {
  const { refs } = renderAxSnapshot(fixture(), { includeStableLocator: true });
  const saves = refs.filter((ref) => ref.name === "Save");
  assert.deepEqual(
    saves.map((ref) => [ref.refId, ref.backendNodeId, ref.loc]),
    [
      [30, 30, undefined],
      [40, 40, undefined],
    ],
  );
});

test("interactiveOnly lists only referenced nodes, flat", () => {
  const { content } = renderAxSnapshot(fixture(), { interactiveOnly: true });
  assert.equal(
    content,
    [
      'button "Save" [ref=30]',
      'button "Save" [ref=40]',
      'link "Docs" url=https://example.test/docs [ref=50]',
      'textbox "Email" value="a@b.c" [ref=90]',
    ].join("\n"),
  );
});

test("includeActionMarks false drops ref markers but keeps refs", () => {
  const result = renderAxSnapshot(fixture(), { includeActionMarks: false });
  assert.doesNotMatch(result.content, /\[ref=/);
  assert.equal(result.refs.length, 4);
});

test("viewport scope keeps visible nodes and their ancestors only", () => {
  const visible = new Set([30, 2]);
  const { content, refs } = renderAxSnapshot(
    fixture(),
    { scope: "only_within_viewport" },
    (id) => visible.has(id),
  );
  assert.equal(
    content,
    ["root", "  container", '    button "Save" [ref=30]'].join("\n"),
  );
  assert.deepEqual(
    refs.map((ref) => ref.refId),
    [30],
  );
});

test("subtree scope starts at the requested backend node", () => {
  const { content } = renderAxSnapshot(fixture(), {
    scope: "subtree",
    root: 50,
  });
  assert.equal(content, 'link "Docs" url=https://example.test/docs [ref=50]');
  assert.throws(
    () => renderAxSnapshot(fixture(), { scope: "subtree", root: 999 }),
    SnapshotRootNotFoundError,
  );
});

test("maxResultLength truncates at a line boundary and drops refs that were cut", () => {
  // "root" + "\n  container" + "\n    button \"Save\" [ref=30]" is 43 characters.
  const { content, refs } = renderAxSnapshot(fixture(), {
    maxResultLength: 45,
  });
  assert.equal(
    content,
    ["root", "  container", '    button "Save" [ref=30]'].join("\n"),
  );
  assert.deepEqual(
    refs.map((ref) => ref.refId),
    [30],
  );
});
