#!/usr/bin/env node
/*
 * Add or replace a person's photo in the encrypted family-tree data.
 *
 *   node tools/photo.js "<person name>" <image file> [birth year]
 *
 * Pipeline: decrypt -> resize/compress (Python Pillow: a 160px JPEG q80 thumbnail for the
 * card, plus a copy up to 720px q82 for the full-size viewer when the original is bigger
 * than the thumbnail) -> embed as data URIs (img, imgL) on the matched person -> re-encrypt
 * -> run tests.
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

const VIEWER_ONLY = process.argv.includes("--viewer-only");   /* keep the hand-cropped thumbnail, add only the full-size copy */
const [name, imgPath, birthYear] = process.argv.slice(2).filter(a => a !== "--viewer-only");
if (!name || !imgPath) { console.error('usage: node tools/photo.js "<person name>" <image file> [birth year] [--viewer-only]'); process.exit(1); }
if (!fs.existsSync(imgPath)) { console.error("image not found: " + imgPath); process.exit(1); }

/* 1. decrypt */
run("node", [path.join(__dirname, "crypt.js"), "decrypt"]);

/* 2. resize + compress via Pillow */
const tmp = path.join(require("os").tmpdir(), "ft-photo-" + Date.now() + ".jpg");
const tmpL = tmp.replace(/\.jpg$/, "-L.jpg");
const py = `
import sys, os
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")
w = 160
im.resize((w, max(1, round(w * im.height / im.width))), Image.LANCZOS).save(sys.argv[2], "JPEG", quality=80, optimize=True)
print("thumbnail 160 px")
# the viewer copy: up to 720 px on the long side, only if the original beats the thumbnail
if max(im.size) > 200:
    L = im.copy(); L.thumbnail((720, 720), Image.LANCZOS)
    L.save(sys.argv[3], "JPEG", quality=82, optimize=True)
    print("viewer copy", L.size)
`;
run("python3", ["-c", py, imgPath, tmp, tmpL]);

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
if (!VIEWER_ONLY) matches[0].img = uri;
if (fs.existsSync(tmpL)) {
  matches[0].imgL = "data:image/jpeg;base64," + fs.readFileSync(tmpL).toString("base64");
  console.log("viewer copy " + Math.round(matches[0].imgL.length / 1024) + " KB");
} else { delete matches[0].imgL; }
fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 1));
console.log("embedded " + Math.round(uri.length / 1024) + " KB photo on: " + matches[0].name + " " + (matches[0].years || ""));

/* 4. re-encrypt (stable salt — family devices stay unlocked) + cleanup */
run("node", [path.join(__dirname, "crypt.js"), "encrypt"]);
const rm = f => { try { fs.unlinkSync(f); } catch (_) { /* some mounts refuse unlink; the file is gitignored */ } };
rm(JSON_FILE); rm(tmp); if (fs.existsSync(tmpL)) rm(tmpL);

/* 5. tests */
run("node", [path.join(ROOT, "tests", "run.js")]);
console.log("\nDone. Review, then commit index.html.");
