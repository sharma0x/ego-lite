#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { runDoctor } from "../src/cli/doctor.mjs";
import {
  assertHarnessBuilt,
  readUsageGuide,
  runHarnessScript,
} from "../src/cli/harness.mjs";
import { BROWSER } from "../src/cli/browser.mjs";
import { runLaunch } from "../src/cli/launch.mjs";
import { openSession } from "../src/cli/session.mjs";

const C = BROWSER.command.padEnd(9);
// Continuation lines line up under the descriptions.
const CONTINUE = " ".repeat(`  ${C} launch [--restart]  `.length);
const USAGE = `Usage:
  ${C} nodejs <<'EOF'      run a browser script (same API as ego-browser nodejs)
  ${C} nodejs <file.mjs>   run a script file (any shell, including PowerShell)
  ${C} nodejs -e '<code>'
  ${C} skill               print the usage guide
  ${C} doctor              check ${BROWSER.app}, the extension and the harness build
  ${C} launch [--restart]  start ${BROWSER.app} with remote debugging on port ${BROWSER.port};
${CONTINUE}--restart quits one running without it first${
  BROWSER.customUserDataDir
    ? `\n${CONTINUE}(this agent browser: restarts it to load an update)`
    : ""
}
`;

const [command, ...rest] = process.argv.slice(2);
process.exitCode = await dispatch(command, rest);
// Open WebSockets and harness timers would keep the process alive; the
// harness flushes buffered output synchronously on exit.
process.exit();

async function dispatch(name, args) {
  if (name === "nodejs") return runScript(args);
  if (name === "skill") return printGuide();
  if (name === "doctor") return runDoctor();
  if (name === "launch")
    return runLaunch({ restart: args.includes("--restart") });
  process.stderr.write(USAGE);
  return name === "-h" || name === "--help" ? 0 : 2;
}

async function runScript(args) {
  const code = await scriptSource(args);
  if (!code.trim()) {
    process.stderr.write(USAGE);
    return 2;
  }
  let session;
  try {
    assertHarnessBuilt();
    session = await openSession();
    globalThis.ego = session.bindings;
    return await runHarnessScript(code, {
      browserProcessId: session.browserProcessId,
    });
  } catch (error) {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    return 1;
  } finally {
    session?.close();
  }
}

function printGuide() {
  assertHarnessBuilt();
  process.stdout.write(readUsageGuide());
  return 0;
}

/** -e '<code>', a script file path, or stdin. */
async function scriptSource(args) {
  if (args[0] === "-e") return args[1] ?? "";
  if (args[0] && !args[0].startsWith("-")) return readFileSync(args[0], "utf8");
  return readStdin();
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
