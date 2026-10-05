/*
 * The encrypted DATA inside index.html, and what sits beside it in media/.
 * Zero dependencies (node built-ins). The one place every tool reads or writes the payload.
 *
 *   v1 (every payload published before 1 Oct 2026):
 *       ENC.ct = AES-GCM(JSON) — every picture inline as a data: URI. 11 MB by then.
 *   v2: ENC.ct = AES-GCM(deflate-raw(JSON)), with z:1 and n:<JSON byte length> in ENC.
 *       The bio pictures — profile.docs[].img and the large portraits imgL — are references,
 *       "media:<id>:<width>x<height>", and each lives in media/<id>.bin =
 *       iv(12) + AES-GCM(u8 header length, header "data:image/jpeg;base64,", the picture's bytes),
 *       under the same key as the payload. The page fetches them once the tree is up.
 *   v3 (the family site since 1 Oct 2026): the page's own payload holds only what the tree's cards
 *       show — names, years, portraits, spouses, branches, the shape of the tree (CARD_KEYS). Every
 *       other field (bios, notes, sources, places, the gazetteer) is in ONE more file of the same kind,
 *       media/<ENC.x>.bin, header "x", holding deflate-raw(JSON) of one entry per person in tree order
 *       (the person, then each union's children): {k: the object's keys in order, f: the fields kept
 *       out, u: the same for each union}. ENC gains x and xn (that JSON's byte length). The page
 *       starts downloading it at once and merges it in when it lands.
 *   The demo is one file: v2 with every picture inline (split:false), no extras.
 *
 * The FULL data — what data.json holds, what every ledger hash is taken over — is identical in
 * every format: openEnc() puts it back exactly, key order included, and sealData() proves that
 * before it returns. A file's id and iv come from a keyed hash of what is in it, so unchanged
 * content keeps its file byte for byte (no churn in git), and the names say nothing about what is
 * inside. Two different contents never share an iv; one content always encrypts to the same file.
 */
"use strict";
const crypto = require("crypto");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const MEDIA_DIR = "media";
const REF_RE = /^media:([0-9a-f]{24})(?::(\d+)x(\d+))?$/;
/* what a card on the tree shows, and the shape of the tree; `profile` stays only as {} (the Bio chip) */
const CARD_KEYS = new Set(["id", "name", "years", "g", "img", "imgL", "branch", "anchor", "tag", "unions", "profile"]);
const UNION_KEYS = new Set(["s", "sy", "div", "c"]);

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

/* one file of media/: iv(12) + AES-GCM(u8 header length, header, bytes); id and iv keyed on `seed` */
function sealBlob(key, header, bytes, seed) {
  const mk = macKey(key);
  const id = crypto.createHmac("sha256", mk).update("id\0").update(seed).digest("hex").slice(0, 24);
  const iv = crypto.createHmac("sha256", mk).update("iv\0").update(seed).digest().subarray(0, 12);
  const pt = Buffer.concat([Buffer.from([header.length]), Buffer.from(header, "latin1"), bytes]);
  return { id, file: Buffer.concat([iv, gcmSeal(key, iv, pt)]) };
}
function openBlob(key, file) {
  const pt = gcmOpen(key, file.subarray(0, 12), file.subarray(12));
  const n = pt[0];
  return { header: pt.subarray(1, 1 + n).toString("latin1"), bytes: pt.subarray(1 + n) };
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
  const sz = imageSize(bytes);
  const { id, file } = sealBlob(key, header, bytes, s);   /* seeded on the data URI: the names of 1 Oct stay */
  return { id, file, ref: "media:" + id + (sz ? ":" + sz.w + "x" + sz.h : "") };
}
function openPicture(key, file) {
  const { header, bytes } = openBlob(key, file);
  return header + bytes.toString("base64");
}
/* one media/ file -> its data URI (or, for the extras, a short marker); throws unless it is
   ciphertext under this payload's key */
function openMediaFile(enc, pw, file) {
  const { header, bytes } = openBlob(keyFor(pw, enc.salt, enc.iter), file);
  if (header === "x") return "x:" + bytes.length;
  if (/^r:\d+$/.test(header) || header === "q") return header.split(":")[0] + ":" + bytes.length;   /* the Research view's files */
  if (header === "o") return "o:" + bytes.length;   /* the owner view (tools/linkconf.js): a second layer inside */
  return header + bytes.toString("base64");
}

