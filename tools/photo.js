#!/usr/bin/env node
/*
 * Add or replace a person's photo in the encrypted family-tree data.
 *
 *   node tools/photo.js "<person name>" <image file> [birth year]
 *
 * Pipeline: decrypt -> resize/compress (Python Pillow, 160px JPEG q80)
 * -> embed as data URI on the matched person -> re-encrypt -> run tests.
 * The birth year argument disambiguates duplicate names (matched against
 * the person's "years" field).
 *
 * Requires: node, python3 + Pillow, and the password (.password file or
 * FT_PASSWORD env). Names are passed at runtime only — never committed.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const JSON_FILE = path.join(ROOT, "data.json");

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: "inherit", cwd: ROOT }, opts));
  if (r.status !== 0) { console.error("FAILED: " + cmd + " " + args.join(" ")); process.exit(1); }
}

const [name, imgPath, birthYear] = process.argv.slice(2);
if (!name || !imgPath) { console.error('usage: node tools/photo.js "<person name>" <image file> [birth year]'); process.exit(1); }
if (!fs.existsSync(imgPath)) { console.error("image not found: " + imgPath); process.exit(1); }

/* 1. decrypt */
run("node", [path.join(__dirname, "crypt.js"), "decrypt"]);

/* 2. resize + compress via Pillow */
const tmp = path.join(require("os").tmpdir(), "ft-photo-" + Date.now() + ".jpg");
const py = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w = 160
im = im.resize((w, max(1, round(w * im.height / im.width))), Image.LANCZOS)
im.save(sys.argv[2], "JPEG", quality=80, optimize=True)
print("resized to", im.size)
`;
run("python3", ["-c", py, imgPath, tmp]);

/* 3. embed */
const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
const matches = [];
(function walk(p) {
  if (p.name === name && (!birthYear || (p.years || "").includes(birthYear))) matches.push(p);
  for (const u of p.unions || []) for (const c of u.c || []) walk(c);
})(data);
if (matches.length !== 1) {
  console.error("expected exactly 1 match for \"" + name + "\"" + (birthYear ? " (" + birthYear + ")" : "") + ", found " + matches.length);
  matches.forEach(m => console.error("  - " + m.name + " " + (m.years || "")));
  fs.unlinkSync(JSON_FILE);
  process.exit(1);
}
const uri = "data:image/jpeg;base64," + fs.readFileSync(tmp).toString("base64");
matches[0].img = uri;
fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 1));
console.log("embedded " + Math.round(uri.length / 1024) + " KB photo on: " + matches[0].name + " " + (matches[0].years || ""));

/* 4. re-encrypt (stable salt — family devices stay unlocked) + cleanup */
run("node", [path.join(__dirname, "crypt.js"), "encrypt"]);
fs.unlinkSync(JSON_FILE);
fs.unlinkSync(tmp);

/* 5. tests */
run("node", [path.join(ROOT, "tests", "run.js")]);
console.log("\nDone. Review, then commit index.html.");
