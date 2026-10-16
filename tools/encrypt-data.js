#!/usr/bin/env node
/* 把 tools/data.json 加密为 js/data.enc.js（AES-256-GCM，密钥由账号+密码派生）
 * 账号密码存 tools/auth.txt（已 gitignore，不进仓库）。用法：node tools/encrypt-data.js */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [user, pass] = fs.readFileSync(path.join(__dirname, "auth.txt"), "utf8").trim().split(/\r?\n/);
// ⚠️ 加密前先压缩：tools/data.json 带缩进是为了人看/diff 方便，
// 但缩进会原样进密文，而 AES-GCM 密文不可压缩——596 家「小而美公司」进来后
// 缩进白白多占了两百多 KB。这里 minify 一下，data.json 仍然保持可读。
const raw = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8")));
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(user + ":" + pass, salt, 150000, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(raw, "utf8"), cipher.final(), cipher.getAuthTag()]);

const out = "/* 加密数据：需登录解密（详见 tools/encrypt-data.js） */\n" +
  "window.ENC_DATA={salt:" + JSON.stringify(salt.toString("base64")) +
  ",iv:" + JSON.stringify(iv.toString("base64")) +
  ",ct:" + JSON.stringify(ct.toString("base64")) + "};\n";
fs.writeFileSync(path.join(__dirname, "..", "js", "data.enc.js"), out, "utf8");
console.log("加密完成：", raw.length, "字节明文（已压缩） ->", ct.length, "字节密文");
console.log("  产物 js/data.enc.js 约", (Math.ceil(ct.length / 3) * 4 / 1024).toFixed(0), "KB（base64）");
