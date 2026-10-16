#!/usr/bin/env node
/* 官网域名实测验证器
 *
 * 用法：node tools/verify-links.js
 *
 * 读 tools/link-candidates-*.txt（公司名 | 页面关键词 | 候选域名…）
 * 逐个实测：HTTP 可达（200）**且**页面正文含关键词，才算通过；一个候选都没通过就不收录。
 * 产出 tools/links.json = { 公司名: 官网地址 }，由 tools/build-data.js 合并进数据。
 *
 * 为什么要"页面含关键词"这一条：域名很好猜，但猜错会指到同名或蹭名的站点。
 * 只认「能打开 + 确实出现公司名」的，宁可少收也不收错。
 */
const fs = require("fs");
const path = require("path");

const SRC = __dirname;
const OUT = path.join(__dirname, "links.json");
const REPORT = path.join(__dirname, "link-verify-report.txt");
const PROXY = process.env.HTTPS_PROXY || "http://127.0.0.1:7897";   // 境外站点兜底（本机代理）
const TIMEOUT = 20000;
const CONC = 8;

/* 第二层：人工确认的官网域名（tools/link-manual.txt）
 * 这类只做「可达性实测」（HTTP 200），不要求页面出现关键词——原因是英文站/纯 JS 站/本机网络不通，
 * 但域名本身唯一且权威（如 huawei.com、sgcc.com.cn、wuxi apptec）。 */
function readManual() {
  const p = path.join(__dirname, "link-manual.txt");
  if (!fs.existsSync(p)) return [];
  const out = [];
  fs.readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const c = t.split("|").map(x => x.trim());
    if (c.length < 2) return;
    out.push({ name: c[0], keyword: "", urls: [c[1]], why: c[2] || "", src: "link-manual.txt:" + (i + 1) });
  });
  return out;
}

function readCandidates() {
  const files = fs.readdirSync(SRC).filter(f => /^link-candidates-\d+\.txt$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    fs.readFileSync(path.join(SRC, f), "utf8").split(/\r?\n/).forEach((line, i) => {
      const s = line.trim();
      if (!s || s.startsWith("#")) return;
      const c = s.split("|").map(x => x.trim());
      if (c.length < 3) { console.error(`⚠️ ${f}:${i + 1} 列数不足，跳过：${s.slice(0, 30)}`); return; }
      out.push({ name: c[0], keyword: c[1], urls: c.slice(2).filter(Boolean), src: f + ":" + (i + 1) });
    });
  }
  return out;
}

async function fetchOnce(url, useProxy) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  const args = ["-sL", "--max-time", "18", "-A",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    "-w", "\n@@@%{http_code}", url];
  if (useProxy) args.splice(0, 0, "-x", PROXY);
  try {
    const { execFile } = require("child_process");
    const stdout = await new Promise(res => {
      execFile("curl", args, { maxBuffer: 20 * 1024 * 1024, timeout: 25000, encoding: "utf8" },
        (err, so) => res(err && !so ? "" : so));
    });
    clearTimeout(t);
    if (!stdout) return null;
    const idx = stdout.lastIndexOf("@@@");
    if (idx < 0) return null;
    const code = stdout.slice(idx + 3).trim();
    return { code: code, body: stdout.slice(0, idx) };
  } catch (e) { clearTimeout(t); return null; }
}

async function probe(item) {
  for (const raw of item.urls) {
    const url = /^https?:\/\//.test(raw) ? raw : "https://" + raw;
    for (const useProxy of [false, true]) {
      const r = await fetchOnce(url, useProxy);
      if (!r) continue;
      const okCode = r.code === "200";
      const hit = r.body.indexOf(item.keyword) >= 0;
      if (okCode && hit) {
        return { url: url, code: r.code, via: useProxy ? "proxy" : "direct", hit: true };
      }
      if (okCode && !hit) return { url: url, code: r.code, via: useProxy ? "proxy" : "direct", hit: false, why: "页面未出现关键词「" + item.keyword + "」" };
      if (!okCode) return { url: url, code: r.code, via: useProxy ? "proxy" : "direct", hit: false, why: "HTTP " + r.code };
      break; // 直连拿到了但没命中，不必再走代理
    }
  }
  return null;
}

