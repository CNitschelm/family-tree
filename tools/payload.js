/*
 * The encrypted DATA inside index.html, and the bio pictures beside it in media/.
 * Zero dependencies (node built-ins). The one place every tool reads or writes the payload.
 *
 *   v1 (every payload published before 1 Oct 2026):
 *       ENC.ct = AES-GCM(JSON) — every picture inline as a data: URI. 11 MB by then.
 *   v2: ENC.ct = AES-GCM(deflate-raw(JSON)), with z:1 and n:<JSON byte length> in ENC.
 *       The bio pictures — profile.docs[].img and the large portraits imgL — are references,
 *       "media:<id>:<width>x<height>", and each lives in media/<id>.bin =
 *       iv(12) + AES-GCM(u8 header length, header "data:image/jpeg;base64,", the picture's bytes),
 *       under the same key as the payload. The page fetches one when a bio shows it.
 *       Card portraits (img) stay in the payload: the first view needs them.
 *
 * The FULL data — what data.json holds, what every ledger hash is taken over — is identical in
 * both formats: openEnc() puts every picture back exactly as it was, and sealData() proves that
 * before it returns. A picture's id and iv come from a keyed hash of the picture, so an unchanged
 * picture keeps its file byte for byte (no churn in git), and the names say nothing about what is
 * inside. Two different pictures never share an iv; one picture always encrypts to the same file.
 */
"use strict";
const crypto = require("crypto");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const MEDIA_DIR = "media";
const REF_RE = /^media:([0-9a-f]{24})(?::(\d+)x(\d+))?$/;

function readEnc(html) {
  const m = html.match(/const ENC = (\{[^}]*\});/);
  if (!m) throw new Error("ENC block not found");
  return JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
}

const _keys = new Map();
function keyFor(pw, saltB64, iter) {
  const k = saltB64 + ":" + iter + ":" + crypto.createHash("sha256").update(pw).digest("hex");
  if (!_keys.has(k)) _keys.set(k, crypto.pbkdf2Sync(Buffer.from(pw), Buffer.from(saltB64, "base64"), iter, 32, "sha256"));
  return _keys.get(k);
}
const macKey = key => crypto.createHash("sha256").update("ft-media-v1\0").update(key).digest();

function gcmOpen(key, iv, ctTag) {
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(ctTag.subarray(ctTag.length - 16));
  return Buffer.concat([d.update(ctTag.subarray(0, ctTag.length - 16)), d.final()]);
}
function gcmSeal(key, iv, pt) {
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}

/* every place a bio picture can sit; card portraits (p.img) are deliberately not here */
function eachPicture(data, fn) {
  (function walk(p) {
    if (!p || typeof p !== "object") return;
    if (typeof p.imgL === "string") { const v = fn(p.imgL); if (v !== undefined) p.imgL = v; }
    const docs = p.profile && Array.isArray(p.profile.docs) ? p.profile.docs : [];
    docs.forEach(dc => { if (dc && typeof dc.img === "string") { const v = fn(dc.img); if (v !== undefined) dc.img = v; } });
    (p.unions || []).forEach(u => (u.c || []).forEach(walk));
  })(data);
}
const isRef = s => typeof s === "string" && REF_RE.test(s);
const refId = s => REF_RE.exec(s)[1];
function refsIn(data) { const out = new Set(); eachPicture(data, s => { if (isRef(s)) out.add(refId(s)); }); return out; }

/* pixel size from the file itself (JPEG SOF, PNG IHDR), so the page can hold the right space */
function imageSize(b) {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7);
      return w && h ? { w, h } : null;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/* data URI -> {id, file, ref}; null if it cannot round-trip exactly (then it stays inline) */
function sealPicture(key, s) {
  const comma = s.indexOf(",");
  if (!s.startsWith("data:") || comma < 0 || !s.slice(0, comma).endsWith(";base64")) return null;
  const header = s.slice(0, comma + 1), b64 = s.slice(comma + 1);
  const bytes = Buffer.from(b64, "base64");
  if (bytes.toString("base64") !== b64 || header.length > 255 || /[^\x20-\x7e]/.test(header)) return null;
  const mk = macKey(key);
  const id = crypto.createHmac("sha256", mk).update("id\0" + s).digest("hex").slice(0, 24);
  const iv = crypto.createHmac("sha256", mk).update("iv\0" + s).digest().subarray(0, 12);
  const pt = Buffer.concat([Buffer.from([header.length]), Buffer.from(header, "latin1"), bytes]);
  const sz = imageSize(bytes);
  return { id, file: Buffer.concat([iv, gcmSeal(key, iv, pt)]), ref: "media:" + id + (sz ? ":" + sz.w + "x" + sz.h : "") };
}
function openPicture(key, file) {
  const pt = gcmOpen(key, file.subarray(0, 12), file.subarray(12));
  const n = pt[0];
  return pt.subarray(1, 1 + n).toString("latin1") + pt.subarray(1 + n).toString("base64");
}
/* one media/ file -> its data URI; throws unless it is ciphertext under this payload's key */
function openMediaFile(enc, pw, file) { return openPicture(keyFor(pw, enc.salt, enc.iter), file); }

