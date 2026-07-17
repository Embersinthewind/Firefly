type AssetsBinding = {
	fetch(request: Request): Promise<Response>;
};

type Env = {
	ASSETS: AssetsBinding;
	GITHUB_TOKEN?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
	GITHUB_SITE_PATH?: string;
	GITHUB_PROFILE_PATH?: string;
	GITHUB_PORTFOLIO_PATH?: string;
	GITHUB_NAVIGATION_PATH?: string;
	GITHUB_POSTS_DIR?: string;
	GITHUB_WALLPAPER_DIR?: string;
	GITHUB_MOBILE_WALLPAPER_DIR?: string;
	AUTHOR_PASSWORD?: string;
	AUTHOR_SESSION_SECRET?: string;
	AUTHOR_NAME?: string;
};

type GitHubFile = {
	content?: string;
	sha?: string;
	message?: string;
};

const apiPrefix = "/api/author";
const githubApiVersion = "2022-11-28";
const sessionCookieName = "firefly_author_session";
const sessionDurationSeconds = 30 * 24 * 60 * 60;

class HttpError extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

function json(data: unknown, status = 200): Response {
	return Response.json(data, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function base64UrlBytes(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function authorConfig(env: Env) {
	const password = env.AUTHOR_PASSWORD?.trim();
	const sessionSecret = env.AUTHOR_SESSION_SECRET?.trim();
	if (
		!password ||
		password.length < 8 ||
		!sessionSecret ||
		sessionSecret.length < 32
	) {
		throw new HttpError(
			503,
			"author_auth_not_configured",
			"作者密码尚未在 Cloudflare 中完成配置。",
		);
	}
	return {
		password,
		sessionSecret,
		displayName: env.AUTHOR_NAME?.trim() || "作者",
	};
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
	);
}

async function constantTimeEqual(
	left: string,
	right: string,
): Promise<boolean> {
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
	]);
	const leftBytes = new Uint8Array(leftHash);
	const rightBytes = new Uint8Array(rightHash);
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index++) {
		difference |= leftBytes[index] ^ rightBytes[index];
	}
	return difference === 0;
}

function readCookie(request: Request, name: string): string {
	const cookies = request.headers.get("Cookie") || "";
	for (const entry of cookies.split(";")) {
		const [key, ...parts] = entry.trim().split("=");
		if (key === name) return parts.join("=");
	}
	return "";
}

async function createSession(env: Env): Promise<string> {
	const config = authorConfig(env);
	const payload = base64UrlEncode(
		new TextEncoder().encode(
			JSON.stringify({
				exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
			}),
		),
	);
	const signature = base64UrlEncode(await hmac(config.sessionSecret, payload));
	return `${payload}.${signature}`;
}

async function verifyAuthor(
	request: Request,
	env: Env,
): Promise<{ email: string }> {
	const config = authorConfig(env);
	const session = readCookie(request, sessionCookieName);
	const [payload, signature] = session.split(".");
	if (!payload || !signature) {
		throw new HttpError(401, "author_login_required", "请先登录作者模式。");
	}
	const expectedSignature = base64UrlEncode(
		await hmac(config.sessionSecret, payload),
	);
	if (!(await constantTimeEqual(signature, expectedSignature))) {
		throw new HttpError(
			401,
			"invalid_author_session",
			"作者登录状态无效，请重新登录。",
		);
	}
	try {
		const claims = JSON.parse(
			new TextDecoder().decode(base64UrlBytes(payload)),
		) as {
			exp?: number;
		};
		if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) {
			throw new Error("expired");
		}
	} catch {
		throw new HttpError(
			401,
			"expired_author_session",
			"作者登录已过期，请重新登录。",
		);
	}
	return { email: config.displayName };
}

function requireGitHubConfig(env: Env) {
	const token = env.GITHUB_TOKEN?.trim();
	const owner = env.GITHUB_OWNER?.trim();
	const repo = env.GITHUB_REPO?.trim();
	const branch = env.GITHUB_BRANCH?.trim() || "main";
	if (!token || !owner || !repo) {
		throw new HttpError(
			503,
			"github_not_configured",
			"作者代理尚未配置 GitHub 仓库密钥。",
		);
	}
	return { token, owner, repo, branch };
}