const FORCE = process.argv.indexOf("--force") >= 0;

(async () => {
  const all = readCandidates();
  // 增量：已在 links.json 里的不再重复实测（要全量重测加 --force）
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const items = FORCE ? all : all.filter(x => !done[x.name]);
  console.log("候选公司 " + all.length + " 家，本次需实测 " + items.length + " 家（已缓存 " + (all.length - items.length) + " 家）…\n");
  let i = 0;
  const results = [];
  const lines = [];
  async function worker() {
    while (i < items.length) {
      const it = items[i++];
      const r = await probe(it);
      results.push({ it, r });
      const tag = r && r.hit ? "OK  " : "MISS";
      lines.push(tag + " " + it.name.padEnd(18) + (r ? (r.code + " " + (r.hit ? "" : r.why + " ") + r.url) : "全部候选不可达"));
      if (results.length % 50 === 0) console.log("…已测 " + results.length + "/" + items.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // 第二层：人工确认清单，只验「服务器是否有响应」
  // 标准与原作者保留 403/412 链接一致：只要服务器回了 HTTP 状态码（含 WAF 拦截）就算活着；
  // 000（连不上）或 DNS 解析不了的一律不收——"看着像"的域名可能是错的（实测 tí 到过解析到境外 IP 的假域名）。
  const manual = readManual().filter(x => !done[x.name]);
  if (manual.length) {
    console.log("\n人工确认清单 " + manual.length + " 条，验服务器是否有响应…");
    let mi = 0;
    const mres = [];
    async function mworker() {
      while (mi < manual.length) {
        const it = manual[mi++];
        const url = it.urls[0];
        const r = await fetchOnce(url, false) || await fetchOnce(url, true);
        mres.push({ it: it, r: r });
      }
    }
    await Promise.all(Array.from({ length: 6 }, mworker));
    for (const x of mres) {
      const alive = x.r && x.r.code && x.r.code !== "000";
      lines.push((alive ? "MANUAL-OK  " : "MANUAL-BAD ") + x.it.name.padEnd(18) + (x.r ? x.r.code + " " : "无响应 ") + x.it.urls[0]);
      if (alive) results.push({ it: x.it, r: { url: x.it.urls[0], code: x.r.code, hit: true, via: "manual" } });
      else console.log("  ⚠️ 连不上/解析失败，未收录：" + x.it.name + " " + x.it.urls[0]);
    }
  }

  const ok = results.filter(x => x.r && x.r.hit);
  // 合并而不是覆盖：保住上一轮/渲染复验已确认的结果
  const map = Object.assign({}, done);
  ok.forEach(x => { map[x.it.name] = x.r.url; });
  fs.writeFileSync(OUT, JSON.stringify(map, null, 1), "utf8");
  fs.writeFileSync(REPORT, lines.sort().join("\n"), "utf8");

  const byCat = {};
  results.forEach(x => { byCat[x.it.src] = byCat[x.it.src] || { all: 0, ok: 0 }; byCat[x.it.src].all++; if (x.r && x.r.hit) byCat[x.it.src].ok++; });
  console.log("\n实测结果：");
  Object.keys(byCat).forEach(k => console.log("  " + k + "  " + byCat[k].ok + "/" + byCat[k].all));
  console.log("\n共实测 " + items.length + " 家，验证通过 " + ok.length + " 家 → " + path.relative(process.cwd(), OUT));
  const viaProxy = ok.filter(x => x.r.via === "proxy").length;
  if (viaProxy) console.log("（其中 " + viaProxy + " 家直连不通、需经代理访问）");
  console.log("详细结果见 " + path.relative(process.cwd(), REPORT));
})();