/* readers for the pictures: the working tree, or a commit (for published history) */
function mediaFromDir(root) { return id => fs.readFileSync(path.join(root, MEDIA_DIR, id + ".bin")); }
function mediaFromGit(root, rev) {
  const { execFileSync } = require("child_process");
  return id => execFileSync("git", ["show", `${rev}:${MEDIA_DIR}/${id}.bin`], { cwd: root, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] });
}

/* ENC -> data. With readMedia the bio pictures are put back (the FULL data); with
   { core: true } the payload alone is returned (names, cards, places), references and all. */
function openEnc(enc, pw, readMedia, opts = {}) {
  const key = keyFor(pw, enc.salt, enc.iter);
  let pt = gcmOpen(key, Buffer.from(enc.iv, "base64"), Buffer.from(enc.ct, "base64"));
  if (enc.z) pt = zlib.inflateRawSync(pt);
  if (enc.n !== undefined && pt.length !== enc.n) throw new Error("payload length " + pt.length + " is not ENC.n " + enc.n);
  const data = JSON.parse(pt.toString("utf8"));
  if (opts.core) return data;
  const ids = refsIn(data);
  if (ids.size && !readMedia) throw new Error("the payload has " + ids.size + " media references and no reader for media/");
  if (ids.size) eachPicture(data, s => {
    if (!isRef(s)) return undefined;
    const id = refId(s);
    let file;
    try { file = readMedia(id); } catch (e) { throw new Error("media/" + id + ".bin is missing (" + (e.code || e.message) + ")"); }
    return openPicture(key, file);
  });
  return data;
}

/* data -> { line, enc, media: Map(id -> file bytes) }. split:false keeps every picture inline
   (the single-file demo); the JSON is compressed either way. Proves the round trip before returning. */
function sealData(data, pw, { salt, iter, split = true, iv } = {}) {
  if (!salt || !iter) throw new Error("sealData needs the salt (base64) and the iteration count");
  const key = keyFor(pw, salt, iter);
  const core = JSON.parse(JSON.stringify(data));
  const media = new Map();
  if (split) eachPicture(core, s => {
    if (isRef(s)) throw new Error("data already holds a media reference: data.json must carry every picture inline");
    if (!s.startsWith("data:")) return undefined;
    const sp = sealPicture(key, s);
    if (!sp) return undefined;
    media.set(sp.id, sp.file);
    return sp.ref;
  });
  const json = Buffer.from(JSON.stringify(core), "utf8");
  const z = zlib.deflateRawSync(json, { level: 9 });
  const ivb = iv ? Buffer.from(iv) : crypto.randomBytes(12);
  const ct = gcmSeal(key, ivb, z);
  const enc = { v: 2, iter, salt, iv: ivb.toString("base64"), ct: ct.toString("base64"), z: 1, n: json.length };
  const line = `const ENC = {v:2, iter:${iter}, salt:"${salt}", iv:"${enc.iv}", ct:"${enc.ct}", z:1, n:${json.length}};`;
  /* the proof: what the page and every tool will read back is exactly the data we were given */
  const back = openEnc(readEnc(line), pw, id => { if (!media.has(id)) throw new Error("no such picture"); return media.get(id); });
  if (JSON.stringify(back) !== JSON.stringify(data)) throw new Error("the sealed payload does not read back as the same data");
  return { line, enc, media };
}

/* write the pictures into <root>/media/, skipping identical files; returns {written, kept} */
function writeMedia(root, media) {
  const dir = path.join(root, MEDIA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  let written = 0, kept = 0;
  for (const [id, file] of media) {
    const p = path.join(dir, id + ".bin");
    let same = false;
    try { same = fs.readFileSync(p).equals(file); } catch (_) {}
    if (same) { kept++; continue; }
    fs.writeFileSync(p, file);
    if (!fs.readFileSync(p).equals(file)) throw new Error("media write did not land: " + p);
    written++;
  }
  return { written, kept };
}
/* media files no payload reference points at (left behind when a picture changes) */
function orphanMedia(root, ids) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, MEDIA_DIR)); } catch (_) { return []; }
  return names.filter(n => n.endsWith(".bin") && !ids.has(n.slice(0, -4)));
}

module.exports = { MEDIA_DIR, REF_RE, readEnc, keyFor, openEnc, sealData, writeMedia, orphanMedia, openMediaFile,
  mediaFromDir, mediaFromGit, refsIn, eachPicture, imageSize, gcmOpen, gcmSeal };