function githubHeaders(token: string): HeadersInit {
	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "Firefly-Author-Proxy",
		"X-GitHub-Api-Version": githubApiVersion,
	};
}

function githubContentUrl(env: Env, path: string): string {
	const { owner, repo } = requireGitHubConfig(env);
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
}

function decodeGitHubContent(value: string): string {
	const binary = atob(value.replace(/\s/g, ""));
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function encodeGitHubContent(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

function encodeGitHubBytes(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

async function githubError(
	response: Response,
	operation = "访问仓库",
): Promise<HttpError> {
	const payload = (await response.json().catch(() => ({}))) as {
		message?: string;
	};
	const acceptedPermissions = response.headers.get(
		"X-Accepted-GitHub-Permissions",
	);
	const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
	const githubDetail = payload.message?.trim() || `HTTP ${response.status}`;
	const messages: Record<number, string> = {
		401: "Cloudflare 中保存的 GitHub Token 无效或已过期。",
		403:
			rateLimitRemaining === "0"
				? `GitHub API 请求次数已用完：${githubDetail}。请稍后重试。`
				: `GitHub 在“${operation}”时拒绝请求（403）：${githubDetail}。${acceptedPermissions ? `该接口要求：${acceptedPermissions}。` : ""}`,
		404: "找不到 Firefly 仓库或目标文件。",
		409: "远程文件已发生变化，请刷新页面后重试。",
		422: "GitHub 拒绝了本次提交，请检查提交内容。",
	};
	return new HttpError(
		response.status,
		"github_request_failed",
		messages[response.status] ||
			payload.message ||
			`GitHub 请求失败（${response.status}）。`,
	);
}

function repositoryPaths(env: Env): Record<string, string> {
	return {
		site: env.GITHUB_SITE_PATH?.trim() || "src/data/site.json",
		profile: env.GITHUB_PROFILE_PATH?.trim() || "src/data/profile.json",
		portfolio: env.GITHUB_PORTFOLIO_PATH?.trim() || "src/data/portfolio.json",
		navigation:
			env.GITHUB_NAVIGATION_PATH?.trim() || "src/data/navigation.json",
	};
}

async function readRepositoryFile(env: Env, key: string): Promise<Response> {
	const path = repositoryPaths(env)[key];
	if (!path) throw new HttpError(404, "unknown_file", "不允许读取该仓库文件。");
	const config = requireGitHubConfig(env);
	const response = await fetch(
		`${githubContentUrl(env, path)}?ref=${encodeURIComponent(config.branch)}`,
		{ headers: githubHeaders(config.token) },
	);
	if (!response.ok) throw await githubError(response, `读取 ${path}`);
	const payload = (await response.json()) as GitHubFile;
	if (!payload.content || !payload.sha) {
		throw new HttpError(
			502,
			"invalid_github_response",
			"GitHub 返回的文件内容不完整。",
		);
	}
	return json({
		content: decodeGitHubContent(payload.content),
		sha: payload.sha,
	});
}

async function readJsonBody(
	request: Request,
	maxBytes: number,
): Promise<Record<string, unknown>> {
	const length = Number(request.headers.get("Content-Length") || 0);
	if (length > maxBytes)
		throw new HttpError(413, "payload_too_large", "提交内容过大。");
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > maxBytes) {
		throw new HttpError(413, "payload_too_large", "提交内容过大。");
	}
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new HttpError(400, "invalid_json", "请求内容不是有效的 JSON。");
	}
}

async function writeGitHubFile(
	env: Env,
	path: string,
	content: string,
	message: string,
	sha?: string,
): Promise<Response> {
	const config = requireGitHubConfig(env);
	const response = await fetch(githubContentUrl(env, path), {
		method: "PUT",
		headers: {
			...githubHeaders(config.token),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			branch: config.branch,
			content: encodeGitHubContent(content),
			message,
			...(sha ? { sha } : {}),
		}),
	});
	if (!response.ok) throw await githubError(response, `写入 ${path}`);
	const payload = (await response.json()) as {
		content?: { sha?: string };
		commit?: { html_url?: string };
	};
	return json({
		commitUrl: payload.commit?.html_url || "",
		sha: payload.content?.sha || sha || "",
	});
}

