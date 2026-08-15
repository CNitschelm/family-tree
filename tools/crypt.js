#!/usr/bin/env node
/*
 * Encrypt/decrypt the family-tree DATA inside index.html.
 * Zero dependencies. Password comes from the FT_PASSWORD env var,
 * or a git-ignored ".password" file at the repo root.
 *
 *   node tools/crypt.js decrypt   -> writes data.json (edit this)
 *   node tools/crypt.js encrypt   -> reads data.json, re-encrypts into index.html
 *
 * Photos: put them in a person's "img" field in data.json as a data URI
 * ("data:image/jpeg;base64,...."). Keep originals wherever you like — they
 * are not stored in the repo.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { webcrypto, createHash } = require("node:crypto");
const subtle = webcrypto.subtle;

const ROOT = path.join(__dirname, "..");
const JSON_FILE = path.join(ROOT, "data.json");
/* Provenance stamp for data.json: which index.html payload it was decrypted FROM.
 * gitignored by the deny-by-default rule, like data.json itself. */
const STAMP_FILE = path.join(ROOT, ".data-stamp");

/* A payload's identity: the IV is unique per encryption, so if index.html's IV has
 * changed since we decrypted, index.html has been re-encrypted behind our back and
 * the data.json in hand no longer descends from it. */
const fingerprint = enc => enc.iv + ":" + createHash("sha256").update(enc.ct).digest("hex").slice(0, 16);

/* WHY THIS EXISTS. On 15 Aug 2026 the data.json sitting in this repo was 3,745,108
 * bytes while the payload inside index.html was 5,175,444 — a week stale, because a
 * previous session had left it behind. Editing that file and running `encrypt` would
 * have silently reverted a week of work, and every test would still have passed: the
 * suites check the SHAPE of the data, not whether it is the CURRENT data. Nothing
 * anywhere caught it. This guard is the thing that catches it. */
function readStamp() {
  try { return fs.readFileSync(STAMP_FILE, "utf8").trim(); } catch (_) { return null; }
}
function writeStamp(enc) {
  fs.writeFileSync(STAMP_FILE, fingerprint(enc) + "\n");
}
function assertFresh(cur, forced) {
  const stamp = readStamp();
  const now = fingerprint(cur);
  if (stamp === now) return;
  const why = stamp === null
    ? "data.json has no provenance stamp — nothing records which index.html it came from."
    : "data.json was decrypted from a DIFFERENT index.html than the one on disk now.";
  if (forced) {
    console.log("WARNING: " + why + " Proceeding because --force was passed.");
    return;
  }
  console.error("REFUSED: " + why);
  console.error("");
  console.error("  Encrypting now would overwrite the current payload with whatever is in");
  console.error("  data.json, and the tests would NOT catch it — they check the shape of the");
  console.error("  data, not whether it is current.");
  console.error("");
  console.error("  If your edits are unsaved elsewhere, back up data.json first, then:");
  console.error("    node tools/crypt.js decrypt     # refresh from index.html, re-apply edits");
  console.error("  If you are certain data.json is the version you want to publish:");
  console.error("    node tools/crypt.js encrypt --force");
  process.exit(1);
}

/* The Cowork sandbox mount can serve stale (or falsely missing) entries for a
 * cached exact path; unseen case variants bypass the cache. On case-sensitive
 * filesystems the variants don't exist and the plain name wins. */
function resolveHtml() {
  const variant = () => "index.html".split("").map(c => Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()).join("");
  for (const name of ["index.html", variant(), variant(), variant()]) {
    try {
      const t = fs.readFileSync(path.join(ROOT, name), "utf8");
      if (t.trimEnd().endsWith("</html>")) return path.join(ROOT, name);
    } catch (_) { /* try next */ }
  }
  console.error("FAILED: no complete index.html reachable"); process.exit(1);
}
const HTML = resolveHtml();

function password() {
  if (process.env.FT_PASSWORD) return process.env.FT_PASSWORD.trim();
  try { return fs.readFileSync(path.join(ROOT, ".password"), "utf8").trim(); }
  catch (_) { console.error("No password: set FT_PASSWORD or create .password"); process.exit(1); }
}
function readEnc(html) {
  const m = html.match(/const ENC = (\{[^}]*\});/);
  if (!m) { console.error("ENC block not found in index.html"); process.exit(1); }
  return { obj: JSON.parse(m[1].replace(/(\w+):/g, '"$1":')), raw: m[0] };
}
const b = s => Buffer.from(s, "base64");

