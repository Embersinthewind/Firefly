# Firefly 浏览器内容后台

Firefly 使用 Sveltia CMS 提供 `/admin/` 内容后台。后台不会直接修改线上服务器，而是把文章、个人资料和图片提交到 GitHub；Cloudflare Workers & Pages 检测到提交后重新构建并发布站点。

## 当前可管理内容

- `src/content/posts/**/*.md`：普通 Markdown 文章
- `src/data/profile.json`：头像、名称、简介和社交链接
- `src/content/spec/about.md`：关于页面
- `src/content/spec/guestbook.md`：留言板说明
- `public/uploads/`：后台上传的图片和附件

MDX 文件可能包含可执行组件代码，第一版不在后台中开放，继续通过代码编辑器维护。

## Cloudflare 项目设置

Cloudflare Workers & Pages 项目使用以下构建设置：

| 设置 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 构建命令 | `pnpm build` |
| 输出目录 | `dist` |
| Node.js | `22` 或更高版本 |

部署完成后通过 `https://你的域名/admin/` 打开后台。

## 首次快速登录

在 GitHub OAuth 配置完成前，可以先选择后台登录页上的 **Sign in with Token**。按照页面提供的 GitHub 链接创建仅用于该仓库的访问令牌，并授予仓库内容读写权限。

该方式适合站长本人测试。正式长期使用建议完成下方 OAuth 配置。

## 配置 GitHub OAuth

### 1. 部署认证 Worker

打开官方仓库 [sveltia/sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth)，使用 **Deploy to Cloudflare Workers** 按钮部署。

部署完成后记录 Worker 地址：

```text
https://sveltia-cms-auth.<你的 Cloudflare 子域>.workers.dev
```

### 2. 创建 GitHub OAuth App

在 [GitHub OAuth Apps](https://github.com/settings/developers) 中创建应用：

| 字段 | 值 |
| --- | --- |
| Homepage URL | 博客正式地址 |
| Authorization callback URL | `https://认证Worker地址/callback` |

创建后记录 `Client ID` 并生成 `Client Secret`。

### 3. 设置 Worker 变量

在 Cloudflare Worker 的 **Settings → Variables and Secrets** 中设置：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | 普通变量 | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | 加密 Secret | GitHub OAuth Client Secret |
| `ALLOWED_DOMAINS` | 普通变量 | 博客域名，不包含协议和路径 |

例如博客地址为 `https://blog.example.com`，则 `ALLOWED_DOMAINS` 填写 `blog.example.com`。

### 4. 连接后台

编辑 `public/admin/config.yml`，在 `backend` 下加入认证 Worker 地址：

```yaml
backend:
  name: github
  repo: Embersinthewind/Firefly
  branch: main
  base_url: https://sveltia-cms-auth.<你的 Cloudflare 子域>.workers.dev
  auth_methods: [oauth]
```

提交并等待 Cloudflare 重新部署后，即可使用 GitHub 按钮登录。

## 发布文章

1. 打开 `/admin/` 并进入“文章”。
2. 新建文章，填写标题、发布日期和正文。
3. 在文章正式完成前保留“草稿”开关。
4. 保存后，后台会把 Markdown 文件提交到 `main` 分支。
5. Cloudflare 会自动构建；草稿不会出现在生产文章列表中。
6. 关闭“草稿”并再次保存，构建成功后文章正式发布。

文章 URL 由文件名决定。后台编辑器右上角菜单中可以修改 Slug；文章发布后不建议再修改 Slug。

## 更新个人资料

进入“站点设置 → 个人资料”后可以更新：

- 头像
- 显示名称
- 个人简介
- 社交链接名称、图标、地址和文字显示开关

保存后会更新 `src/data/profile.json`。构建时 `src/config/profileConfig.ts` 会校验数据并继续向现有组件导出 `profileConfig`，因此不需要修改组件代码。

## 图片管理

- 文章图片保存在 `public/uploads/posts/`
- 头像保存在 `public/uploads/profile/`
- 单文件最大 10 MiB
- 上传文件名会自动规范化
- 文件最终以 `/uploads/...` URL 在网站中使用

大体积相册、音视频和模型文件不建议存入 Git 仓库，后续应迁移到 Cloudflare R2。

## 构建失败排查

内容保存后若 Cloudflare 构建失败，依次检查：

1. GitHub 最新提交的检查结果。
2. Cloudflare 项目的 Deployments 日志。
3. 本地运行 `pnpm check`、`pnpm type-check` 和 `pnpm build`。
4. 检查日期、URL、文章 Frontmatter 和 `src/data/profile.json` 是否符合字段要求。

上一次成功部署的站点不会因为一次失败构建而被覆盖。
