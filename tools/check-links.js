#!/usr/bin/env node
/* 批量体检 applyLink：node tools/check-links.js */
const { execFile } = require("child_process");
const fs = require("fs");

global.window = {};
new Function(fs.readFileSync(require("path").join(__dirname, "..", "js", "data.js"), "utf8"))();
const companies = window.DATA.companies;

const urls = [...new Set(companies.map(c => c.applyLink).filter(Boolean))];
console.log(`共 ${urls.length} 个唯一链接`);

function check(u) {
  return new Promise(resolve => {
    execFile("curl", ["-s", "-o", "/dev/null", "-L", "--max-time", "15",
      "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "-x", "http://127.0.0.1:7897",
      "-w", "%{http_code}", u],
      { timeout: 20000 }, (err, stdout) => {
        resolve({ url: u, code: err ? "ERR" : stdout.trim() });
      });
  });
}

(async () => {
  const results = [];
  for (const u of urls) {           // 串行避免触发反爬
    const r = await check(u);
    results.push(r);
    console.log((r.code === "200" ? "OK " : "BAD") + " [" + r.code + "] " + u);
  }
  fs.writeFileSync(require("path").join(__dirname, "link-report.json"), JSON.stringify(results, null, 1));
  const bad = results.filter(r => r.code !== "200");
  console.log(`\n正常 ${results.length - bad.length}，异常 ${bad.length}`);
})();
