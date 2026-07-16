# Cloudflare 作者代理配置

Firefly 的写文章、站点配置和网站导航编辑通过同域 `/api/author/*` 接口提交到 GitHub。GitHub Token 只保存在 Cloudflare Secret 中，不会进入浏览器或仓库。

## 1. 添加 GitHub Secret

在 Cloudflare Dashboard 打开 `Workers & Pages → firefly → Settings → Variables and Secrets → Add`，添加：

- 名称：`GITHUB_TOKEN`
- 类型：`Secret`
- 值：只授权 `Embersinthewind/Firefly`、拥有 `Contents: Read and write` 的 Fine-grained Token

## 2. 添加 Cloudflare Access 变量

在同一位置添加三个变量：

- `CF_ACCESS_TEAM_DOMAIN`：Zero Trust 团队域名，例如 `your-team.cloudflareaccess.com`
- `CF_ACCESS_AUD`：保护作者接口的 Access Application AUD Tag
- `AUTHOR_EMAILS`：允许编辑的邮箱；多个邮箱用英文逗号分隔

这三个值可以使用 Secret 类型；`AUTHOR_EMAILS` 也可以使用普通变量。

## 3. 创建 Access Application

在 `Zero Trust → Access → Applications` 新建 Self-hosted Application：

- 域名：博客正式域名
- Path：`/api/author/*`
- Policy：Allow
- Include：只填写作者邮箱

创建后，从 Application 配置中复制 AUD Tag，填入 `CF_ACCESS_AUD`。团队域名可以在 Zero Trust 设置中查看。

## 4. 重新部署

保存变量后重新部署 `firefly`。进入写文章、站点配置或网站导航页面，点击“作者登录”，完成 Cloudflare Access 邮箱验证即可编辑和提交。

接口会再次验证 Access JWT、Application AUD 和作者邮箱；即使遗漏 Access 配置，也会保持关闭状态，不会变成公开的 GitHub 写入代理。
