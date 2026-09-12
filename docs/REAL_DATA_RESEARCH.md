# Codex Reset Radar：GitHub 基座与真实数据方案

调研日期：2026-08-23。

## 结论

不建议整体迁移到另一个项目。当前 Electron + React 项目已经具备 macOS/Windows 共用界面、托盘、通知和安装包，最稳的路径是保留现有壳，并接入官方 `codex app-server` 作为账户数据真源。

社交平台数据只应用来预测“额外发放重置卡、异常补偿或大规模额度策略变化”，不应用来推测用户自己的自然重置时间。用户个人额度、自然重置时间和重置卡库存都有更准确的官方本地接口。

## 候选项目

| 项目 | 价值 | 限制 | 建议 |
| --- | --- | --- | --- |
| [openai/codex](https://github.com/openai/codex) | 官方 `app-server` 提供账户、额度窗口、重置时间、重置卡、每日用量和 OAuth 登录 | 不是现成雷达 UI；协议会随 CLI 版本演进 | 数据与协议的唯一权威基座 |
| [steipete/CodexBar](https://github.com/steipete/CodexBar) | MIT，成熟度高，20k+ stars；OAuth、CLI RPC、历史扫描、通知与隐私设计完整 | 主界面是 macOS Swift，不能直接承担 Windows 版本 | 作为生产级架构和容错参考，不整体 fork |
| [gooderno1/codex-usage-core](https://github.com/gooderno1/codex-usage-core) | MIT、TypeScript；专门实现 5H/周窗口、reset 确认、重置卡观测与过期推断 | 项目年轻，尚未正式发布 npm；部分路径使用非公开 `wham/usage` | 最适合作为 reset 算法参考；若依赖应固定 Git commit/tag |
| [dontcallmejames/CodexBar-Windows](https://github.com/dontcallmejames/CodexBar-Windows) | MIT、WinUI 3、Windows 托盘/DPAPI/签名发布经验丰富 | Windows/.NET 专用 | 参考 Windows 原生行为和签名发布链 |
| [harry-busy/CodexBar-windows](https://github.com/harry-busy/CodexBar-windows) | MIT、Tauri 2 + React，与前端形态接近 | Windows 导向、社区验证少、Rust 工具链更重 | 可参考 Provider/刷新架构，不值得迁移现有 Electron 工程 |
| [Nirlep5252/CodexBarWindows](https://github.com/Nirlep5252/CodexBarWindows) | 使用 Codex app-server，包含多样本共识和历史图表 | 仓库未看到明确 LICENSE，不能默认复制源码 | 只参考公开设计说明，未澄清许可前不复用代码 |
| [spojma/codex-usage-bar](https://github.com/spojma/codex-usage-bar) | 最小化展示 app-server 额度窗口 | 单提交、无明确 LICENSE、仅 macOS | 可做协议冒烟参考，不作基座 |

## 官方真实数据路径

官方文档：[codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)。

### 账户和额度

启动本机已安装的 `codex app-server --stdio`，通过 JSONL 完成：

1. `initialize`；
2. `initialized` 通知；
3. `account/read`；
4. `account/rateLimits/read`；
5. `account/usage/read`。

关键字段：

- `rateLimits.primary/secondary.usedPercent`：已用百分比；
- `windowDurationMins`：识别 5 小时、周、月或模型专属窗口；
- `resetsAt`：服务端给出的精确自然重置 Unix 时间；
- `rateLimitsByLimitId`：Codex、Spark 等多个额度池；
- `rateLimitResetCredits.availableCount`：权威可用卡总数；
- `rateLimitResetCredits.credits[]`：卡 ID、发放时间、到期时间和状态；
- `account/rateLimits/updated`：运行期间的额度变化通知。

当前项目已实现只读适配器 `electron/codex-app-server.cjs`。它不读取 `auth.json`，不返回令牌，不发送模型请求，也不消耗额度。

### 登录

使用 `account/login/start`，推荐两种官方流程：

- `type: "chatgpt"`：返回 `authUrl`，在系统浏览器完成 OAuth；
- `type: "chatgptDeviceCode"`：返回 `verificationUrl` 和 `userCode`。

令牌由 Codex 保存和刷新，雷达不应自己保存 GPT 密码、OAuth refresh token 或浏览器 Cookie。

### 使用重置卡

官方提供 `account/rateLimitResetCredit/consume`。这是有后果的写操作，产品必须：

1. 展示将使用哪张卡及到期时间；
2. 用户明确点击确认；
3. 为一次逻辑操作生成并复用同一 idempotency key；
4. 成功后重新调用 `account/rateLimits/read`，不能本地猜测新额度。

绝不能在后台自动消费重置卡。

## Reset 历史与月度统计

每次轮询保存结构化快照，不保存 prompt 或模型输出。建议字段：

```text
observed_at, account_scope, limit_id, window_minutes,
used_percent, resets_at, available_credit_count
```

事件识别规则：

- 自然窗口滚动：`resetsAt` 后移且窗口时长一致；
- 额度回落：`usedPercent` 明显下降；
- 重置卡使用：卡库存下降，同时至少一个额度窗口回落/边界后移；
- 卡发放：`availableCount` 增加；
- 卡过期：库存下降，但没有额度回落，并且接近已知 `expiresAt`；
- 证据不足：标为 `decrease-unknown`，不要武断计为使用。

月度图应分开显示“自然窗口重置”“重置卡使用”“官方补偿/发卡”，否则 5 小时自然滚动会淹没真正有价值的事件。

## 社交与公开信号

### X

可用官方 [Recent Search API](https://docs.x.com/x-api/posts/search-recent-posts)，查询最近 7 天内容，并使用 `since_id` 增量轮询。建议关键词：

```text
("Codex reset" OR "Codex quota" OR "usage reset" OR "Codex 额度" OR "重置卡") -is:retweet
```

需要开发者项目与 Bearer Token。当前项目已提供 `X_BEARER_TOKEN` 接入口。

### 微博与小红书

截至调研时，没有找到面向普通开发者、可做全站关键词内容搜索的稳定官方开放接口。小红书官方开放平台重点是小程序、商家、交易与授权能力，并非社区笔记搜索。

[MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) 虽可抓取小红书和微博，但许可证明确限制为非商业学习用途，且依赖二维码、Cookie、滑块验证和平台私有 Web 接口，不适合作为可分发商业桌面应用的数据基座。

生产可选方案：

1. 与平台或有内容授权的数据供应商签约；
2. 用户主动提交公开链接，雷达只做本地解析和交叉验证；
3. 监测 OpenAI 官方公告、状态页和 `openai/codex` GitHub issues；
4. 微博/小红书连接保持可插拔，拿到合法数据授权后再开启。

## 推荐架构

```text
Codex app-server ──> Account Truth ──> 额度、精确重置时间、卡库存
本地结构化快照 ──> Reset Detector ──> 月度事件与趋势
X/官方公告/GitHub ─> Signal Engine ──> 额外发卡或异常补偿概率
                                      └─> 通知与托盘
```

账户真值与社区预测必须分开展示：自然重置用确定时间，不显示“70%”；只有无法由官方接口直接确认的额外发卡/补偿活动才显示概率。

## 实施顺序

1. 已完成：只读 app-server 额度、重置时间和重置卡接入；
2. 下一步：持久化额度快照，按事件类型生成真实月度图；
3. 下一步：加入 OAuth/设备码登录 UI；
4. 下一步：加入用户确认后的重置卡消费；
5. 下一步：接入 GitHub/OpenAI 官方公告信号；
6. 有平台授权后再接微博、小红书。
