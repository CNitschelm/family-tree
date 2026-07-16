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
const { webcrypto } = require("node:crypto");
const subtle = webcrypto.subtle;

const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "index.html");
const JSON_FILE = path.join(ROOT, "data.json");

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
    console.log("wrote data.json — edit it, then run: node tools/crypt.js encrypt");
  } else if (mode === "encrypt") {
    const data = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    /* keep the existing salt+iterations so browsers' cached unlock keys keep
     * working across data updates; only the IV must be fresh per encryption.
     * (Changing the password? Delete the salt reuse by passing --newsalt.) */
    const { obj: cur, raw } = readEnc(html);
    const newSalt = process.argv.includes("--newsalt");
    const salt = newSalt ? webcrypto.getRandomValues(new Uint8Array(16)) : b(cur.salt);
    const iter = newSalt ? 600000 : cur.iter; /* OWASP-recommended PBKDF2-SHA256 count */
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const k = await key(pw, salt, iter, ["encrypt"]);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, k, Buffer.from(JSON.stringify(data))));
    const line = `const ENC = {v:1, iter:${iter}, salt:"${Buffer.from(salt).toString("base64")}", iv:"${Buffer.from(iv).toString("base64")}", ct:"${Buffer.from(ct).toString("base64")}"};`;
    fs.writeFileSync(HTML, html.replace(raw, line));
    console.log("re-encrypted DATA into index.html (" + ct.length + " bytes). Run tests, then commit.");
    console.log(newSalt
      ? "note: NEW SALT — every family member must re-enter the password."
      : "note: salt unchanged — family devices stay unlocked.");
  } else {
    console.error("usage: node tools/crypt.js decrypt|encrypt");
    process.exit(1);
  }
})().catch(e => { console.error("FAILED: " + e.message + " (wrong password?)"); process.exit(1); });