async function key(pw, salt, iter, usages) {
  const km = await subtle.importKey("raw", Buffer.from(pw), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, usages);
}

(async () => {
  const mode = process.argv[2];
  const html = fs.readFileSync(HTML, "utf8");
  const pw = password();

  if (mode === "decrypt") {
    const { obj } = readEnc(html);
    const k = await key(pw, b(obj.salt), obj.iter, ["decrypt"]);
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: b(obj.iv) }, k, b(obj.ct));
    const data = JSON.parse(Buffer.from(pt).toString("utf8"));
    fs.writeFileSync(JSON_FILE, JSON.stringify(data, null, 1));
    writeStamp(obj); /* record which payload this data.json descends from */
    console.log("wrote data.json — edit it, then run: node tools/crypt.js encrypt");
  } else if (mode === "encrypt") {
    const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    /* keep the existing salt+iterations so browsers' cached unlock keys keep
     * working across data updates; only the IV must be fresh per encryption.
     * (Changing the password? Delete the salt reuse by passing --newsalt.) */
    const { obj: cur, raw } = readEnc(html);
    /* Before anything else: is data.json actually a descendant of THIS index.html? */
    assertFresh(cur, process.argv.includes("--force"));
    const newSalt = process.argv.includes("--newsalt");
    const salt = newSalt ? webcrypto.getRandomValues(new Uint8Array(16)) : b(cur.salt);
    const iter = newSalt ? 600000 : cur.iter; /* OWASP-recommended PBKDF2-SHA256 count */
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const k = await key(pw, salt, iter, ["encrypt"]);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, k, Buffer.from(JSON.stringify(data))));
    const line = `const ENC = {v:1, iter:${iter}, salt:"${Buffer.from(salt).toString("base64")}", iv:"${Buffer.from(iv).toString("base64")}", ct:"${Buffer.from(ct).toString("base64")}"};`;
    /* atomic-ish replace: in-place overwrites through the Cowork mount have
     * truncated the file before (grown files got capped at the old length).
     * Writing a new file and renaming over the original avoids that. */
    const out = html.replace(raw, line);
    fs.writeFileSync(HTML + ".new", out);
    const check = fs.readFileSync(HTML + ".new", "utf8");
    if (check.length !== out.length || !check.trimEnd().endsWith("</html>")) {
      console.error("FAILED: staging write verification"); process.exit(1);
    }
    /* The rename is the happy path. Some mounts (the Cowork bridge) refuse to
     * unlink or rename and throw EPERM — which used to leave a COMPLETE .new
     * file beside an UNCHANGED index.html and a non-zero exit, i.e. a run that
     * looks failed but has already done all the real work. Fall back to an
     * in-place overwrite, and then PROVE it landed: this mount has silently
     * capped grown files at the old length before, so the read-back below is
     * the whole point of the fallback, not a formality. */
    try {
      fs.rmSync(HTML, { force: true });
      fs.renameSync(HTML + ".new", HTML);
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY", "ENOTSUP"].includes(e.code)) throw e;
      console.log("note: this mount refuses rename (" + e.code + ") — overwriting in place and verifying.");
      const fd = fs.openSync(HTML, "w");
      try { fs.writeSync(fd, out); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const back = fs.readFileSync(HTML, "utf8");
      if (back.length !== out.length || !back.trimEnd().endsWith("</html>")) {
        console.error("FAILED: in-place overwrite was truncated — " + back.length +
          " of " + out.length + " bytes landed.");
        console.error("The complete file is still at " + HTML + ".new — move it over by hand, then re-run the tests.");
        process.exit(1);
      }
      /* best-effort: the same mount may refuse this too. It is gitignored, so a
       * leftover is harmless — but say so, because a stale one is confusing. */
      try { fs.rmSync(HTML + ".new", { force: true }); }
      catch (_) { console.log("note: could not remove " + HTML + ".new (gitignored, safe to leave)."); }
    }
    /* data.json now descends from the payload we just wrote — re-stamp it, so a second
     * encrypt in the same session is not refused by the freshness guard above. */
    writeStamp({ iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") });
    console.log("re-encrypted DATA into index.html (" + ct.length + " bytes). Run tests, then commit.");
    console.log(newSalt
      ? "note: NEW SALT — every family member must re-enter the password."
      : "note: salt unchanged — family devices stay unlocked.");
  } else {
    console.error("usage: node tools/crypt.js decrypt|encrypt");
    process.exit(1);
  }
})().catch(e => { console.error("FAILED: " + e.message + " (wrong password?)"); process.exit(1); });
