# Cloudflare 作者代理配置

Firefly 的写文章、站点配置和网站导航编辑通过同域 `/api/author/*` 接口提交到 GitHub。GitHub Token 只保存在 Cloudflare Secret 中，不会进入浏览器或仓库。

完整部署、GitHub 权限和 K-Vault 写作配置见 [定制版部署与使用指南](./custom-deployment.md)。

## 添加三个 Secret

在 Cloudflare Dashboard 打开 `Workers & Pages → firefly → Settings → Variables and Secrets → Add`，依次添加：

### `GITHUB_TOKEN`

- 类型：`Secret`
- 值：只授权 `Embersinthewind/Firefly`、拥有 `Contents: Read and write` 的 Fine-grained Token

### `AUTHOR_PASSWORD`

- 类型：`Secret`
- 值：至少 8 个字符的作者登录密码，建议使用字母、数字和符号组合

### `AUTHOR_SESSION_SECRET`

- 类型：`Secret`
- 值：至少 32 个字符的随机签名密钥，建议生成 64 个随机字符

可选添加普通变量 `AUTHOR_NAME`，用于设置登录后显示的作者名称；不填写时显示“作者”。

## 重新部署

保存 Secret 后重新部署 `firefly`。进入写文章、站点配置或网站导航页面，点击“作者登录”，输入 `AUTHOR_PASSWORD` 即可编辑和提交。

登录成功后，Worker 会设置仅 `/api/author` 可见的 `HttpOnly + Secure + SameSite=Strict` 签名 Cookie，有效期 30 天。GitHub Token 和会话签名密钥不会发送到浏览器。

接口仅允许修改预设的文章目录与四个配置文件，并拒绝跨站写入请求；没有配置强密码和签名密钥时会保持关闭状态。
