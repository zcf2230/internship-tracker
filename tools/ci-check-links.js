#!/usr/bin/env node
/*
 * 官网链接巡检（给 GitHub Actions 每日跑，也能本地手动跑）
 *
 * 用法：
 *   node tools/ci-check-links.js            # 全量 542 条
 *   node tools/ci-check-links.js --limit 20 # 只测前 20 条（冒烟测试）
 *
 * 干什么：把 js/data.enc.js 里的官网直链逐条请求一遍，把「连续多天都连不上」的
 * 标记出来，写进 js/link-status.json。网页端读到这个文件后，
 * 会在对应公司卡片上显示「⚠️ 官网链接可能失效」。
 *
 * 为什么不写成 AI 爬虫：这里**不需要理解页面内容**，只需要判断「服务器有没有响应」，
 * 所以是零 AI token、零 API key、零外部依赖的纯 Node 脚本。
 *
 * 判定标准（故意定得很保守，避免误伤）：
 *   - 只要服务器回了**任何** HTTP 状态码（含 403/412/429/500 这类 WAF/反爬拦截）都算「活着」，
 *     与原作者保留 403/412 链接的做法一致；
 *   - 只有 DNS 解析失败 / 连接被拒 / TLS 失败 / 两次尝试都超时，才算「连不上」；
 *   - 连续 **3 天**连不上才标为 bad（页面上会提示），1–2 天只记为 warn（先观察，不提示）。
 *     GitHub 的 runner 在境外，国内部分站点对境外 IP 不友好，3 次连败可以把这类误伤滤掉。
 *
 * 隐私：js/link-status.json 只含公司 **id**（形如 brokers-0 的不透明编号）、
 *       连续失败天数和日期——**没有公司名、没有 URL**，可以安全地放进公开仓库。
 *
 * 凭据：解密密文需要站点的账号密码。
 *   - 本地：读 tools/auth.txt（已 gitignore）；
 *   - CI：读环境变量 SITE_USER / SITE_PASS（仓库 Secrets）。
 *     两个都没有时脚本直接退出（退出码 0），让 Actions 安静跳过，而不是每天报错。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const ENC = path.join(ROOT, "js", "data.enc.js");
const OUT = path.join(ROOT, "js", "link-status.json");
const CONCURRENCY = 10;
const TIMEOUT = 12000;
const TRIES = 2;
const BAD_AFTER = 3;          // 连续失败多少天标为 bad

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;

function die(msg) { console.error("❌ " + msg); process.exit(1); }

/* ---- 解密（与 tools/check-data.js 同一套）---- */
function decrypt() {
  const user = process.env.SITE_USER, pass = process.env.SITE_PASS;
  let cred;
  if (user && pass) {
    cred = [user, pass];
    console.log("凭据来源：环境变量 SITE_USER / SITE_PASS");
  } else {
    const authPath = path.join(ROOT, "tools", "auth.txt");
    if (!fs.existsSync(authPath)) return null;   // CI 上没配 Secret：安静跳过
    cred = fs.readFileSync(authPath, "utf8").trim().split(/\r?\n/);
    console.log("凭据来源：tools/auth.txt（本地）");
  }
  const src = fs.readFileSync(ENC, "utf8");
  const m = src.match(/salt:"([^"]+)",iv:"([^"]+)",ct:"([^"]+)"/);
  if (!m) die("js/data.enc.js 格式不对");
  const key = crypto.pbkdf2Sync(cred[0] + ":" + cred[1], Buffer.from(m[1], "base64"), 150000, 32, "sha256");
  const ct = Buffer.from(m[3], "base64");
  const dec = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(m[2], "base64"));
  dec.setAuthTag(ct.slice(ct.length - 16));
  const plain = Buffer.concat([dec.update(ct.slice(0, ct.length - 16)), dec.final()]);
  const txt = /zip:"gzip"/.test(src) ? zlib.gunzipSync(plain).toString("utf8") : plain.toString("utf8");
  return JSON.parse(txt);
}

