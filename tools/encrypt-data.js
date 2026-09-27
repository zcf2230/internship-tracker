#!/usr/bin/env node
/* 把 tools/data.json 加密为 js/data.enc.js（AES-256-GCM，密钥由账号+密码派生）
 * 账号密码存 tools/auth.txt（已 gitignore，不进仓库）。用法：node tools/encrypt-data.js */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [user, pass] = fs.readFileSync(path.join(__dirname, "auth.txt"), "utf8").trim().split(/\r?\n/);
const raw = fs.readFileSync(path.join(__dirname, "data.json"), "utf8");
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
console.log("加密完成：", raw.length, "字节明文 ->", ct.length, "字节密文");
