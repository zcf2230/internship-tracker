#!/usr/bin/env node
/* 双公共DNS验证所有 applyLink + 渠道链接域名：node tools/dns-check.js */
const dns = require("dns");
const fs = require("fs");
const path = require("path");

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, "..", "js", "data.js"), "utf8"))();
const companies = window.DATA.companies;
const channels = window.DATA.channels || {};

function check(host) {
  return new Promise(resolve => {
    let votes = 0, servers = 0;
    const r1 = new dns.Resolver(); r1.setServers(["223.5.5.5"]);
    const r2 = new dns.Resolver(); r2.setServers(["119.29.29.29"]);
    const done = () => { if (++servers === 2) resolve(votes); };
    const q = (res) => res.resolve4(host, (e, a) => { if (!e && a && a.length) votes++; done(); });
    q(r1); q(r2);
    setTimeout(() => resolve(votes), 8000); // 兜底超时
  });
}

(async () => {
  const hosts = new Map(); // host -> [公司名/用途]
  companies.forEach(c => {
    const m = String(c.applyLink || "").match(/^https?:\/\/([^\/]+)/);
    if (m) { const h = m[1]; if (!hosts.has(h)) hosts.set(h, []); hosts.get(h).push(c.name); }
  });
  (channels.official || []).forEach(o => {
    const m = String(o.url || "").match(/^https?:\/\/([^\/]+)/);
    if (m) { const h = m[1]; const k = "渠道:" + o.org; if (!hosts.has(h)) hosts.set(h, []); if (!hosts.get(h).some(x => x.startsWith("渠道:"))) hosts.get(h).push(k); }
  });

  const dead = [];
  console.log("检查 " + hosts.size + " 个域名（双DNS投票，0/2=死链）");
  for (const [h, owners] of hosts) {
    const v = await check(h);
    const mark = v === 0 ? "DEAD" : v === 1 ? "FLAKY" : "OK";
    console.log(mark + " (" + v + "/2) " + h + "  <- " + owners.join(","));
    if (v === 0) dead.push({ host: h, owners });
  }
  fs.writeFileSync(path.join(__dirname, "dns-dead.json"), JSON.stringify(dead, null, 1));
  console.log("\n死链 " + dead.length + " 个");
})();
