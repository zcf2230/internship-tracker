#!/usr/bin/env node
/* 把 tools/data.json 加密为 js/data.enc.js（AES-256-GCM，密钥由账号+密码派生）
 * 账号密码存 tools/auth.txt（已 gitignore，不进仓库）。用法：node tools/encrypt-data.js */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const zlib = require("zlib");

const [user, pass] = fs.readFileSync(path.join(__dirname, "auth.txt"), "utf8").trim().split(/\r?\n/);
// ① 先 minify：tools/data.json 带缩进是为了人看/diff 方便，缩进原样进密文会白占体积。
const minified = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8")));

/*
 * ② 再 gzip，最后才加密 —— 顺序很关键：
 *    AES-GCM 的密文是伪随机的、**完全不可压缩**（HTTP 传输层也压不动），
 *    所以「加密 -> base64」的体积 = 明文大小 × 1.33，1064 家机构时高达 1.17MB。
 *    在国内访问 GitHub Pages 实测只有 ~65KB/s，等于每次打开都要下 20 秒 —— 这就是「启动慢」的根因。
 *    改成「明文 -> gzip -> 加密 -> base64」后，实测 876KB 明文压到 95KB，
 *    产物从 1168KB 降到约 130KB（-89%），下载 20s -> 2s。
 *    浏览器端用原生 DecompressionStream("gzip") 解压，不需要任何额外依赖。
 */
const gz = zlib.gzipSync(Buffer.from(minified, "utf8"), { level: 9 });
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(user + ":" + pass, salt, 150000, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(gz), cipher.final(), cipher.getAuthTag()]);

// v2 = 带 zip 标记的新格式；浏览器端靠 zip 字段决定要不要解压（兼容老格式）
const out = "/* 加密数据：需登录解密（详见 tools/encrypt-data.js） */\n" +
  "window.ENC_DATA={v:2,zip:\"gzip\",salt:" + JSON.stringify(salt.toString("base64")) +
  ",iv:" + JSON.stringify(iv.toString("base64")) +
  ",ct:" + JSON.stringify(ct.toString("base64")) + "};\n";
fs.writeFileSync(path.join(__dirname, "..", "js", "data.enc.js"), out, "utf8");
const b64 = Math.ceil(ct.length / 3) * 4;
console.log("加密完成（minify -> gzip -> AES-256-GCM -> base64）");
console.log("  明文 " + (minified.length / 1024).toFixed(0) + " KB -> gzip " + (gz.length / 1024).toFixed(0) +
  " KB -> 密文 " + (ct.length / 1024).toFixed(0) + " KB");
console.log("  产物 js/data.enc.js " + (b64 / 1024).toFixed(0) + " KB（base64）");
