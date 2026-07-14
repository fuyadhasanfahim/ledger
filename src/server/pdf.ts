import "server-only";

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

import { log } from "@/lib/logger";

/**
 * Headless-Chromium PDF rendering.
 *
 * Why `puppeteer-core` + `@sparticuz/chromium` rather than plain `puppeteer`:
 * the full package bundles its own ~170MB Chromium, which blows through Vercel's
 * serverless function size limit. `@sparticuz/chromium` ships a Lambda-compatible
 * build small enough to deploy, and `puppeteer-core` drives it without bundling a
 * browser of its own.
 *
 * Locally there is no Lambda Chromium, so we hunt for a real one. Note that
 * *every* Chromium — Sparticuz's included — dynamically links libnss3/libnspr4.
 * Those ship with Amazon Linux (hence Vercel works), but not with a bare
 * Ubuntu/WSL install, which is the single most common reason this fails on a dev
 * machine. `assertRunnable` turns that into a message that says what to do
 * instead of a raw "Code: 127".
 */

const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

async function launch(): Promise<Browser> {
  if (isServerless) {
    // Imported lazily: the module unpacks a Chromium tarball on import, which is
    // a pure cold-start cost on any machine that will never use it.
    // (This dynamic import is invisible to Vercel's file tracer, which is why
    // the package is pinned via outputFileTracingIncludes in next.config.ts.)
    const chromium = (await import("@sparticuz/chromium")).default;

    // Skip unpacking the software-GL (swiftshader) libraries. We render a static
    // A4 document — there is nothing to rasterise on a GPU — and skipping it cuts
    // both cold-start time and the memory ceiling, which is the usual reason this
    // dies on a serverless function.
    chromium.setGraphicsMode = false;

    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  return puppeteer.launch({
    executablePath: localChrome(),
    headless: true,
    // --no-sandbox is required in most containers/WSL, where the kernel doesn't
    // grant the namespaces Chromium's sandbox wants. Acceptable here: the only
    // thing we ever render is our own trusted, server-generated HTML.
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/**
 * Find a Chrome we can drive, in order of how deliberate the choice was.
 */
function localChrome(): string {
  const explicit = process.env.CHROME_PATH;

  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(
        `CHROME_PATH is set to "${explicit}", but nothing is there.`,
      );
    }
    return explicit;
  }

  const candidates = [
    // Installed by `npm run chrome:install` (no sudo needed).
    ...chromeForTesting(),
    // A system Chrome, if there is one.
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  const found = candidates.find((path) => existsSync(path));

  if (!found) {
    throw new Error(
      [
        "No Chrome found for PDF rendering.",
        "",
        "Install one (no sudo needed):",
        "  npm run chrome:install",
        "",
        "On Linux/WSL you also need Chromium's shared libraries once:",
        "  sudo apt-get install -y libnss3 libnspr4 libatk1.0-0t64 \\",
        "    libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \\",
        "    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \\",
        "    libasound2t64 libpango-1.0-0 libcairo2",
        "",
        "Or point CHROME_PATH at a Chrome you already have.",
      ].join("\n"),
    );
  }

  return found;
}

/**
 * Chrome-for-Testing unpacks into a versioned, platform-specific directory
 * (`chrome/<version>/chrome-linux64/chrome`), and the exact shape differs by
 * platform and by CLI version. Rather than hard-code a layout that silently goes
 * stale on the next update, walk the install root and find the executable.
 */
function chromeForTesting(): string[] {
  const roots = [
    join(process.cwd(), "chrome"),
    join(homedir(), ".cache", "puppeteer"),
  ];

  const names = new Set([
    "chrome",
    "chrome.exe",
    "Google Chrome for Testing",
  ]);

  const found: string[] = [];

  // Depth-limited: the binary sits ~4 levels down, and an unbounded walk of a
  // home directory would be a nasty surprise on a cold request.
  function walk(dir: string, depth: number) {
    if (depth > 5 || found.length > 0) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable — skip.
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isFile() && names.has(entry.name)) {
        found.push(path);
        return;
      }

      if (entry.isDirectory()) walk(path, depth + 1);
    }
  }

  for (const root of roots) {
    if (existsSync(root)) walk(root, 0);
  }

  return found;
}

export async function renderPdf(html: string): Promise<Uint8Array> {
  let browser: Browser;

  try {
    browser = await launch();
  } catch (error) {
    // Chromium exits 127 when a shared library is missing. That message ("error
    // while loading shared libraries: libnspr4.so") is the actual answer, and
    // burying it behind a generic 500 is what made this hard to diagnose.
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("shared libraries") || message.includes("127")) {
      throw new Error(
        [
          "Chrome is installed but cannot start — its shared libraries are missing.",
          "",
          "Run once:",
          "  sudo apt-get install -y libnss3 libnspr4 libatk1.0-0t64 \\",
          "    libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \\",
          "    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \\",
          "    libasound2t64 libpango-1.0-0 libcairo2",
          "",
          `Original error: ${message.split("\n").find((l) => l.includes("libraries")) ?? message}`,
        ].join("\n"),
      );
    }

    throw error;
  }

  try {
    const page = await browser.newPage();

    // The receipt is fully self-contained (inlined CSS, no images, no webfonts),
    // so "load" is genuinely enough — there is no network to idle on.
    await page.setContent(html, { waitUntil: "load" });

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true, // without this the paper colour is dropped
      preferCSSPageSize: true,
    });

    log.info("receipt.rendered", { bytes: pdf.length });

    return pdf;
  } finally {
    // Always close, even if pdf() throws — a leaked browser on a warm serverless
    // container will eventually eat its memory.
    await browser.close();
  }
}
