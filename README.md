# 金融实习网申通

2027 寒假实习（+日常/远程/PTA/暑期）网申时间一站式查询站。静态网页，零依赖，部署在 GitHub Pages。

**线上地址**：https://zcf2230.github.io/internship-tracker/

## 功能

- **公司库**：729 家机构的网申批次、用人要求、笔试面试流程、薪资食宿、留用情况、官网直达链接
- **「小而美公司」分类（596 家）**：体量不大但在细分领域有口碑的机构 —— 量化私募、精品投行/FA、中小券商研究所、精品咨询、评级、消费金融、融资租赁、小而美银行、保险与资管等 16 个细分；每家列出**主营方向 / 适合投递的岗位 / 体量量级 / 投递入口**
- **倒计时提醒**：按往年时间推算今年窗口，自动标注「预计开放中 / N 天后开放 / 已截止」，紧急高亮
- **时间轴视图**：2026.09 – 2027.03 全部网申窗口铺在一条时间线上
- **投递进度**：每家公司可标记 未投递→网申→笔试→面试→Offer/放弃，数据存本机浏览器
- **多条件筛选**：行业、城市、批次、本科可投、是否有笔试、杭州相关、投递进度
- **渠道与内推**：官方招聘公众号、权威信息平台、内推机制说明
- **笔面试攻略**：券商 / 公募PE-VC / 银行 / 四大 / 咨询PTA / 大厂数据岗 六类攻略

## 数据管线

明文源数据（**都不进仓库**，`.gitignore` 里排除）

```
tools/raw/*.json          ← 手工/调研产出的原始数据（brokers / funds / banks / big4 / dachang / region / …）
tools/raw/smallbeauty.json ← ⭐「小而美公司」596 家，由下面的脚本生成
tools/sbc-src.txt          ← ⭐「小而美公司」人工维护源文件（管道分隔，比 JSON 好改）
tools/auth.txt             ← 登录账号密码（加密用）
```

三步构建：

```bash
node tools/build-smallbeauty.js   # sbc-src.txt -> tools/raw/smallbeauty.json（仅「小而美公司」）
node tools/build-data.js          # raw/*.json -> tools/data.json（合并 + 去重 + 打标签）
node tools/encrypt-data.js        # data.json -> js/data.enc.js（AES-256-GCM，加密前先压缩）
node tools/check-data.js          # 自检：解密并核对条数 / 重复 / 字段完整性（无依赖）
```

> ⚠️ 改完 `tools/data.json` **必须重跑 `encrypt-data.js`**，否则网页上是旧数据（`check-data.js` 会帮你发现）。
> 只在本地看效果不想加密时，也可直接跑 `python -m http.server 8765`，但线上数据是密文版。

### 「小而美公司」怎么维护

1. 编辑 `tools/sbc-src.txt`，每行一家：
   `id | 公司名 | 细分分类 | 城市 | 规模量级 | 主营业务 | 适合投递方向 | 备注`
2. 跑 `node tools/build-smallbeauty.js`（会校验列数、细分分类、id 唯一）。
3. 再跑 `build-data.js` + `encrypt-data.js`。

**合并规则**（`build-data.js` 里实现）：名单里与已有公司**重名的不会重复建卡**——
保留原有条目（信息更完整），只在它身上加一个 tag「小而美公司」，所以筛选时两边都能命中。
新增条目的「用人要求」等共性内容不在数据里逐条重复，而是放在 `js/app.js` 的 `SB_DEFAULTS` 里按细分领域兜底，
逐家拿到官方口径时，直接写进数据即可覆盖。

## 如何自己更新数据

数据现在走上面的管线。历史写法（直接编辑 `js/data.js`）已废弃——该文件在 `.gitignore` 中，仓库只存密文 `js/data.enc.js`。

1. `companies` 数组：每家公司一个对象。批次时间写模糊时间即可（如 `"约10月中旬"`），网站会自动换算成倒计时；写 `"全年滚动"` 则标记为常年招聘。
2. `channels` / `guides`：内推渠道与攻略文本。
3. 改完推送到 GitHub，几分钟后线上自动生效（GitHub Pages 部署）。

## 本地预览

```bash
python -m http.server 8765
# 打开 http://127.0.0.1:8765
```

## 数据免责声明

时间为**往年网申时间整理推算**，仅供参考；每年批次会有浮动，投递前务必以各公司官方招聘渠道最新公告为准。每家公司卡片标注了信息来源与可信度。
