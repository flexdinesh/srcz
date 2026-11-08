// Writes the macOS app icon (decision 0108): renders tile-macos.svg with
// rsvg-convert at each size and packs the PNGs into an .icns, using the entry
// types mygo's own icon renderer writes (no icp4/icp5; macOS scales those from
// ic11 and ic12).
//
//   node docs/brand/icns.mjs apps/desktop/resources/icon.icns
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const out = process.argv[2]
if (!out) {
  console.error("usage: node docs/brand/icns.mjs <out.icns>")
  process.exit(2)
}
const master = fileURLToPath(new URL("tile-macos.svg", import.meta.url))
const entries = [["ic11", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024]]

const chunks = entries.map(([kind, size]) => {
  const png = execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), master])
  const header = Buffer.alloc(8)
  header.write(kind, 0, "ascii")
  header.writeUInt32BE(png.length + 8, 4)
  return Buffer.concat([header, png])
})
const body = Buffer.concat(chunks)
const header = Buffer.alloc(8)
header.write("icns", 0, "ascii")
header.writeUInt32BE(body.length + 8, 4)
writeFileSync(out, Buffer.concat([header, body]))
