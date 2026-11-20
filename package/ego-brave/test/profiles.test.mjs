import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ProfileCatalog } from "../src/profiles/profile-catalog.mjs";
import { ProfileRouter } from "../src/profiles/profile-router.mjs";

function catalogFromLocalState(profile, options = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), "ego-brave-profiles-"));
  writeFileSync(join(userDataDir, "Local State"), JSON.stringify({ profile }));
  return ProfileCatalog.load({ userDataDir, ...options });
}

const LOCAL_STATE = {
  last_used: "Profile 8",
  info_cache: {
    Default: { name: "Prince Sharma" },
    "Profile 7": { name: "Prince - Clow" },
    "Profile 8": { name: "Shayga" },
    "Guest Profile": { name: "Guest" },
  },
};

test("reads profiles from Local State, prefers Default, and skips unsupported directories", () => {
  const catalog = catalogFromLocalState(LOCAL_STATE, {
    preferredId: undefined,
  });
  assert.deepEqual(catalog.list(), [
    { id: "Default", name: "Prince Sharma", isDefault: true },
    { id: "Profile 7", name: "Prince - Clow", isDefault: false },
    { id: "Profile 8", name: "Shayga", isDefault: false },
  ]);
});

test("EGO_BRAVE_PROFILE-style preference overrides the default", () => {
  const catalog = catalogFromLocalState(LOCAL_STATE, {
    preferredId: "Profile 8",
  });
  assert.equal(catalog.resolve(undefined).id, "Profile 8");
  assert.equal(catalog.resolve("default").id, "Profile 8");
  assert.equal(catalog.resolve("Profile 7").name, "Prince - Clow");
  assert.equal(catalog.resolve("Profile 99"), undefined);
});

test("Space ids encode their profile: Default 1..99999, Profile N from N*100000", () => {
  const catalog = catalogFromLocalState(LOCAL_STATE, {
    preferredId: undefined,
  });
  assert.equal(catalog.idBaseOf("Default"), 0);
  assert.equal(catalog.idBaseOf("Profile 7"), 700000);
  assert.equal(catalog.profileIdForSpace(6), "Default");
  assert.equal(catalog.profileIdForSpace(700001), "Profile 7");
});

function routerWith(bridges) {
  const catalog = new ProfileCatalog(
    [
      { id: "Default", name: "Prince Sharma" },
      { id: "Profile 7", name: "Prince - Clow" },
    ],
    "Default",
  );
  const opened = [];
  const directory = {
    forProfile: async (profileId) => bridges.get(profileId),
    all: async () => bridges,
    onEvent() {},
  };
  const opener = {
    async open(profileId) {
      opened.push(profileId);
      return {
        rpc: bridges.get(profileId),
        cleanup: async () => opened.push(`cleanup ${profileId}`),
      };
    },
  };
  return { router: new ProfileRouter({ catalog, directory, opener }), opened };
}

function fakeBridge(label, spaces = []) {
  const calls = [];
  return {
    calls,
    async call(operation, args) {
      calls.push([operation, args]);
      if (operation === "listSpaces") return { taskSpaces: spaces };
      return `${label}:${operation}`;
    },
  };
}

test("lists Spaces from every set-up profile", async () => {
  const personal = fakeBridge("Default", [{ id: 6, name: "gmail check" }]);
  const work = fakeBridge("Profile 7", [{ id: 700001, name: "jira" }]);
  const { router } = routerWith(
    new Map([
      ["Default", personal],
      ["Profile 7", work],
    ]),
  );
  assert.deepEqual(
    (await router.call("listSpaces")).taskSpaces.map((space) => space.id),
    [6, 700001],
  );
});

test("routes Space calls by id block and creates Spaces in the requested profile", async () => {
  const personal = fakeBridge("Default");
  const work = fakeBridge("Profile 7");
  const { router, opened } = routerWith(
    new Map([
      ["Default", personal],
      ["Profile 7", work],
    ]),
  );
  assert.equal(
    await router.call("listTabs", { spaceId: 700001 }),
    "Profile 7:listTabs",
  );
  assert.equal(
    await router.call("listTabs", { spaceId: 6 }),
    "Default:listTabs",
  );
  assert.equal(
    await router.call("createSpace", { name: "jira", profileId: "Profile 7" }),
    "Profile 7:createSpace",
  );
  assert.deepEqual(work.calls.at(-1), ["createSpace", { name: "jira" }]);
  assert.deepEqual(opened, ["Profile 7", "cleanup Profile 7"]);
});

test("a Space in a profile that is not open is not found", async () => {
  const { router } = routerWith(new Map([["Default", fakeBridge("Default")]]));
  assert.deepEqual(await router.call("listTabs", { spaceId: 800001 }), {
    error: "Task space not found: 800001",
    error_code: "EGO_TASK_SPACE_NOT_FOUND",
  });
});

test("a new user data dir lists its profile folders before Local State names them", () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "ego-brave-profiles-"));
  writeFileSync(
    join(userDataDir, "Local State"),
    JSON.stringify({ profile: { info_cache: {}, last_used: "Default" } }),
  );
  mkdirSync(join(userDataDir, "Default"));
  writeFileSync(
    join(userDataDir, "Default", "Preferences"),
    JSON.stringify({ profile: { name: "Profile 1" } }),
  );
  mkdirSync(join(userDataDir, "System Profile"));
  const catalog = ProfileCatalog.load({ userDataDir, preferredId: undefined });
  assert.deepEqual(catalog.list(), [
    { id: "Default", name: "Profile 1", isDefault: true },
  ]);
});

test("right after the first launch the last used profile is known by its folder name", () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "ego-brave-profiles-"));
  writeFileSync(
    join(userDataDir, "Local State"),
    JSON.stringify({ profile: { info_cache: {}, last_used: "Default" } }),
  );
  assert.deepEqual(
    ProfileCatalog.load({ userDataDir, preferredId: undefined }).list(),
    [{ id: "Default", name: "Default", isDefault: true }],
  );
});

test("passes Space options other than the profile through to the extension", async () => {
  const work = fakeBridge("Profile 7");
  const { router } = routerWith(new Map([["Profile 7", work]]));
  await router.call("createSpace", {
    name: "agent",
    profileId: "Profile 7",
    dedicatedBrowser: true,
  });
  assert.deepEqual(work.calls.at(-1), [
    "createSpace",
    { name: "agent", dedicatedBrowser: true },
  ]);
});