/* 用 node:https 而不是 fetch：有些老牌机构（国信、国泰海通这类）的网站还在用
 * 旧式 TLS 重协商或过期证书链，Node 默认会直接拒连，但浏览器是能正常打开的——
 * 我们要回答的问题只是「服务器活不活着」，所以这里按浏览器的宽容程度来：
 *   允许旧式重协商（SSL_OP_LEGACY_SERVER_CONNECT）+ 不校验证书链 + 手动跟随跳转。
 * 这不是降低安全标准，恰恰是为了少误报。 */
const https = require("https");
const http = require("http");
const AGENT = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  keepAlive: true, maxSockets: CONCURRENCY
});
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

function rawGet(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, why: "URL格式错误" }); }
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(u, { method: "GET", agent: u.protocol === "http:" ? undefined : AGENT,
      // insecureHTTPParser：有些站点响应头不完全符合 RFC（Node 默认直接报错断连），
      // 浏览器是容忍的。我们只读状态码，放宽解析不会带来风险。
      insecureHTTPParser: true,
      headers: { "User-Agent": UA, "Accept": "*/*" }, timeout: TIMEOUT }, (res) => {
      res.resume();   // 把响应读完，连接才能复用
      resolve({ ok: true, code: String(res.statusCode), location: res.headers.location });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, why: "超时" }); });
    req.on("error", (e) => resolve({ ok: false, why: String(e.code || e.message).slice(0, 30) }));
    req.end();
  });
}

/* 不跟随跳转：只要原服务器回了任何状态码（含 301/302/403），就足以证明它活着。
   实测跟随跳转反而引入误报——有的跳转目标会直接重置连接（如 swhysc.com），
   让本来活着的站点被记成「连不上」。 */
async function fetchOnce(url) {
  return rawGet(url);
}

/* 带 2 次重试的探测：第一次失败多半是抖动/超时，第二次再失败才记为连不上 */
async function check(url) {
  for (let i = 0; i < TRIES; i++) {
    const r = await fetchOnce(url);
    if (r.ok) return { alive: true, code: r.code };
    if (i === TRIES - 1) return { alive: false, why: r.why };
  }
}

(async () => {
  const data = decrypt();
  if (!data) {
    console.log("⚠️ 未提供 SITE_USER / SITE_PASS，也没有本地 auth.txt —— 跳过巡检（首次配置见 README）");
    process.exit(0);
  }
  let list = data.companies.filter(c => c.applyLink && /^https?:\/\//.test(c.applyLink))
    .map(c => ({ id: c.id, url: c.applyLink }));
  if (LIMIT > 0) list = list.slice(0, LIMIT);
  console.log("待巡检 " + list.length + " 条官网直链（并发 " + CONCURRENCY + "，单条超时 " + TIMEOUT / 1000 + "s）\n");

  // 上一轮结果：连续失败天数要累加，不能清零重数
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { entries: {} };
  const prevEntries = prev.entries || {};

  let i = 0, alive = 0, dead = 0;
  const entries = {};
  const failures = [];
  async function worker() {
    while (i < list.length) {
      const it = list[i++];
      const r = await check(it.url);
      if (r.alive) { alive++; continue; }
      dead++;
      const was = prevEntries[it.id] || {};
      const f = (was.s === "bad" || was.s === "warn" ? (was.f || 0) : 0) + 1;
      const state = f >= BAD_AFTER ? "bad" : "warn";
      entries[it.id] = { s: state, f: f, first: was.first || new Date().toISOString().slice(0, 10), why: r.why };
      failures.push(state.toUpperCase() + " " + String(f).padStart(2) + " 天  " + it.id + "  " + it.url + "  (" + r.why + ")");
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const bad = Object.values(entries).filter(e => e.s === "bad").length;
  const out = {
    checkedAt: new Date().toISOString(),
    summary: { total: list.length, ok: alive, warn: dead - bad, bad: bad },
    entries: entries
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n", "utf8");

  console.log("完成：" + alive + " 存活 / " + dead + " 连不上，用时 " + secs + "s");
  if (dead) {
    console.log("\n连续连不上的（bad = 已在页面提示，warn = 继续观察满 " + BAD_AFTER + " 天才提示）：");
    failures.sort().forEach(l => console.log("  " + l));
  } else {
    console.log("全部存活 ✔");
  }
  console.log("\n结果已写入 " + path.relative(ROOT, OUT) +
    "（只含公司 id 与失败天数，无公司名无 URL，可进公开仓库）");
})();
