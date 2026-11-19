#!/usr/bin/env node
// ego-brave driving Opera: same commands and API, Opera's app, port and data dir.
process.env.EGO_BRAVE_BROWSER = "opera";
await import("./ego-brave.mjs");