/* v3: the cards, and everything else in tree order with each object's key order */
function splitCards(data) {
  const extras = [];
  function visit(p) {
    const e = { k: Object.keys(p), f: {} }, o = {};
    extras.push(e);
    for (const key of e.k) {
      if (key === "unions") continue;
      if (!CARD_KEYS.has(key)) e.f[key] = p[key];
      else if (key === "profile") { o.profile = p.profile ? {} : p.profile; e.f.profile = p.profile; }
      else o[key] = p[key];
    }
    if (Array.isArray(p.unions)) {
      e.u = [];
      o.unions = p.unions.map(u => {
        const ue = { k: Object.keys(u), f: {} }, uo = {};
        for (const key of ue.k) {
          if (key === "c" && Array.isArray(u.c)) continue;
          if (UNION_KEYS.has(key)) uo[key] = u[key]; else ue.f[key] = u[key];
        }
        e.u.push(ue);
        if (Array.isArray(u.c)) uo.c = u.c.map(visit);
        return uo;
      });
    } else if (p.unions !== undefined) e.f.unions = p.unions;
    return o;
  }
  return { cards: visit(data), extras };
}
function mergeCards(cards, extras) {
  let i = 0;
  const bad = () => { throw new Error("the extras do not match the payload"); };
  function visit(o) {
    const e = extras[i++] || bad(), p = {};
    for (const key of e.k) {
      if (key === "unions" && Array.isArray(o.unions)) {
        p.unions = o.unions.map((uo, j) => {
          const ue = (e.u || [])[j] || bad(), u = {};
          for (const uk of ue.k) u[uk] = uk === "c" && Array.isArray(uo.c) ? uo.c.map(visit) : (uk in ue.f ? ue.f[uk] : uo[uk]);
          return u;
        });
      } else p[key] = key in e.f ? e.f[key] : o[key];
    }
    return p;
  }
  const out = visit(cards);
  if (i !== extras.length) bad();
  return out;
}

/* readers for media/: the working tree, or a commit (for published history) */
function mediaFromDir(root) { return id => fs.readFileSync(path.join(root, MEDIA_DIR, id + ".bin")); }
function mediaFromGit(root, rev) {
  const { execFileSync } = require("child_process");
  return id => execFileSync("git", ["show", `${rev}:${MEDIA_DIR}/${id}.bin`], { cwd: root, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, stdio: ["ignore", "pipe", "ignore"] });
}
function readOrSay(readMedia, id, what) {
  try { return readMedia(id); } catch (e) { throw new Error("media/" + id + ".bin (" + what + ") is missing (" + (e.code || e.message) + ")"); }
}

/* ENC -> data. Stages: "full" (default; what data.json holds), "refs" (everything, the bio pictures
   still as media: references), "cards" (the page's own payload only; { core: true } means this). */
function openEnc(enc, pw, readMedia, opts = {}) {
  const stage = opts.core ? "cards" : (opts.stage || "full");
  const key = keyFor(pw, enc.salt, enc.iter);
  let pt = gcmOpen(key, Buffer.from(enc.iv, "base64"), Buffer.from(enc.ct, "base64"));
  if (enc.z) pt = zlib.inflateRawSync(pt);
  if (enc.n !== undefined && pt.length !== enc.n) throw new Error("payload length " + pt.length + " is not ENC.n " + enc.n);
  let data = JSON.parse(pt.toString("utf8"));
  if (stage === "cards") return data;
  if (enc.x) {
    if (!readMedia) throw new Error("the payload keeps its bios, notes and places in media/" + enc.x + ".bin, and there is no reader for media/");
    const { header, bytes } = openBlob(key, readOrSay(readMedia, enc.x, "the bios, notes and places"));
    if (header !== "x") throw new Error("media/" + enc.x + ".bin is not the payload's extras");
    const xjson = zlib.inflateRawSync(bytes);
    if (enc.xn !== undefined && xjson.length !== enc.xn) throw new Error("extras length " + xjson.length + " is not ENC.xn " + enc.xn);
    data = mergeCards(data, JSON.parse(xjson.toString("utf8")));
  }
  if (stage === "refs") return data;
  const ids = refsIn(data);
  if (ids.size && !readMedia) throw new Error("the payload has " + ids.size + " media references and no reader for media/");
  if (ids.size) eachPicture(data, s => isRef(s) ? openPicture(key, readOrSay(readMedia, refId(s), "a bio picture")) : undefined);
  return data;
}