async function writeRepositoryFile(
	request: Request,
	env: Env,
	key: string,
): Promise<Response> {
	const path = repositoryPaths(env)[key];
	if (!path) throw new HttpError(404, "unknown_file", "不允许修改该仓库文件。");
	const body = await readJsonBody(request, 1024 * 1024);
	if (typeof body.content !== "string") {
		throw new HttpError(400, "invalid_content", "缺少需要提交的文件内容。");
	}
	try {
		JSON.parse(body.content);
	} catch {
		throw new HttpError(
			400,
			"invalid_content",
			"配置文件内容不是有效的 JSON。",
		);
	}
	return writeGitHubFile(
		env,
		path,
		body.content,
		`feat: update ${key} configuration`,
		typeof body.sha === "string" ? body.sha : undefined,
	);
}

async function publishArticle(request: Request, env: Env): Promise<Response> {
	const body = await readJsonBody(request, 2 * 1024 * 1024);
	const fileName =
		typeof body.fileName === "string" ? body.fileName.trim() : "";
	const content = typeof body.content === "string" ? body.content : "";
	const draft = body.draft === true;
	if (
		!fileName ||
		fileName.length > 180 ||
		!fileName.endsWith(".md") ||
		fileName.includes("/") ||
		fileName.includes("\\") ||
		fileName === ".md"
	) {
		throw new HttpError(400, "invalid_article_name", "文章文件名无效。");
	}
	if (!content.startsWith("---\n") || content.length < 12) {
		throw new HttpError(
			400,
			"invalid_article",
			"文章内容或 Frontmatter 无效。",
		);
	}
	const postsDir = (
		env.GITHUB_POSTS_DIR?.trim() || "src/content/posts"
	).replace(/\/+$/, "");
	const path = `${postsDir}/${fileName}`;
	const config = requireGitHubConfig(env);
	const current = await fetch(
		`${githubContentUrl(env, path)}?ref=${encodeURIComponent(config.branch)}`,
		{ headers: githubHeaders(config.token) },
	);
	let sha: string | undefined;
	if (current.ok) sha = ((await current.json()) as GitHubFile).sha;
	else if (current.status !== 404)
		throw await githubError(current, `检查文章 ${path}`);
	const slug = fileName.slice(0, -3);
	return writeGitHubFile(
		env,
		path,
		content,
		`${draft ? "chore" : "feat"}(content): ${sha ? "update" : "publish"} ${slug}`,
		sha,
	);
}

function validateKVaultBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new HttpError(400, "invalid_kvault_url", "K-Vault 地址无效。");
	}
	const hostname = url.hostname.toLowerCase();
	const isPrivateHost =
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		/^127\./.test(hostname) ||
		/^10\./.test(hostname) ||
		/^192\.168\./.test(hostname) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
		hostname === "0.0.0.0" ||
		hostname === "::1";
	if (url.protocol !== "https:" || isPrivateHost) {
		throw new HttpError(
			400,
			"invalid_kvault_url",
			"K-Vault 必须使用可公开访问的 HTTPS 地址。",
		);
	}
	return url.toString().replace(/\/+$/, "");
}

