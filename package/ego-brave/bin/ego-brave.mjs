#!/usr/bin/env node
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
const USAGE = `Usage:
  ${C} nodejs <<'EOF'      run a browser script (same API as ego-browser nodejs)
  ${C} nodejs -e '<code>'
  ${C} skill               print the usage guide
  ${C} doctor              check ${BROWSER.app}, the extension and the harness build
  ${C} launch [--restart]  start ${BROWSER.app} with remote debugging the macOS way;
                           --restart quits one running without it first
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
  const code = args[0] === "-e" ? (args[1] ?? "") : await readStdin();
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

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
