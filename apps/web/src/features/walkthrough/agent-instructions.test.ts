import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { agentInstructions, stepPrompt } from "./agent-instructions.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const schema: unknown = JSON.parse(readFileSync(new URL("../../../../zero/internal/walkthrough/schema.json", import.meta.url), "utf8"))

function resolve(node: unknown): Record<string, unknown> {
  assert.ok(isRecord(node) && isRecord(schema) && isRecord(schema.$defs))
  if (typeof node.$ref !== "string") return node
  const definition = schema.$defs[node.$ref.replace("#/$defs/", "")]
  assert.ok(isRecord(definition), `unknown ${node.$ref}`)
  return definition
}

// problems checks value against the subset of JSON Schema schema.json uses,
// so the copied example cannot name a field or value the server rejects.
function problems(value: unknown, node: unknown, at: string): string[] {
  const rule = resolve(node)
  const found: string[] = []
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) found.push(`${at}: not one of ${rule.enum.join(", ")}`)
  if (rule.type === "string") {
    if (typeof value !== "string") return [`${at}: not a string`]
    if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) found.push(`${at}: does not match ${rule.pattern}`)
  }
  if (rule.type === "boolean" && typeof value !== "boolean") found.push(`${at}: not a boolean`)
  if (rule.type === "integer" && !Number.isInteger(value)) found.push(`${at}: not an integer`)
  if (rule.type === "array") {
    if (!Array.isArray(value)) return [`${at}: not an array`]
    value.forEach((item, index) => {
      const itemRule = Array.isArray(rule.prefixItems) ? rule.prefixItems[index] : rule.items
      found.push(...problems(item, itemRule, `${at}[${index}]`))
    })
  }
  if (rule.type === "object") {
    if (!isRecord(value)) return [`${at}: not an object`]
    const properties = isRecord(rule.properties) ? rule.properties : {}
    for (const [key, item] of Object.entries(value)) {
      if (key in properties) found.push(...problems(item, properties[key], `${at}.${key}`))
      else found.push(`${at}.${key}: unknown field`)
    }
    for (const key of Array.isArray(rule.required) ? rule.required : []) {
      if (typeof key === "string" && !(key in value)) found.push(`${at}.${key}: missing`)
    }
  }
  return found
}

function example(prompt: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt)
  assert.ok(match?.[1], "the prompt carries a JSON example")
  return JSON.parse(match[1])
}

test("instructions name the running zero, the project, and the endpoints", () => {
  const prompt = agentInstructions("http://localhost:7971", "/home/me/src/app")
  assert.match(prompt, /^zero: http:\/\/localhost:7971$/m)
  assert.match(prompt, /^Project: \/home\/me\/src\/app$/m)
  assert.match(prompt, /^Publish: zero walkthrough publish walkthrough\.json/m)
  assert.match(prompt, /^zero walkthrough publish walkthrough\.json$/m)
  assert.match(prompt, /GET http:\/\/localhost:7971\/api\/walkthrough-schema/)
  assert.match(prompt, /--data @walkthrough\.json http:\/\/localhost:7971\/api\/walkthroughs$/m)
  assert.ok(prompt.endsWith("\n\nWalk me through: "))
})

test("without a shareable origin the prompt names the CLI only and no zero line", () => {
  const prompt = agentInstructions(null, "/home/me/src/app")
  assert.doesNotMatch(prompt, /^zero:/m)
  assert.match(prompt, /Write a Zero walkthrough of the topic at the end, and publish it with zero\.\n\nProject: \/home\/me\/src\/app$/m)
  assert.doesNotMatch(prompt, /curl|\/api\/|Over HTTP|zero-app/)
  assert.deepEqual(example(prompt), example(agentInstructions("http://localhost:7971", "/home/me/src/app")))
})

test("an origin that is not http(s) names only the CLI", () => {
  const prompt = agentInstructions("zero://local", "/home/me/src/app")
  assert.match(prompt, /^zero: zero:\/\/local$/m)
  assert.match(prompt, /^Format: zero walkthrough schema \(JSON Schema;/m)
  assert.match(prompt, /^zero walkthrough publish walkthrough\.json$/m)
  assert.doesNotMatch(prompt, /curl|\/api\/|Over HTTP/)
  assert.ok(prompt.endsWith("\n\nWalk me through: "))
  // Only the HTTP parts differ from an http origin's prompt.
  const http = agentInstructions("http://localhost:7971", "/home/me/src/app")
  assert.deepEqual(example(prompt), example(http))
})

test("the example walkthrough follows the server's schema", () => {
  const walkthrough = example(agentInstructions("http://localhost:7971", "/home/me/src/app"))
  assert.deepEqual(problems(walkthrough, schema, "walkthrough"), [])
  assert.ok(isRecord(walkthrough) && Array.isArray(walkthrough.steps))
  const targets = walkthrough.steps.map((step) => isRecord(step) ? Object.keys(step).filter((key) => key === "file" || key === "diff").join() : "")
  assert.deepEqual(new Set(targets), new Set(["", "file", "diff"]))
  assert.deepEqual(problems({ ...walkthrough, steps: [{ title: "x", file: { path: "a", line: 1 } }] }, schema, "walkthrough"), [
    "walkthrough.steps[0].file.line: unknown field",
  ])
})

test("instructions explain alternate command names for every transport", () => {
  for (const origin of [null, "zero://local", "http://localhost:7971"]) {
    const prompt = agentInstructions(origin, "/work/app")
    assert.match(prompt, /canonical `zero`/)
    assert.match(prompt, /`zero-cli` or with `--name NAME`, substitute your chosen command for `zero`/)
    assert.match(prompt, /^Publish: zero walkthrough publish walkthrough\.json/m)
  }
})

test("the example quotes awkward project paths as JSON", () => {
  const project = String.raw`C:\Users\me\"quoted" app`
  const walkthrough = example(agentInstructions("http://127.0.0.1:7972", project))
  assert.ok(isRecord(walkthrough))
  assert.equal(walkthrough.project, project)
})

test("a step's prompt names the walkthrough, the step, its target, and a link", () => {
  const input = {
    origin: "http://127.0.0.1:8080", project: "/work/app", walkthroughId: "session-refresh", walkthroughTitle: "How sessions refresh",
    index: 2, count: 7, stepTitle: "Refresh retries once", label: "vs main · auth/refresh.go:12–30", href: "/view?project=%2Fwork%2Fapp&wt=session-refresh&step=3#f=auth/refresh.go",
  }
  const prompt = stepPrompt(input)
  assert.match(prompt, /^Walkthrough: How sessions refresh \(id session-refresh\)$/m)
  assert.match(prompt, /^Project: \/work\/app$/m)
  assert.match(prompt, /^Step 3 of 7: Refresh retries once$/m)
  assert.match(prompt, /^Target: vs main · auth\/refresh\.go:12–30$/m)
  assert.match(prompt, /^Link: http:\/\/127\.0\.0\.1:8080\/view\?project=%2Fwork%2Fapp&wt=session-refresh&step=3#f=auth\/refresh\.go$/m)
  assert.ok(prompt.endsWith("Question: "))
  assert.doesNotMatch(stepPrompt({ ...input, origin: null }), /^Link:/m)
  for (const origin of [input.origin, null]) {
    assert.match(stepPrompt({ ...input, origin }), /`zero-cli` or with `--name NAME`, substitute your chosen command for `zero`/)
  }
})
