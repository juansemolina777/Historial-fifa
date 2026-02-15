const { spawn } = require("node:child_process");
const http = require("node:http");
const https = require("node:https");

const args = process.argv.slice(2);
const targetUrl = args.find((arg) => !arg.startsWith("--")) || "http://localhost:5173";
const shouldWait = args.includes("--wait");
const timeoutArg = args.find((arg) => arg.startsWith("--timeout="));
const timeoutMs = timeoutArg ? Number(timeoutArg.split("=")[1]) : 90000;
const pollEveryMs = 1000;

function openInBrowser(url) {
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }

  const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.unref();
}

function pingUrl(url) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname || "/",
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(true);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.on("error", () => {
      resolve(false);
    });

    req.end();
  });
}

async function waitUntilReachable(url) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const ok = await pingUrl(url);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  return false;
}

async function main() {
  if (shouldWait) {
    process.stdout.write(`Waiting for ${targetUrl}\n`);
    const reachable = await waitUntilReachable(targetUrl);
    if (!reachable) {
      process.stderr.write(`Timeout waiting for ${targetUrl}\n`);
      process.exit(1);
    }
  }

  try {
    openInBrowser(targetUrl);
    process.stdout.write(`Opened ${targetUrl}\n`);
  } catch {
    process.stderr.write(`Could not open browser automatically. Open manually: ${targetUrl}\n`);
    process.exit(1);
  }
}

void main();