/* data -> { line, enc, media: Map(id -> file bytes) }. split:false keeps everything in the page
   (the single-file demo); the JSON is compressed either way. Proves the round trip before returning. */
function sealData(data, pw, { salt, iter, split = true, iv } = {}) {
  if (!salt || !iter) throw new Error("sealData needs the salt (base64) and the iteration count");
  const key = keyFor(pw, salt, iter);
  let core = JSON.parse(JSON.stringify(data));
  const media = new Map();
  let x = null;
  if (split) {
    eachPicture(core, s => {
      if (isRef(s)) throw new Error("data already holds a media reference: data.json must carry every picture inline");
      if (!s.startsWith("data:")) return undefined;
      const sp = sealPicture(key, s);
      if (!sp) return undefined;
      media.set(sp.id, sp.file);
      return sp.ref;
    });
    const { cards, extras } = splitCards(core);
    const xjson = Buffer.from(JSON.stringify(extras), "utf8");
    const blob = sealBlob(key, "x", zlib.deflateRawSync(xjson, { level: 9 }), Buffer.concat([Buffer.from("extras\0"), xjson]));
    media.set(blob.id, blob.file);
    x = { id: blob.id, n: xjson.length };
    core = cards;
  }
  const json = Buffer.from(JSON.stringify(core), "utf8");
  const z = zlib.deflateRawSync(json, { level: 9 });
  const ivb = iv ? Buffer.from(iv) : crypto.randomBytes(12);
  const ct = gcmSeal(key, ivb, z);
  const enc = { v: x ? 3 : 2, iter, salt, iv: ivb.toString("base64"), ct: ct.toString("base64"), z: 1, n: json.length };
  let line = `const ENC = {v:${enc.v}, iter:${iter}, salt:"${salt}", iv:"${enc.iv}", ct:"${enc.ct}", z:1, n:${json.length}`;
  if (x) { enc.x = x.id; enc.xn = x.n; line += `, x:"${x.id}", xn:${x.n}`; }
  line += "};";
  /* the proof: what the page and every tool will read back is exactly the data we were given */
  const back = openEnc(readEnc(line), pw, id => { if (!media.has(id)) throw new Error("no such file"); return media.get(id); });
  if (JSON.stringify(back) !== JSON.stringify(data)) throw new Error("the sealed payload does not read back as the same data");
  return { line, enc, media };
}

/* write the files into <root>/media/, skipping identical ones; returns {written, kept} */
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
/* media/ files with a stable name that are not the payload's: the Research view's two files
   (tools/research.js, 3 Oct 2026), and Cory's owner view, owner.bin (tools/linkconf.js, 5 Oct 2026),
   whose figures sit under a second key only his devices hold. All are sealed under the payload key, so
   §14 still proves they are ciphertext, but no payload ever references them, so they are never orphans. */
const STABLE_MEDIA = new Set(["research.bin", "research-cards.bin", "owner.bin"]);
/* files in media/ the payload no longer uses (a picture changed, or the extras after any edit) */
function orphanMedia(root, ids) {
  let names = [];
  try { names = fs.readdirSync(path.join(root, MEDIA_DIR)); } catch (_) { return []; }
  return names.filter(n => n.endsWith(".bin") && !STABLE_MEDIA.has(n) && !ids.has(n.slice(0, -4)));
}
/* move them out of the site into <root>/<dest>/ (never deleted: removing them is the owner's call);
   returns the names moved. git then sees them as removed, and they go with the same commit. */
function parkOrphans(root, ids, dest) {
  const gone = orphanMedia(root, ids), moved = [];
  if (!gone.length) return moved;
  const to = path.join(root, dest);
  fs.mkdirSync(to, { recursive: true });
  for (const n of gone) {
    try { fs.renameSync(path.join(root, MEDIA_DIR, n), path.join(to, n)); moved.push(n); } catch (_) { /* left in place */ }
  }
  return moved;
}

module.exports = { MEDIA_DIR, REF_RE, CARD_KEYS, UNION_KEYS, STABLE_MEDIA, readEnc, keyFor, openEnc, sealData, writeMedia, orphanMedia,
  parkOrphans, openMediaFile, mediaFromDir, mediaFromGit, refsIn, eachPicture, imageSize, splitCards, mergeCards,
  gcmOpen, gcmSeal, sealBlob, openBlob };
