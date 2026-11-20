#!/usr/bin/env node
// ego-brave driving Microsoft Edge: same commands and API, on Edge's own agent
// profile (Edge refuses remote debugging on the everyday profile).
process.env.EGO_BRAVE_BROWSER = "edge";
await import("./ego-brave.mjs");