async function uploadKVaultImage(request: Request): Promise<Response> {
	const contentLength = Number(request.headers.get("Content-Length") || 0);
	if (contentLength > 20 * 1024 * 1024) {
		throw new HttpError(413, "image_too_large", "图片不能超过 20 MB。");
	}
	const form = await request.formData();
	const file = form.get("file");
	const token = String(form.get("token") || "").trim();
	const baseUrl = validateKVaultBaseUrl(String(form.get("baseUrl") || ""));
	if (!(file instanceof File) || !file.type.startsWith("image/")) {
		throw new HttpError(400, "invalid_image", "请选择有效的图片文件。");
	}
	if (file.size > 20 * 1024 * 1024) {
		throw new HttpError(413, "image_too_large", "图片不能超过 20 MB。");
	}
	if (!token) {
		throw new HttpError(400, "kvault_token_missing", "K-Vault Token 未配置。");
	}

	const uploadForm = new FormData();
	uploadForm.append("file", file, file.name || `image-${Date.now()}.png`);
	const storage = String(form.get("storage") || "").trim();
	const folderPath = String(form.get("folderPath") || "").trim();
	if (storage) uploadForm.append("storage", storage);
	if (folderPath) uploadForm.append("folderPath", folderPath);

	let upstream: Response;
	try {
		upstream = await fetch(`${baseUrl}/api/v1/upload`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: uploadForm,
		});
	} catch {
		throw new HttpError(
			502,
			"kvault_unreachable",
			"无法连接 K-Vault，请检查地址和部署状态。",
		);
	}
	const payload = (await upstream.json().catch(() => ({}))) as {
		error?: string | { message?: string };
		message?: string;
	};
	if (!upstream.ok) {
		const detail =
			(typeof payload.error === "string"
				? payload.error
				: payload.error?.message) || payload.message;
		throw new HttpError(
			upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
			"kvault_upload_failed",
			detail || `K-Vault 上传失败（HTTP ${upstream.status}）。`,
		);
	}
	return json(payload);
}

type WallpaperTarget = "desktop" | "mobile";

function wallpaperDirectory(env: Env, target: WallpaperTarget): string {
	const directory =
		target === "mobile"
			? env.GITHUB_MOBILE_WALLPAPER_DIR?.trim() ||
				"src/assets/images/MobileWallpaper"
			: env.GITHUB_WALLPAPER_DIR?.trim() ||
				"src/assets/images/DesktopWallpaper";
	return directory.replace(/^\/+|\/+$/g, "");
}

function wallpaperPreviewUrl(env: Env, path: string): string {
	const config = requireGitHubConfig(env);
	const encodedPath = path.split("/").map(encodeURIComponent).join("/");
	return `https://raw.githubusercontent.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/${encodedPath}`;
}

function isWallpaperPath(path: string): boolean {
	return /\.(?:avif|webp|png|jpe?g)$/i.test(path);
}

