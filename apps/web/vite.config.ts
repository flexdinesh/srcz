import { readFile } from "node:fs/promises"
import { networkInterfaces } from "node:os"
import { join } from "node:path"
import { fileURLToPath, URL } from "node:url"

import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { isFeedback, isFeedbackSummary } from "@zero/contracts"
import type { IncomingMessage } from "node:http"
import { defineConfig, type Plugin } from "vite"

import {
  devServerPort,
  devServerUrls,
  formatDevServerUrl,
  mockFeedbackStore,
  mockFixtureName,
  type MockFeedbackStore,
  primaryLanIpv4,
  shouldOpenBrowser,
} from "./dev-server.ts"

const devServerBanner: Plugin = {
  name: "zero-dev-server-banner",
  configureServer(server) {
    server.printUrls = () => {
      const address = server.httpServer?.address()

      if (address === null || address === undefined || typeof address === "string") {
        return
      }

      const lanAddress = primaryLanIpv4(networkInterfaces())
      for (const url of devServerUrls(address.port, lanAddress)) {
        server.config.logger.info(formatDevServerUrl(url))
      }
    }
  },
}

// @pierre/diffs can load Shiki, its grammars, and every Pierre, Shiki, and
// Highlights theme. zero highlights only with Highlights and its own theme,
// so production builds resolve those imports to local stand-ins and none of
// them ship (decision 0029).
const shikiUnavailable = "./src/highlighting/shiki-unavailable.ts"
const diffsSubsets: ReadonlyMap<string, string> = new Map([
  ["shiki", shikiUnavailable],
  ["shiki/core", shikiUnavailable],
  ["shiki/langs", shikiUnavailable],
  ["shiki/textmate", shikiUnavailable],
  ["shiki/wasm", shikiUnavailable],
  ["shiki/engine/javascript", shikiUnavailable],
  ["shiki/engine/oniguruma", shikiUnavailable],
  ["@pierre/theming/themes", "./src/highlighting/pierre-themes-subset.ts"],
  ["@pierre/highlights/themes/loader", "./src/highlighting/highlights-themes-subset.ts"],
].map(([source, subset]) => [source, fileURLToPath(new URL(subset, import.meta.url))]))

const diffsSubset: Plugin = {
  name: "zero-diffs-subset",
  apply: "build",
  enforce: "pre",
  resolveId(source, importer) {
    if (importer === undefined || !importer.replaceAll("\\", "/").includes("/@pierre/diffs/")) return null
    return diffsSubsets.get(source) ?? null
  },
}

const mockFixturesDirectory = fileURLToPath(
  new URL("../../testdata/api/default", import.meta.url),
)

async function readJSONFixture(name: string): Promise<unknown> {
  return JSON.parse((await readFile(join(mockFixturesDirectory, name))).toString("utf8"))
}

// loadFeedbackStore seeds the in-memory feedback from the fixtures.
async function loadFeedbackStore(): Promise<MockFeedbackStore> {
  const current = await readJSONFixture("feedback.json")
  const listed = await readJSONFixture("feedback-list.json")
  if (!isFeedback(current) || !Array.isArray(listed) || !listed.every(isFeedbackSummary)) throw new Error("invalid feedback fixtures")
  return mockFeedbackStore(current, listed)
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString("utf8")
}

function mockApi(enabled: boolean): Plugin {
  return {
    name: "zero-mock-api",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return
      let feedback: Promise<MockFeedbackStore> | undefined
      server.middlewares.use("/api", async (request, response, next) => {
        if (request.url?.startsWith("/feedback")) {
          try {
            feedback ??= loadFeedbackStore()
            const answer = (await feedback).handle({ method: request.method ?? "", url: request.url, body: await readRequestBody(request) })
            if (answer !== undefined) {
              response.statusCode = answer.status
              response.setHeader("Cache-Control", "no-store")
              if (answer.body) response.setHeader("Content-Type", "application/json; charset=utf-8")
              response.end(answer.body)
              return
            }
          } catch {
            response.statusCode = 500
            response.end('{"error":"mock feedback unavailable"}')
            return
          }
        }
        const fixture = mockFixtureName(request.method ?? "", request.url ?? "")
        if (fixture === undefined) {
          next()
          return
        }

        try {
          response.statusCode = fixture.status
          response.setHeader("Cache-Control", "no-store")
          response.setHeader("Content-Type", fixture.contentType ?? "application/json; charset=utf-8")
          const body = await readFile(join(mockFixturesDirectory, fixture.name))
          if (fixture.event) response.write(`event: ${fixture.event}\ndata: ${body.toString("utf8").trim()}\n\n`)
          else response.end(body)
        } catch {
          response.statusCode = 500
          response.end('{"error":"mock fixture unavailable"}')
        }
      })
    },
  }
}

// Ports come from the environment; mise loads them from .env (decision 0038).
const goServerPort = devServerPort(process.env, "ZERO_DEV_SERVER_PORT", 8080)
const webServerPort = devServerPort(process.env, "ZERO_DEV_WEB_PORT", 5173)

export default defineConfig(({ command, mode }) => ({
  base: command === "build" ? "/assets/" : "/",
  build: {
    assetsDir: "",
    // Fonts stay files: the CSP's font-src 'self' refuses data: URLs, and
    // JetBrains Mono's cyrillic-ext subset is under the 4 KB inline limit.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
    emptyOutDir: true,
    outDir: "../zero/internal/web/dist",
  },
  plugins: [diffsSubset, react(), tailwindcss(), devServerBanner, mockApi(mode === "mock")],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    allowedHosts: true,
    host: "0.0.0.0",
    open: shouldOpenBrowser(process.env),
    port: webServerPort,
    proxy: mode === "mock" ? undefined : {
      "/api": process.env.ZERO_API_TARGET || `http://127.0.0.1:${goServerPort}`,
    },
    strictPort: true,
  },
  worker: {
    plugins: () => [diffsSubset],
  },
}))
