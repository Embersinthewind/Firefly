export type AuthorFileKey = "site" | "profile" | "portfolio" | "navigation";

export type AuthorSession = {
	authorized: true;
	email: string;
	repository: string;
	branch: string;
};

export type AuthorFile = {
	content: string;
	sha: string;
};

export type AuthorWriteResult = {
	commitUrl: string;
	sha: string;
};

export type AuthorImageUploadResult = {
	links?: { download?: string; share?: string };
	file?: { url?: string; name?: string };
	error?: { message?: string };
	message?: string;
};

export class AuthorApiError extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function authorRequest<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		const isFormData = init?.body instanceof FormData;
		response = await fetch(`/api/author${path}`, {
			...init,
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				...(init?.body && !isFormData
					? { "Content-Type": "application/json" }
					: {}),
				...init?.headers,
			},
		});
	} catch {
		throw new AuthorApiError(
			0,
			"network_error",
			"无法连接 Cloudflare 作者代理。",
		);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (response.redirected && !contentType.includes("application/json")) {
		throw new AuthorApiError(
			401,
			"author_login_required",
			"请先登录作者模式。",
		);
	}
	const payload = (await response.json().catch(() => ({}))) as {
		code?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new AuthorApiError(
			response.status,
			payload.code || "request_failed",
			payload.message || `作者代理请求失败（${response.status}）。`,
		);
	}
	return payload as T;
}

export async function getAuthorSession(): Promise<AuthorSession | null> {
	try {
		return await authorRequest<AuthorSession>("/session");
	} catch (error) {
		if (error instanceof AuthorApiError && [0, 401, 403].includes(error.status))
			return null;
		throw error;
	}
}

export function openAuthorLogin(returnTo = window.location.pathname): void {
	window.location.assign(
		`/api/author/login?returnTo=${encodeURIComponent(returnTo)}`,
	);
}

export function logoutAuthor(): void {
	window.location.assign(
		`/api/author/logout?returnTo=${encodeURIComponent(window.location.pathname)}`,
	);
}

export function clearLegacyAuthorTokens(): void {
	for (const key of [
		"firefly:config:github-token",
		"firefly:navigation:github-token",
	]) {
		localStorage.removeItem(key);
	}
}

export function readAuthorFile(key: AuthorFileKey): Promise<AuthorFile> {
	return authorRequest<AuthorFile>(`/files/${key}`);
}

export function writeAuthorFile(
	key: AuthorFileKey,
	content: string,
	sha: string,
): Promise<AuthorWriteResult> {
	return authorRequest<AuthorWriteResult>(`/files/${key}`, {
		method: "PUT",
		body: JSON.stringify({ content, sha }),
	});
}

export function publishAuthorArticle(input: {
	fileName: string;
	content: string;
	draft: boolean;
}): Promise<AuthorWriteResult> {
	return authorRequest<AuthorWriteResult>("/articles", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export function uploadAuthorImage(input: {
	file: File;
	baseUrl: string;
	token: string;
	storage?: string;
	folderPath?: string;
}): Promise<AuthorImageUploadResult> {
	const form = new FormData();
	form.append("file", input.file);
	form.append("baseUrl", input.baseUrl);
	form.append("token", input.token);
	if (input.storage?.trim()) form.append("storage", input.storage.trim());
	if (input.folderPath?.trim())
		form.append("folderPath", input.folderPath.trim());
	return authorRequest<AuthorImageUploadResult>("/images", {
		method: "POST",
		body: form,
	});
}