async function listWallpapers(
	env: Env,
	target: WallpaperTarget,
): Promise<Response> {
	const config = requireGitHubConfig(env);
	const directory = wallpaperDirectory(env, target);
	const treeUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(config.branch)}?recursive=1`;
	const response = await fetch(treeUrl, {
		headers: githubHeaders(config.token),
	});
	if (!response.ok) throw await githubError(response, "读取壁纸目录");
	const payload = (await response.json()) as {
		tree?: Array<{ path?: string; type?: string }>;
	};
	const groups = new Map<
		string,
		Array<{ name: string; path: string; previewUrl: string }>
	>();
	for (const item of payload.tree || []) {
		const path = item.path || "";
		if (
			item.type !== "blob" ||
			!path.startsWith(`${directory}/`) ||
			!isWallpaperPath(path)
		) {
			continue;
		}
		const relative = path.slice(directory.length + 1);
		const slash = relative.lastIndexOf("/");
		const groupPath = slash >= 0 ? relative.slice(0, slash) : "";
		const images = groups.get(groupPath) || [];
		images.push({
			name: relative.slice(slash + 1),
			path: path.replace(/^src\//, ""),
			previewUrl: wallpaperPreviewUrl(env, path),
		});
		groups.set(groupPath, images);
	}

	return json({
		groups: Array.from(groups.entries())
			.map(([path, images]) => ({
				name: path || "默认壁纸",
				path,
				images: images.sort((left, right) =>
					left.name.localeCompare(right.name, "zh-CN", {
						numeric: true,
					}),
				),
			}))
			.sort((left, right) => {
				if (left.name === "默认壁纸") return -1;
				if (right.name === "默认壁纸") return 1;
				return left.name.localeCompare(right.name, "zh-CN", {
					numeric: true,
				});
			}),
	});
}

function normalizeWallpaperGroup(value: string): string {
	const group = value
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!group) return "";
	if (
		group.length > 80 ||
		group.split("/").some((part) => !part || part === "." || part === "..") ||
		/[<>:"|?*]/.test(group) ||
		Array.from(group).some((character) => character.charCodeAt(0) < 32)
	) {
		throw new HttpError(400, "invalid_wallpaper_group", "壁纸组名称无效。");
	}
	return group;
}

function safeWallpaperFileName(value: string): string {
	const normalized = value
		.trim()
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\s+/g, "-");
	if (
		Array.from(normalized).some((character) => character.charCodeAt(0) < 32)
	) {
		throw new HttpError(400, "invalid_wallpaper_file", "壁纸文件名无效。");
	}
	const extension = normalized.match(/\.(avif|webp|png|jpe?g)$/i)?.[0];
	if (!extension || normalized.length > 120) {
		throw new HttpError(
			400,
			"invalid_wallpaper_file",
			"壁纸仅支持 AVIF、WebP、PNG 和 JPG 格式。",
		);
	}
	return normalized;
}

async function uploadWallpaper(request: Request, env: Env): Promise<Response> {
	const contentLength = Number(request.headers.get("Content-Length") || 0);
	if (contentLength > 10 * 1024 * 1024) {
		throw new HttpError(413, "wallpaper_too_large", "单张壁纸不能超过 10 MB。");
	}
	const form = await request.formData();
	const target: WallpaperTarget =
		String(form.get("target") || "desktop") === "mobile" ? "mobile" : "desktop";
	const file = form.get("file");
	if (!(file instanceof File) || !file.type.startsWith("image/")) {
		throw new HttpError(
			400,
			"invalid_wallpaper_file",
			"请选择有效的壁纸图片。",
		);
	}
	if (file.size > 10 * 1024 * 1024) {
		throw new HttpError(413, "wallpaper_too_large", "单张壁纸不能超过 10 MB。");
	}
	const directory = wallpaperDirectory(env, target);
	const group = normalizeWallpaperGroup(String(form.get("group") || ""));
	const replacePath = String(form.get("replacePath") || "").trim();
	const uploadedName = safeWallpaperFileName(
		file.name || `wallpaper-${Date.now()}.webp`,
	);
	let repositoryPath = `${directory}/${group ? `${group}/` : ""}${uploadedName}`;

	if (replacePath) {
		const requestedPath = replacePath.replace(/^\/+/, "");
		const normalizedReplacePath = requestedPath.startsWith("assets/")
			? `src/${requestedPath}`
			: requestedPath;
		if (
			!normalizedReplacePath.startsWith(`${directory}/`) ||
			!isWallpaperPath(normalizedReplacePath)
		) {
			throw new HttpError(
				400,
				"invalid_wallpaper_path",
				"替换的壁纸路径无效。",
			);
		}
		const sourceExtension = uploadedName.split(".").pop()?.toLowerCase();
		const targetExtension = normalizedReplacePath
			.split(".")
			.pop()
			?.toLowerCase();
		if (sourceExtension !== targetExtension) {
			throw new HttpError(
				400,
				"wallpaper_format_mismatch",
				`替换图片必须保持 ${targetExtension?.toUpperCase()} 格式。`,
			);
		}
		repositoryPath = normalizedReplacePath;
	}

	const config = requireGitHubConfig(env);
	const current = await fetch(
		`${githubContentUrl(env, repositoryPath)}?ref=${encodeURIComponent(config.branch)}`,
		{ headers: githubHeaders(config.token) },
	);
	let sha: string | undefined;
	if (current.ok) sha = ((await current.json()) as GitHubFile).sha;
	else if (current.status !== 404)
		throw await githubError(current, `检查壁纸 ${repositoryPath}`);

	const response = await fetch(githubContentUrl(env, repositoryPath), {
		method: "PUT",
		headers: {
			...githubHeaders(config.token),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			branch: config.branch,
			content: encodeGitHubBytes(new Uint8Array(await file.arrayBuffer())),
			message: `feat: ${sha ? "replace" : "add"} wallpaper ${repositoryPath.split("/").pop()}`,
			...(sha ? { sha } : {}),
		}),
	});
	if (!response.ok)
		throw await githubError(response, `上传壁纸 ${repositoryPath}`);
	const payload = (await response.json()) as {
		content?: { sha?: string };
		commit?: { html_url?: string };
	};
	return json({
		commitUrl: payload.commit?.html_url || "",
		sha: payload.content?.sha || sha || "",
		image: {
			name: repositoryPath.split("/").pop() || uploadedName,
			path: repositoryPath.replace(/^src\//, ""),
			previewUrl: wallpaperPreviewUrl(env, repositoryPath),
		},
	});
}

async function deleteWallpaper(request: Request, env: Env): Promise<Response> {
	const body = await readJsonBody(request, 32 * 1024);
	const target: WallpaperTarget =
		body.target === "mobile" ? "mobile" : "desktop";
	const directory = wallpaperDirectory(env, target);
	const requestedPath =
		typeof body.path === "string" ? body.path.trim().replace(/^\/+/, "") : "";
	const repositoryPath = requestedPath.startsWith("assets/")
		? `src/${requestedPath}`
		: requestedPath;
	if (
		!repositoryPath.startsWith(`${directory}/`) ||
		!isWallpaperPath(repositoryPath)
	) {
		throw new HttpError(400, "invalid_wallpaper_path", "删除的壁纸路径无效。");
	}

	const config = requireGitHubConfig(env);
	const current = await fetch(
		`${githubContentUrl(env, repositoryPath)}?ref=${encodeURIComponent(config.branch)}`,
		{ headers: githubHeaders(config.token) },
	);
	if (!current.ok)
		throw await githubError(current, `读取壁纸 ${repositoryPath}`);
	const sha = ((await current.json()) as GitHubFile).sha;
	if (!sha) {
		throw new HttpError(
			502,
			"invalid_github_response",
			"GitHub 未返回壁纸版本信息。",
		);
	}

	const response = await fetch(githubContentUrl(env, repositoryPath), {
		method: "DELETE",
		headers: {
			...githubHeaders(config.token),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			branch: config.branch,
			sha,
			message: `feat: delete wallpaper ${repositoryPath.split("/").pop()}`,
		}),
	});
	if (!response.ok)
		throw await githubError(response, `删除壁纸 ${repositoryPath}`);
	const payload = (await response.json()) as {
		commit?: { html_url?: string; sha?: string };
	};
	return json({
		commitUrl: payload.commit?.html_url || "",
		sha: payload.commit?.sha || sha,
	});
}

function assertSameOrigin(request: Request): void {
	if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
	const origin = request.headers.get("Origin");
	if (origin && origin !== new URL(request.url).origin) {
		throw new HttpError(
			403,
			"cross_origin_blocked",
			"不允许跨站提交作者操作。",
		);
	}
}

function safeReturnPath(value: string | null): string {
	return value?.startsWith("/") && !value.startsWith("//") ? value : "/write/";
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function loginPage(returnTo: string, error = "", status = 200): Response {
	const safePath = escapeHtml(returnTo);
	const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
	return new Response(
		`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Firefly 作者登录</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fb;color:#172033;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(92vw,420px);padding:2rem;border:1px solid #dce2ee;border-radius:24px;background:#fff;box-shadow:0 24px 70px #25304d1a}small{color:#4f7cff;font-weight:700;letter-spacing:.14em}h1{margin:.45rem 0 .4rem;font-size:1.8rem}p{margin:.3rem 0 1.35rem;color:#697386}label{display:grid;gap:.5rem;font-weight:650}input{width:100%;min-height:48px;padding:.75rem .9rem;border:1px solid #cfd7e6;border-radius:12px;font:inherit;outline:none}input:focus{border-color:#4f7cff;box-shadow:0 0 0 3px #4f7cff22}button{width:100%;min-height:48px;margin-top:1rem;border:0;border-radius:12px;background:#274df0;color:#fff;font:inherit;font-weight:750;cursor:pointer}.error{margin:0 0 1rem;padding:.75rem;border-radius:10px;background:#fff0f0;color:#c53636;font-size:.9rem}</style></head><body><main class="card"><small>FIREFLY AUTHOR</small><h1>作者登录</h1><p>验证成功后，本设备将保持登录 30 天。</p>${errorHtml}<form method="post" action="/api/author/login"><input type="hidden" name="returnTo" value="${safePath}"><label>作者密码<input name="password" type="password" autocomplete="current-password" required autofocus></label><button type="submit">进入作者模式</button></form></main></body></html>`,
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				"Content-Type": "text/html; charset=utf-8",
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}

