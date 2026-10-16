#!/usr/bin/env node
/*
 * 解密链路测试：验证 js/data.enc.js 能被浏览器用「账号+密码」解开。
 *
 * 用法：node tools/test-decrypt.js
 *
 * 为什么单独写一个：tools/check-data.js 用的是 Node 的 zlib（同步、方便），
 * 而浏览器走的是 WebCrypto + DecompressionStream。这里**刻意用和 js/app.js 一模一样的 API 序列**
 * 复现一遍，才能保证「Node 里能解开」等于「浏览器里也能解开」：
 *
 *   1. PBKDF2(user+":"+pass, salt, 150000, SHA-256) 派生 AES-256-GCM 密钥
 *   2. subtle.decrypt 解出 gzip 字节流（v2 格式；老格式解出来直接是 JSON 文本）
 *   3. DecompressionStream("gzip") 解压
 *   4. JSON.parse，并与 tools/data.json 逐项比对
 *
 * 覆盖的坑：KDF 轮数/盐写错、密文 base64 损坏、zip 标记漏写、压缩与加密顺序颠倒、
 * 以及「改完数据忘了重新加密」。
 *
 * 不需要任何依赖：只用 Node 内置的 WebCrypto 与 DecompressionStream（Node 18+）。
 */
const fs = require("fs");
const path = require("path");
const { webcrypto } = require("crypto");

const ROOT = path.join(__dirname, "..");
const fails = [];
const check = (name, ok, extra) => {
  console.log((ok ? "PASS" : "FAIL") + " - " + name + (extra ? "：" + extra : ""));
  if (!ok) fails.push(name);
};

// ---- 浏览器里 app.js 的解密代码，逐行镜像过来 ----
function b64ToBuf(b64) {
  const bin = Buffer.from(b64, "base64");
  return new Uint8Array(bin);
}
function deriveKey(user, pass, saltBuf) {
  return webcrypto.subtle
    .importKey("raw", new TextEncoder().encode(user + ":" + pass), "PBKDF2", false, ["deriveKey"])
    .then((base) => webcrypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBuf, iterations: 150000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]));
}
function gunzip(buf) {   // 与 app.js 的 gunzip() 相同：Blob -> DecompressionStream -> Response
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer().then((ab) => new TextDecoder().decode(ab));
}

(async () => {
  console.log("=== 解密链路测试（与浏览器相同的 API 序列）===\n");

  const src = fs.readFileSync(path.join(ROOT, "js", "data.enc.js"), "utf8");
  const m = src.match(/salt:"([^"]+)",iv:"([^"]+)",ct:"([^"]+)"/);
  check("data.enc.js 里有 salt / iv / ct", !!m);
  if (!m) return report();
  check("是 v2 格式（带 zip:gzip 标记）", /zip:"gzip"/.test(src),
    /zip:"gzip"/.test(src) ? "" : "缺少标记 → 浏览器不会解压，会直接 JSON.parse 报错");

  const [user, pass] = fs.readFileSync(path.join(ROOT, "tools", "auth.txt"), "utf8").trim().split(/\r?\n/);

  // 1+2+3：完整走一遍
  let plain = null, err = null;
  const t0 = Date.now();
  try {
    const key = await deriveKey(user, pass, b64ToBuf(m[1]));
    const dec = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(m[2]) }, key, b64ToBuf(m[3]));
    plain = /zip:"gzip"/.test(src) ? await gunzip(dec) : new TextDecoder().decode(dec);
  } catch (e) {
    err = e;
  }
  check("账号密码能解开密文（PBKDF2 150000 轮 + AES-GCM + gunzip）", !err && !!plain,
    err ? String(err.message || err) : ((Date.now() - t0) + "ms"));
  if (!plain) return report();

  let got = null;
  try { got = JSON.parse(plain); } catch (e) {
    check("明文是合法 JSON", false, String(e.message));
    return report();
  }
  check("明文是合法 JSON", true, (plain.length / 1024).toFixed(0) + " KB");

  // 4：与源码 data.json 逐项比对
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "data.json"), "utf8"));
  check("company 数与 tools/data.json 一致（" + got.companies.length + "）", got.companies.length === want.companies.length);
  check("guides 与 tools/data.json 一致（" + (got.guides || []).length + " 篇）",
    JSON.stringify(got.guides) === JSON.stringify(want.guides), "别让攻略在加解密途中丢失");
  check("channels 与 tools/data.json 一致", JSON.stringify(got.channels) === JSON.stringify(want.channels));
  check("updatedAt 一致（" + got.updatedAt + "）", got.updatedAt === want.updatedAt,
    "不一致通常意味着改完数据忘了重跑 encrypt-data.js");
  check("公司记录逐字节一致", JSON.stringify(got.companies) === JSON.stringify(want.companies));

  // 错误密码必须解不开（否则加密形同虚设）
  let wrongOk = true;
  try {
    const badKey = await deriveKey(user, pass + "_wrong", b64ToBuf(m[1]));
    await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(m[2]) }, badKey, b64ToBuf(m[3]));
  } catch (e) { wrongOk = false; }
  check("错误密码解不开（GCM 认证失败）", !wrongOk, wrongOk ? "严重：错误密码也能解开！" : "");

  report();

  function report() {
    console.log("");
    console.log(fails.length ? "❌ " + fails.length + " 项未通过" : "✅ 全部通过（解密链路与浏览器一致）");
    process.exit(fails.length ? 1 : 0);
  }
})();
