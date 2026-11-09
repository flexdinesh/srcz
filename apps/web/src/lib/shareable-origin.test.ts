import assert from "node:assert/strict"
import test from "node:test"

import { shareableOrigin } from "./shareable-origin.ts"

test("the desktop app's origin shares as a zero link", () => {
  assert.equal(shareableOrigin("zero-app://local"), "zero://local")
  assert.equal(shareableOrigin("zero-app://r-0123456789ab"), "zero://r-0123456789ab")
})

test("other app origins have no shareable address", () => {
  for (const origin of ["zero-app://other", "zero-app://localx", "zero-app://", "zero-app://r-012", "zero-app://r-0123456789AB", "zero-app://r-0123456789ab:80"]) {
    assert.equal(shareableOrigin(origin), null, origin)
  }
})

test("origins outside the app are unchanged", () => {
  for (const origin of ["http://localhost:7971", "https://127.0.0.1:7972", "zero://local", "null", "", "http://zero-app://local"]) {
    assert.equal(shareableOrigin(origin), origin)
  }
})
