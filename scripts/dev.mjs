#!/usr/bin/env node
/**
 * ResumeIQ dev launcher (Node.js, no external dependencies).
 * Starts backend (uv run uvicorn on 127.0.0.1:8000) and frontend (npm run dev on localhost:3000)
 * with prefixed output, writes logs to .dev-logs/, waits for both /health and frontend root,
 * prints the localhost URLs, and on any failure prints the last 15 log lines and exits non-zero.
 * Shuts down both servers cleanly on Ctrl+C.
 *
 * Modes:
 *   --check-only      Print what would start and exit
 *   --backend-only    Start only the backend (used by PowerShell wrapper)
 *   --frontend-only   Start only the frontend (used by PowerShell wrapper)
 *   (default)         Start both backend and frontend in this process
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

const REPO_ROOT = resolve(process.cwd());
const BACKEND_DIR = join(REPO_ROOT, "backend");
const FRONTEND_DIR = join(REPO_ROOT, "frontend");
const LOGS_DIR = join(REPO_ROOT, ".dev-logs");

const BACKEND_LOG = join(LOGS_DIR, "backend.log");
const FRONTEND_LOG = join(LOGS_DIR, "frontend.log");

const CHECK_ONLY = process.argv.includes("--check-only");
const BACKEND_ONLY = process.argv.includes("--backend-only");
const FRONTEND_ONLY = process.argv.includes("--frontend-only");

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

// Helper to write to log file
function appendLog(file, data) {
  writeFileSync(file, readFileSync(file, "utf-8") + data, "utf-8");
}

// Helper to read last N lines from a file
function getLastLines(file, n = 15) {
  try {
    const content = readFileSync(file, "utf-8");
    const lines = content.trim().split("\n");
    return lines.slice(-n).join("\n");
  } catch {
    return "(no log content)";
  }
}

// Helper to check if lock file is newer than installed state
function isLockNewer(lockPath, installPath) {
  try {
    if (!existsSync(lockPath) || !existsSync(installPath)) {
      return true; // If lock exists but install doesn't, need to install
    }
    return statSync(lockPath).mtimeMs > statSync(installPath).mtimeMs;
  } catch {
    return true;
  }
}

// Helper to run a command and wait for it
function runCommand(cmd, args, cwd, description) {
  return new Promise((resolve, reject) => {
    console.log(`[dev] ${description}...`);
    const child = spawn(cmd, args, { cwd, shell: true, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${description} failed with code ${code}`));
    });
    child.on("error", (err) => reject(err));
  });
}

async function syncDependencies() {
  // Backend: uv sync --frozen if pyproject.toml or uv.lock newer than .venv
  const backendLock = join(BACKEND_DIR, "uv.lock");
  const backendVenv = join(BACKEND_DIR, ".venv");
  if (existsSync(backendLock) && isLockNewer(backendLock, backendVenv)) {
    await runCommand("uv", ["sync", "--frozen"], BACKEND_DIR, "Installing backend dependencies (uv sync --frozen)");
  }

  // Frontend: npm ci if package-lock.json newer than node_modules
  const frontendLock = join(FRONTEND_DIR, "package-lock.json");
  const frontendModules = join(FRONTEND_DIR, "node_modules");
  if (existsSync(frontendLock) && isLockNewer(frontendLock, frontendModules)) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    await runCommand(npmCmd, ["ci"], FRONTEND_DIR, "Installing frontend dependencies (npm ci)");
  }
}

// Check if port is in use
async function checkPort(port) {
  return new Promise((resolve) => {
    import("net").then((net) => {
      const server = net.createServer();
      server.once("error", () => resolve(true)); // Port in use
      server.once("listening", () => {
        server.close();
        resolve(false); // Port free
      });
      server.listen(port, "127.0.0.1");
    });
  });
}

// Wait for HTTP endpoint to respond with success
async function waitForHealth(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.status === "ok") {
          return true;
        }
      }
    } catch {
      // Ignore and retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function waitForFrontend(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore and retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function startBackend() {
  const backendProc = spawn("uv", ["run", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--log-level", "info"], {
    cwd: BACKEND_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  // Clear log
  writeFileSync(BACKEND_LOG, "", "utf-8");

  backendProc.stdout?.on("data", (data) => {
    const text = data.toString();
    const prefixed = text.split("\n").filter(Boolean).map((line) => `[backend] ${line}`).join("\n") + "\n";
    process.stdout.write(prefixed);
    appendLog(BACKEND_LOG, prefixed);
  });
  backendProc.stderr?.on("data", (data) => {
    const text = data.toString();
    const prefixed = text.split("\n").filter(Boolean).map((line) => `[backend] ${line}`).join("\n") + "\n";
    process.stderr.write(prefixed);
    appendLog(BACKEND_LOG, prefixed);
  });

  return backendProc;
}

async function startFrontend() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const frontendProc = spawn(npmCmd, ["run", "dev", "--", "--hostname", "localhost", "--port", "3000"], {
    cwd: FRONTEND_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development" },
    shell: true,
  });

  // Clear log
  writeFileSync(FRONTEND_LOG, "", "utf-8");

  frontendProc.stdout?.on("data", (data) => {
    const text = data.toString();
    const prefixed = text.split("\n").filter(Boolean).map((line) => `[frontend] ${line}`).join("\n") + "\n";
    process.stdout.write(prefixed);
    appendLog(FRONTEND_LOG, prefixed);
  });
  frontendProc.stderr?.on("data", (data) => {
    const text = data.toString();
    const prefixed = text.split("\n").filter(Boolean).map((line) => `[frontend] ${line}`).join("\n") + "\n";
    process.stderr.write(prefixed);
    appendLog(FRONTEND_LOG, prefixed);
  });

  return frontendProc;
}

async function main() {
  console.log("ResumeIQ dev launcher");
  console.log(`Repository: ${REPO_ROOT}`);
  console.log("");

  // Port checks
  const portsToCheck = [];
  if (!FRONTEND_ONLY) portsToCheck.push(8000);
  if (!BACKEND_ONLY) portsToCheck.push(3000);
  for (const port of portsToCheck) {
    if (await checkPort(port)) {
      console.error(`Port ${port} is already in use. Stop that process before starting the stack.`);
      process.exit(1);
    }
  }
  console.log("Ports 8000 and 3000 are free.");
  console.log("");

  if (CHECK_ONLY) {
    console.log("Check-only mode: would start backend and frontend.");
    console.log("  backend:  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info");
    console.log("  frontend: npm run dev -- --hostname localhost --port 3000");
    console.log("Check-only: no servers started.");
    process.exit(0);
  }

  // Sync dependencies
  await syncDependencies();

  let backendProc = null;
  let frontendProc = null;
  let exitCode = 0;
  let shutdownInitiated = false;

  // Start backend if needed
  if (!FRONTEND_ONLY) {
    backendProc = await startBackend();
  }

  // Start frontend if needed
  if (!BACKEND_ONLY) {
    frontendProc = await startFrontend();
  }

  // Shutdown handler
  function shutdown() {
    if (shutdownInitiated) return;
    shutdownInitiated = true;
    console.log("\n[dev] Shutting down servers...");

    // On Windows, use taskkill /T /F to kill the entire process tree
    // On POSIX, use process groups with negative PID
    const killTree = (pid) => {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        try {
          process.kill(-pid, "SIGKILL"); // Negative PID kills the process group
        } catch {
          // Process group might not exist
        }
      }
    };

    if (backendProc?.pid) killTree(backendProc.pid);
    if (frontendProc?.pid) killTree(frontendProc.pid);

    // Exit after a short delay to allow cleanup
    setTimeout(() => process.exit(exitCode || 1), 1000);
  }

  // Handle Ctrl+C
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Wait for backend health if backend is running
  if (backendProc) {
    console.log("Waiting for http://127.0.0.1:8000/health ...");
    const backendHealthy = await waitForHealth("http://127.0.0.1:8000/health");
    if (!backendHealthy) {
      console.error("\nBackend did not report healthy within 60 seconds.");
      console.error("Last 15 lines of backend log:");
      console.error(getLastLines(BACKEND_LOG, 15));
      shutdown();
      return;
    }
    console.log("Backend is healthy (status=ok).");
  }

  // Wait for frontend if frontend is running
  if (frontendProc) {
    console.log("Waiting for http://localhost:3000 ...");
    const frontendReady = await waitForFrontend("http://localhost:3000");
    if (!frontendReady) {
      console.error("\nFrontend did not respond within 60 seconds.");
      console.error("Last 15 lines of frontend log:");
      console.error(getLastLines(FRONTEND_LOG, 15));
      shutdown();
      return;
    }
    console.log("Frontend is responding.");
  }

  // If running both, print URLs
  if (!BACKEND_ONLY && !FRONTEND_ONLY) {
    console.log("");
    console.log("Open:");
    console.log("  App:    http://localhost:3000");
    console.log("  API:    http://localhost:8000/docs");
    console.log("  Health: http://localhost:8000/health");
    console.log("");
    console.log("Both servers are bound to localhost/127.0.0.1. Press Ctrl+C to stop them.");
  }

  // Wait for processes to exit
  const waitPromises = [];
  if (backendProc) waitPromises.push(new Promise((r) => backendProc.on("close", r)));
  if (frontendProc) waitPromises.push(new Promise((r) => frontendProc.on("close", r)));

  await Promise.all(waitPromises);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});