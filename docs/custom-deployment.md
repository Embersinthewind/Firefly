# Firefly 定制版部署与使用指南

本文档适用于 `Embersinthewind/Firefly` 定制分支。上游 Firefly 的通用主题配置仍可参考 [CuteLeaf/Firefly 文档](https://docs-firefly.cuteleaf.cn/)，本文只说明本分支新增的主页、作者功能、GitHub 发布和 K-Vault 图片服务。

## 1. 定制版组成

```text
访客浏览器
   │
   ├── 静态页面、文章、项目与音乐页 ── Cloudflare Worker Assets
   │
作者浏览器
   │  同域 /api/author/*（密码会话）
   ▼
Firefly Cloudflare Worker
   ├── GitHub Contents API ── 更新文章及站点 JSON ── 触发 main 重新部署
   └── K-Vault /api/v1/upload ── 上传正文图片和文章封面
```

主要入口：

| 地址 | 用途 |
| --- | --- |
| `/` | 个人项目主页，展示 GitHub 项目和能力矩阵 |
| `/articles/` | 分页文章列表与分类筛选 |
| `/categories/` | 文章分类 |
| `/archive/` | 兼容旧分类与标签链接的筛选页，不再显示在文章导航中 |
| `/write/` | Markdown 写作、导入导出、预览与发布 |
| `/config/` | 站点、个人资料、项目和写作设置 |
| `/navigation/` | 网站导航 |
| `/music/` | 沉浸式音乐页面 |

## 2. 本地运行

环境要求：Node.js 22 或更高版本、pnpm 9 或更高版本。

```bash
git clone https://github.com/Embersinthewind/Firefly.git
cd Firefly
pnpm install
pnpm dev
```

默认访问地址为 `http://localhost:4321`。若端口已被占用，可使用：

```bash
pnpm dev --host 127.0.0.1 --port 4325
```

提交前常用检查：

```bash
pnpm check
pnpm type-check
pnpm build
```

## 3. 部署到 Cloudflare

本分支不是单纯的静态 Pages 项目。`worker/index.ts` 同时提供作者 API，`wrangler.jsonc` 将 `dist` 作为静态资源并让 `/api/author/*` 优先进入 Worker。

推荐配置：

| 项目 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 构建命令 | `pnpm build` |
| 部署命令 | `npx wrangler deploy` |
| Node.js | 22 或更高版本 |

`wrangler.jsonc` 已包含公开且可提交的仓库信息：

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `GITHUB_SITE_PATH`
- `GITHUB_PROFILE_PATH`
- `GITHUB_PORTFOLIO_PATH`
- `GITHUB_NAVIGATION_PATH`
- `GITHUB_POSTS_DIR`

若复制本仓库建立自己的站点，请把其中的仓库所有者、仓库名称和文件路径改成自己的值。

### Cloudflare Secrets

在 Cloudflare Dashboard 打开：

`Workers & Pages → firefly → Settings → Variables and Secrets → Add`

添加以下 Secret，**不要把值写进 `wrangler.jsonc` 或提交到 GitHub**：

| 名称 | 类型 | 要求 |
| --- | --- | --- |
| `GITHUB_TOKEN` | Secret | GitHub Fine-grained Token |
| `AUTHOR_PASSWORD` | Secret | 作者登录密码，至少 8 个字符 |
| `AUTHOR_SESSION_SECRET` | Secret | 会话签名随机密钥，至少 32 个字符，建议 64 个 |
| `AUTHOR_NAME` | Plaintext，可选 | 登录后显示的作者名称 |

可用 PowerShell 生成 64 字符的会话密钥：

```powershell
([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
```

保存变量后重新部署 Worker。作者成功登录后，浏览器会获得一个有效期 30 天的 `HttpOnly` 签名 Cookie；GitHub Token 不会发送到浏览器。

更完整的安全说明见 [Cloudflare 作者代理配置](./cloudflare-author-proxy.md)。

## 4. GitHub Token 权限

推荐使用 Fine-grained personal access token：

1. Resource owner 选择仓库所有者。
2. Repository access 选择 `Only select repositories`。
3. 只勾选需要发布的 `Firefly` 仓库。
4. Repository permissions 中设置 `Contents: Read and write`。
5. `Metadata: Read-only` 会由 GitHub 自动保留。
6. 生成 Token 后，把完整值保存为 Cloudflare 的 `GITHUB_TOKEN` Secret，再重新部署。

作者 API 只允许写入 `wrangler.jsonc` 中列出的配置文件和文章目录，并会拒绝跨站写入。仓库是组织仓库且启用了 SSO 时，还需要为 Token 完成组织授权。

## 5. 作者登录与发布

1. 打开 `/write/`、`/config/` 或 `/navigation/`。
2. 点击作者登录，输入 `AUTHOR_PASSWORD`。
3. 在 `/write/` 填写标题、摘要、标签、分类和发布日期。
4. 正文支持 Markdown、导入已有 MD、浏览器草稿、预览和导出。
5. 粘贴、拖入或选择图片时，会在配置完成后自动上传到 K-Vault。
6. 点击“发布文章”后，Worker 通过 GitHub Contents API 写入 `src/content/posts`。
7. 新提交触发 Cloudflare 对 `main` 的构建，构建成功后文章上线。

草稿只写入仓库但不会出现在生产文章列表。文章地址根据标题自动生成，不需要手动填写 Slug；浏览量由站点统计逻辑维护，不在编辑器中手动设置。

## 6. K-Vault 图片服务

[K-Vault](https://github.com/Embersinthewind/K-Vault) 是独立图片服务。本项目不会在 Firefly 的构建中启动 K-Vault。

### 部署要求

- 在线博客必须连接一个公网可访问的 `HTTPS` K-Vault 地址。
- `localhost:8080` 或局域网地址只适合本机测试；关闭本地 Docker 后线上博客无法访问它。
- 可以将 K-Vault 独立部署到 Cloudflare，并配置 Telegram 等存储源。
- K-Vault 访问令牌需要具备上传权限。

K-Vault 自身使用的 Telegram Bot Token、管理密钥等应保存在 K-Vault 项目的 Cloudflare `Variables and Secrets` 中，而不是放入 Firefly 仓库。

### 在 Firefly 中连接

作者登录后进入：

`站点设置 → 写作设置 → K-Vault 图片自动上传`

填写：

| 字段 | 示例 | 说明 |
| --- | --- | --- |
| K-Vault 地址 | `https://img.example.com` | 不要填写末尾 API 路径 |
| API Token | K-Vault 生成的令牌 | 仅保存在当前浏览器 |
| 存储源 | `telegram` | 必须与 K-Vault 已配置存储源一致 |
| 上传目录 | `blog` | 图片在存储源中的目录 |
| 返回链接 | 图片直链 | 正文通常使用直链 |

点击保存后，配置写入当前浏览器的 `localStorage`，不会提交到 GitHub。清理浏览器数据、使用隐私窗口或更换设备后需要重新填写。

上传流程为：浏览器把图片和临时 K-Vault 配置提交到同域 Firefly Worker，Worker 再请求 `${K_VAULT_ADDRESS}/api/v1/upload`。这样可以避免浏览器跨域限制，但 API Token 在发起上传时仍会经过当前浏览器；请只在可信设备上使用作者功能。

## 7. 内容与配置文件

| 文件 | 内容 |
| --- | --- |
| `src/content/posts/**` | Markdown 文章 |
| `src/data/site.json` | 站点信息与显示设置 |
| `src/data/profile.json` | 个人资料与社交链接 |
| `src/data/portfolio.json` | 主页项目与分类 |
| `src/data/navigation.json` | 网站导航 |
| `src/config/writerConfig.ts` | 写作配置结构与浏览器存储键 |
| `wrangler.jsonc` | Cloudflare Worker 的公开配置 |

所有 Token、密码和机器人密钥都必须保存在 Cloudflare Secret 或作者本机浏览器中，不要写入上述文件。

## 8. 常见问题

### 发布提示 GitHub Contents 权限不足

检查 Token 是否选中了正确的 `Firefly` 仓库，`Contents` 是否为 `Read and write`，Cloudflare Secret 是否完整更新，并在更新 Secret 后重新部署。作者页面会尽量显示 GitHub 返回的具体错误。

### K-Vault 无法连接

确认地址为公网 HTTPS、K-Vault 部署处于运行状态、Token 有上传权限、存储源名称正确。Firefly 会拒绝 `localhost`、回环地址和常见私网地址。

### GitHub 提交成功但网站没变化

依次检查 GitHub Actions、Cloudflare Deployments 和生产分支是否为 `main`。一次失败的构建不会覆盖上一次成功部署。

### GitHub Code quality 提示格式错误

先查看注释指出的文件，再运行 `pnpm format`。本项目使用 Biome，JSON 和前端源码的格式差异会让质量检查失败。

## 9. 安全原则

- 不提交 `.env`、GitHub Token、K-Vault Token、Telegram Bot Token 或作者密码。
- GitHub Token 只授权单个仓库并使用最小权限。
- 作者登录密码与会话签名密钥使用不同值。
- 不在公共电脑保存 K-Vault 写作配置。
- Token 泄露时立即撤销并在 Cloudflare 更新 Secret。
