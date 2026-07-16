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
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	AUTHOR_EMAILS?: string;
};

type AccessClaims = {
	aud?: string | string[];
	email?: string;
	exp?: number;
	iss?: string;
	nbf?: number;
};

type GitHubFile = {
	content?: string;
	sha?: string;
	message?: string;
};

const apiPrefix = "/api/author";
const githubApiVersion = "2022-11-28";
const keyCache = new Map<string, { expiresAt: number; keys: JsonWebKey[] }>();

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

function normalizeTeamDomain(value: string): string {
	return value
		.trim()
		.replace(/^https?:\/\//, "")
		.replace(/\/+$/, "");
}

function base64UrlBytes(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(value: string): T {
	return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))) as T;
}

async function getAccessKeys(teamDomain: string): Promise<JsonWebKey[]> {
	const cached = keyCache.get(teamDomain);
	if (cached && cached.expiresAt > Date.now()) return cached.keys;

	const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!response.ok) {
		throw new HttpError(
			503,
			"access_keys_unavailable",
			"暂时无法验证 Cloudflare Access 身份。",
		);
	}
	const payload = (await response.json()) as { keys?: JsonWebKey[] };
	if (!payload.keys?.length) {
		throw new HttpError(
			503,
			"access_keys_invalid",
			"Cloudflare Access 公钥配置无效。",
		);
	}
	keyCache.set(teamDomain, {
		expiresAt: Date.now() + 60 * 60 * 1000,
		keys: payload.keys,
	});
	return payload.keys;
}

async function verifyAuthor(
	request: Request,
	env: Env,
): Promise<{ email: string }> {
	const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN || "");
	const expectedAudience = env.CF_ACCESS_AUD?.trim();
	const allowedEmails = (env.AUTHOR_EMAILS || "")
		.split(",")
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);

	if (!teamDomain || !expectedAudience || allowedEmails.length === 0) {
		throw new HttpError(
			503,
			"access_not_configured",
			"作者代理尚未完成 Cloudflare Access 配置。",
		);
	}

	const assertion = request.headers.get("CF-Access-Jwt-Assertion");
	if (!assertion) {
		throw new HttpError(
			401,
			"author_login_required",
			"请先通过 Cloudflare Access 登录作者模式。",
		);
	}
	const parts = assertion.split(".");
	if (parts.length !== 3) {
		throw new HttpError(
			401,
			"invalid_access_token",
			"Cloudflare Access 身份凭证无效。",
		);
	}

	const header = decodeJwtPart<{ alg?: string; kid?: string }>(parts[0]);
	const claims = decodeJwtPart<AccessClaims>(parts[1]);
	if (header.alg !== "RS256" || !header.kid) {
		throw new HttpError(
			401,
			"invalid_access_token",
			"Cloudflare Access 身份凭证无效。",
		);
	}
	const key = (await getAccessKeys(teamDomain)).find(
		(item) => item.kid === header.kid,
	);
	if (!key) {
		keyCache.delete(teamDomain);
		throw new HttpError(
			401,
			"unknown_access_key",
			"Cloudflare Access 签名密钥已更新，请重新登录。",
		);
	}
	const cryptoKey = await crypto.subtle.importKey(
		"jwk",
		key,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	const validSignature = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		base64UrlBytes(parts[2]),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
	const now = Math.floor(Date.now() / 1000);
	const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	const expectedIssuer = `https://${teamDomain}`;
	const email = claims.email?.trim().toLowerCase() || "";
	if (
		!validSignature ||
		claims.iss?.replace(/\/+$/, "") !== expectedIssuer ||
		!audience.includes(expectedAudience) ||
		!claims.exp ||
		claims.exp <= now ||
		(claims.nbf ?? 0) > now ||
		!allowedEmails.includes(email)
	) {
		throw new HttpError(
			403,
			"author_forbidden",
			"当前 Cloudflare Access 账号没有作者权限。",
		);
	}
	return { email };
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

async function githubError(response: Response): Promise<HttpError> {
	const payload = (await response.json().catch(() => ({}))) as {
		message?: string;
	};
	const messages: Record<number, string> = {
		401: "Cloudflare 中保存的 GitHub Token 无效或已过期。",
		403: "GitHub Token 没有 Firefly 仓库的 Contents 读写权限。",
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
	if (!response.ok) throw await githubError(response);
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
	if (!response.ok) throw await githubError(response);
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
	else if (current.status !== 404) throw await githubError(current);
	const slug = fileName.slice(0, -3);
	return writeGitHubFile(
		env,
		path,
		content,
		`${draft ? "chore" : "feat"}(content): ${sha ? "update" : "publish"} ${slug}`,
		sha,
	);
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

async function handleAuthorApi(request: Request, env: Env): Promise<Response> {
	assertSameOrigin(request);
	const author = await verifyAuthor(request, env);
	const url = new URL(request.url);
	const path = url.pathname.slice(apiPrefix.length) || "/";

	if (request.method === "GET" && path === "/login") {
		const returnTo = url.searchParams.get("returnTo") || "/write/";
		const safeReturnTo =
			returnTo.startsWith("/") && !returnTo.startsWith("//")
				? returnTo
				: "/write/";
		return Response.redirect(new URL(safeReturnTo, url.origin), 302);
	}
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