async function handleLogin(
	request: Request,
	env: Env,
	url: URL,
): Promise<Response> {
	const config = authorConfig(env);
	if (request.method === "GET") {
		return loginPage(safeReturnPath(url.searchParams.get("returnTo")));
	}
	if (request.method !== "POST") {
		throw new HttpError(405, "method_not_allowed", "登录请求方法不受支持。");
	}
	assertSameOrigin(request);
	const form = await request.formData();
	const returnTo = safeReturnPath(String(form.get("returnTo") || ""));
	const password = String(form.get("password") || "");
	if (!(await constantTimeEqual(password, config.password))) {
		return loginPage(returnTo, "作者密码不正确。", 401);
	}
	const session = await createSession(env);
	return new Response(null, {
		status: 303,
		headers: {
			Location: new URL(returnTo, url.origin).toString(),
			"Set-Cookie": `${sessionCookieName}=${session}; Max-Age=${sessionDurationSeconds}; Path=${apiPrefix}; HttpOnly; Secure; SameSite=Strict`,
			"Cache-Control": "no-store",
		},
	});
}

async function handleAuthorApi(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.slice(apiPrefix.length) || "/";

	if (path === "/login") return handleLogin(request, env, url);
	if (request.method === "GET" && path === "/logout") {
		const returnTo = safeReturnPath(url.searchParams.get("returnTo"));
		return new Response(null, {
			status: 303,
			headers: {
				Location: new URL(returnTo, url.origin).toString(),
				"Set-Cookie": `${sessionCookieName}=; Max-Age=0; Path=${apiPrefix}; HttpOnly; Secure; SameSite=Strict`,
				"Cache-Control": "no-store",
			},
		});
	}

	assertSameOrigin(request);
	const author = await verifyAuthor(request, env);
	if (request.method === "GET" && path === "/session") {
		const config = requireGitHubConfig(env);
		return json({
			authorized: true,
			email: author.email,
			repository: `${config.owner}/${config.repo}`,
			branch: config.branch,
		});
	}
	const fileMatch = path.match(
		/^\/files\/(site|profile|portfolio|navigation)$/,
	);
	if (fileMatch && request.method === "GET")
		return readRepositoryFile(env, fileMatch[1]);
	if (fileMatch && request.method === "PUT")
		return writeRepositoryFile(request, env, fileMatch[1]);
	if (path === "/images" && request.method === "POST")
		return uploadKVaultImage(request);
	if (path === "/wallpapers" && request.method === "GET")
		return listWallpapers(
			env,
			url.searchParams.get("target") === "mobile" ? "mobile" : "desktop",
		);
	if (path === "/wallpapers" && request.method === "POST")
		return uploadWallpaper(request, env);
	if (path === "/wallpapers" && request.method === "DELETE")
		return deleteWallpaper(request, env);
	if (path === "/articles" && request.method === "POST")
		return publishArticle(request, env);

	throw new HttpError(404, "not_found", "作者代理接口不存在。");
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (!url.pathname.startsWith(apiPrefix)) return env.ASSETS.fetch(request);
		try {
			return await handleAuthorApi(request, env);
		} catch (error) {
			if (error instanceof HttpError) {
				return json({ code: error.code, message: error.message }, error.status);
			}
			console.error("Author API error", error);
			return json(
				{ code: "internal_error", message: "作者代理发生内部错误。" },
				500,
			);
		}
	},
};
