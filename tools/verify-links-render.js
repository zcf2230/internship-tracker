#!/usr/bin/env node
/* 官网域名第二轮验证：用浏览器内核（Edge 无头）渲染后复验
 *
 * 用法：node tools/verify-links-render.js
 *
 * 背景：第一轮（tools/verify-links.js）用 curl 抓首屏 HTML，对 SPA 站点会误判——
 * 域名其实是对的（能返回 200），但公司名是 JS 渲染出来的，原文里搜不到。
 * 这一轮把那些「200 但没搜到关键词」的和「被 WAF 拦（403/412）」的候选丢给 Edge 无头渲染，
 * 在渲染后的 DOM 里再搜一次关键词；命中就补进 tools/links.json。
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const REPORT = path.join(__dirname, "link-verify-report.txt");
const OUT = path.join(__dirname, "links.json");
const CONC = 3;
const BUDGET = 9000;

function parseReport() {
  const out = [];
  fs.readFileSync(REPORT, "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^MISS\s+(.+?)\s{2,}(\d{3})\s+(.+?)\s+(https?:\/\/\S+)$/);
    if (!m) return;
    const code = m[2];
    // 只复验「页面拿到了」（200/403/412/521）与「被 WAF 拦」的；连不上的（000）说明域名本身不对，不必渲染
    if (!/^(200|403|412|521)$/.test(code)) return;
    const why = m[3];
    const kw = (why.match(/关键词「(.+?)」/) || [])[1];
    out.push({ name: m[1], code: code, keyword: kw || "", url: m[4] });
  });
  return out;
}

function renderAndGrep(url, keyword) {
  return new Promise(resolve => {
    const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--disable-extensions", "--virtual-time-budget=" + BUDGET, "--dump-dom", url];
    execFile(EDGE, args, { maxBuffer: 60 * 1024 * 1024, timeout: 45000, encoding: "utf8" },
      (err, stdout) => {
        const html = stdout || "";
        if (!keyword) { resolve({ ok: html.length > 3000, len: html.length, why: "无关键词可比对，仅看渲染是否成功" }); return; }
        const hit = html.indexOf(keyword) >= 0;
        resolve({ ok: hit && html.length > 1000, len: html.length, why: hit ? "渲染后命中关键词" : "渲染后仍未出现关键词" });
      });
  });
}

(async () => {
  const items = parseReport();
  console.log("待复验 " + items.length + " 条（含 SPA 与 WAF 拦截）…");
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  let i = 0;
  const gained = [];
  const logs = [];
  async function worker() {
    while (i < items.length) {
      const it = items[i++];
      const r = await renderAndGrep(it.url, it.keyword);
      if (r.ok) {
        gained.push(it);
        logs.push("OK   " + it.name.padEnd(18) + it.url + "  （" + r.why + "）");
      } else {
        logs.push("MISS " + it.name.padEnd(18) + it.url + "  （" + r.why + "）");
      }
      if (logs.length % 10 === 0) console.log("…已复验 " + logs.length + "/" + items.length + "，新增 " + gained.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  gained.forEach(it => { existing[it.name] = it.url; });
  fs.writeFileSync(OUT, JSON.stringify(existing, null, 1), "utf8");
  fs.writeFileSync(path.join(__dirname, "link-verify-render-report.txt"), logs.sort().join("\n"), "utf8");
  console.log("\n二轮复验：新增 " + gained.length + " 家");
  console.log("links.json 现有 " + Object.keys(existing).length + " 家");
  console.log("明细见 tools/link-verify-render-report.txt");
})();
