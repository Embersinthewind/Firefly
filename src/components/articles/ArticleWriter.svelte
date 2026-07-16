<script lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { onMount } from "svelte";
import YAML from "yaml";
import {
	defaultKVaultWriterSettings,
	type KVaultWriterSettings,
	writerStorageKeys,
} from "@/config/writerConfig";
import type { SiteEditorGitHubConfig } from "@/types/portfolioConfig";

type UploadResponse = {
	links?: { download?: string; share?: string };
	file?: { url?: string; name?: string };
	error?: { message?: string };
	message?: string;
};

type ImportedFrontmatter = {
	title?: unknown;
	published?: unknown;
	draft?: unknown;
	pinned?: unknown;
	description?: unknown;
	image?: unknown;
	tags?: unknown;
	category?: unknown;
};

type ArticleDraft = {
	title: string;
	published: string;
	category: string;
	tags: string;
	description: string;
	cover: string;
	draft: boolean;
	pinned: boolean;
	content: string;
};

const {
	categories = [],
	repository,
}: {
	categories?: string[];
	repository: SiteEditorGitHubConfig;
} = $props();

const today = new Date().toISOString().slice(0, 10);
let title = $state("");
let published = $state(today);
let category = $state(categories[0] || "");
let tags = $state("");
let description = $state("");
let cover = $state("");
let draft = $state(false);
let pinned = $state(false);
let content = $state("");
let editorMode = $state<"write" | "preview">("write");
let settings = $state<KVaultWriterSettings>({
	...defaultKVaultWriterSettings,
});
let status = $state("准备就绪");
let statusTone = $state<"neutral" | "success" | "error">("neutral");
let isUploading = $state(false);
let isPublishing = $state(false);
let previewHtml = $state("");
let textareaRef: HTMLTextAreaElement | undefined = $state();
let githubTokenInput = $state("");
let githubUser = $state("");
let githubAuthorized = $state(false);
let authOpen = $state(false);

const normalizedTags = $derived(
	tags
		.split(/[#＃,，\n]+/)
		.map((tag) => tag.trim())
		.filter(Boolean),
);

const safeSlug = $derived(
	title
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_-]/gu, "") || "new-post",
);

const frontmatter = $derived(
	YAML.stringify({
		title: title.trim() || "未命名文章",
		published: published || today,
		draft,
		pinned,
		description: description.trim(),
		image: cover.trim(),
		tags: normalizedTags,
		category: category.trim(),
	}),
);

const markdown = $derived(`---\n${frontmatter}---\n\n${content.trim()}\n`);
const fileName = $derived(`${safeSlug}.md`);

$effect(() => {
	Promise.resolve(marked.parse(content || "", { async: false })).then(
		(html) => {
			previewHtml = DOMPurify.sanitize(String(html));
		},
	);
});

onMount(() => {
	const rawSettings = localStorage.getItem(writerStorageKeys.kvault);
	if (rawSettings) {
		try {
			settings = {
				...defaultKVaultWriterSettings,
				...(JSON.parse(rawSettings) as Partial<KVaultWriterSettings>),
			};
		} catch {
			localStorage.removeItem(writerStorageKeys.kvault);
		}
	}

	const storedToken = localStorage.getItem(writerStorageKeys.githubToken);
	if (storedToken) {
		githubTokenInput = storedToken;
		void connectGitHub(true);
	}
});

function setStatus(
	message: string,
	tone: "neutral" | "success" | "error" = "neutral",
) {
	status = message;
	statusTone = tone;
}

function normalizeBaseUrl(value: string) {
	return value.trim().replace(/\/+$/, "");
}

function insertAtCursor(text: string) {
	const target = textareaRef;
	if (!target) {
		content = `${content}${text}`;
		return;
	}
	const start = target.selectionStart ?? content.length;
	const end = target.selectionEnd ?? content.length;
	content = `${content.slice(0, start)}${text}${content.slice(end)}`;
	requestAnimationFrame(() => {
		target.focus();
		target.selectionStart = target.selectionEnd = start + text.length;
	});
}

function wrapSelection(before: string, after = before, placeholder = "文本") {
	const target = textareaRef;
	if (!target) return;
	const start = target.selectionStart ?? 0;
	const end = target.selectionEnd ?? start;
	const selected = content.slice(start, end) || placeholder;
	content = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
	requestAnimationFrame(() => {
		target.focus();
		target.selectionStart = start + before.length;
		target.selectionEnd = start + before.length + selected.length;
	});
}

function prefixLine(prefix: string) {
	const target = textareaRef;
	if (!target) return;
	const cursor = target.selectionStart ?? 0;
	const lineStart = content.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
	content = `${content.slice(0, lineStart)}${prefix}${content.slice(lineStart)}`;
	requestAnimationFrame(() => {
		target.focus();
		target.selectionStart = target.selectionEnd = cursor + prefix.length;
	});
}

function pickUploadUrl(response: UploadResponse) {
	const preferred =
		settings.linkMode === "share"
			? response.links?.share
			: response.links?.download;
	return (
		preferred ||
		response.links?.download ||
		response.links?.share ||
		response.file?.url ||
		""
	);
}

async function uploadAsset(file: File, purpose: "body" | "cover") {
	const baseUrl = normalizeBaseUrl(settings.baseUrl);
	if (!baseUrl || !settings.token.trim()) {
		setStatus("请先到“站点设置 → 写作设置”配置 K-Vault。", "error");
		return;
	}
	isUploading = true;
	setStatus(`正在上传 ${file.name}…`);
	try {
		const formData = new FormData();
		formData.append("file", file);
		if (settings.storage.trim())
			formData.append("storage", settings.storage.trim());
		if (settings.folderPath.trim())
			formData.append("folderPath", settings.folderPath.trim());
		const response = await fetch(`${baseUrl}/api/v1/upload`, {
			method: "POST",
			headers: { Authorization: `Bearer ${settings.token.trim()}` },
			body: formData,
		});
		const data = (await response.json().catch(() => ({}))) as UploadResponse;
		if (!response.ok) {
			throw new Error(
				data.error?.message ||
					data.message ||
					`上传失败：HTTP ${response.status}`,
			);
		}
		const link = pickUploadUrl(data);
		if (!link) throw new Error("上传成功，但响应中没有可用链接");
		if (purpose === "cover") cover = link;
		else insertAtCursor(`\n![${file.name.replace(/\.[^.]+$/, "")}](${link})\n`);
		setStatus(`${file.name} 已上传到 K-Vault。`, "success");
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "图片上传失败。",
			"error",
		);
	} finally {
		isUploading = false;
	}
}

async function handleCoverInput(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (file) await uploadAsset(file, "cover");
	input.value = "";
}

async function handleBodyImageInput(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (file) await uploadAsset(file, "body");
	input.value = "";
}

async function handlePaste(event: ClipboardEvent) {
	const item = Array.from(event.clipboardData?.items || []).find((entry) =>
		entry.type.startsWith("image/"),
	);
	const clipboardFile = Array.from(event.clipboardData?.files || []).find(
		(entry) => entry.type.startsWith("image/"),
	);
	const file = item?.getAsFile() || clipboardFile;
	if (!file) return;
	event.preventDefault();
	await uploadAsset(file, "body");
}

async function handleDrop(event: DragEvent) {
	event.preventDefault();
	const file = Array.from(event.dataTransfer?.files || []).find((entry) =>
		entry.type.startsWith("image/"),
	);
	if (file) await uploadAsset(file, "body");
}

function dateValue(value: unknown) {
	if (value instanceof Date && !Number.isNaN(value.getTime()))
		return value.toISOString().slice(0, 10);
	if (typeof value === "string" || typeof value === "number") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime()))
			return parsed.toISOString().slice(0, 10);
	}
	return today;
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}

function applyDraft(article: Partial<ArticleDraft>) {
	title = article.title ?? "";
	published = article.published ?? today;
	category = article.category ?? categories[0] ?? "";
	tags = article.tags ?? "";
	description = article.description ?? "";
	cover = article.cover ?? "";
	draft = article.draft ?? false;
	pinned = article.pinned ?? false;
	content = article.content ?? "";
}

function currentDraft(): ArticleDraft {
	return {
		title,
		published,
		category,
		tags,
		description,
		cover,
		draft,
		pinned,
		content,
	};
}

function saveBrowserDraft() {
	localStorage.setItem(writerStorageKeys.draft, JSON.stringify(currentDraft()));
	setStatus("文章草稿已保存到当前浏览器。", "success");
}

function loadBrowserDraft() {
	const raw = localStorage.getItem(writerStorageKeys.draft);
	if (!raw) {
		setStatus("当前浏览器没有文章草稿。", "error");
		return;
	}
	try {
		applyDraft(JSON.parse(raw) as ArticleDraft);
		setStatus("已载入浏览器草稿。", "success");
	} catch {
		setStatus("浏览器草稿格式无效。", "error");
	}
}

async function importMarkdown(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	try {
		const source = await file.text();
		const match = source.match(
			/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?([\s\S]*)$/,
		);
		const data = (match ? YAML.parse(match[1]) : {}) as ImportedFrontmatter;
		const importedTags = Array.isArray(data.tags)
			? data.tags.map(stringValue)
			: stringValue(data.tags).split(/[,，#＃]+/);
		applyDraft({
			title: stringValue(data.title),
			published: dateValue(data.published),
			draft: data.draft === true,
			pinned: data.pinned === true,
			description: stringValue(data.description),
			cover: stringValue(data.image),
			category: stringValue(data.category),
			tags: importedTags
				.map((tag) => tag.trim())
				.filter(Boolean)
				.join(" #"),
			content: (match ? match[2] : source).trim(),
		});
		setStatus(`${file.name} 已载入当前文章。`, "success");
	} catch (error) {
		setStatus(
			error instanceof Error ? `导入失败：${error.message}` : "导入失败。",
			"error",
		);
	} finally {
		input.value = "";
	}
}

function downloadMarkdown() {
	const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(href);
}

function githubHeaders(token: string) {
	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

function encodeBase64(value: string) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

function contentEndpoint() {
	const path = `${repository.postsDir}/${fileName}`
		.split("/")
		.map(encodeURIComponent)
		.join("/");
	return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/${path}`;
}

async function connectGitHub(silent = false) {
	const token = githubTokenInput.trim();
	if (!token) {
		setStatus("请输入 GitHub Token。", "error");
		return;
	}
	if (!silent) setStatus("正在验证 GitHub 仓库权限…");
	try {
		const [userResponse, repoResponse] = await Promise.all([
			fetch("https://api.github.com/user", {
				headers: githubHeaders(token),
			}),
			fetch(
				`https://api.github.com/repos/${repository.owner}/${repository.repo}`,
				{ headers: githubHeaders(token) },
			),
		]);
		if (!userResponse.ok || !repoResponse.ok)
			throw new Error("Token 无效或无法访问目标仓库。");
		const user = (await userResponse.json()) as { login: string };
		const repo = (await repoResponse.json()) as {
			permissions?: { push?: boolean };
		};
		if (!repo.permissions?.push)
			throw new Error("当前 Token 没有目标仓库的写入权限。");
		githubUser = user.login;
		githubAuthorized = true;
		authOpen = false;
		localStorage.setItem(writerStorageKeys.githubToken, token);
		setStatus(`已绑定 GitHub：${user.login}。`, "success");
	} catch (error) {
		githubUser = "";
		githubAuthorized = false;
		localStorage.removeItem(writerStorageKeys.githubToken);
		setStatus(
			error instanceof Error ? error.message : "GitHub 绑定失败。",
			"error",
		);
	}
}

function disconnectGitHub() {
	githubUser = "";
	githubAuthorized = false;
	githubTokenInput = "";
	localStorage.removeItem(writerStorageKeys.githubToken);
	setStatus("已退出 GitHub 发布模式。");
}

async function publishArticle() {
	if (!githubAuthorized) {
		authOpen = true;
		setStatus("绑定 GitHub 后才能发布文章。", "error");
		return;
	}
	if (!title.trim() || !content.trim()) {
		setStatus("文章标题和正文不能为空。", "error");
		return;
	}
	const token =
		localStorage.getItem(writerStorageKeys.githubToken) ||
		githubTokenInput.trim();
	if (!token) return;
	isPublishing = true;
	setStatus(draft ? "正在提交草稿…" : "正在发布文章…");
	try {
		const endpoint = contentEndpoint();
		const currentResponse = await fetch(
			`${endpoint}?ref=${encodeURIComponent(repository.branch)}`,
			{ headers: githubHeaders(token) },
		);
		let sha: string | undefined;
		if (currentResponse.ok) {
			const current = (await currentResponse.json()) as { sha?: string };
			sha = current.sha;
		} else if (currentResponse.status !== 404) {
			throw new Error(`读取远程文章失败（${currentResponse.status}）。`);
		}
		const response = await fetch(endpoint, {
			method: "PUT",
			headers: {
				...githubHeaders(token),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				message: `${draft ? "chore" : "feat"}(content): ${sha ? "update" : "publish"} ${safeSlug}`,
				content: encodeBase64(markdown),
				sha,
				branch: repository.branch,
			}),
		});
		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as {
				message?: string;
			} | null;
			throw new Error(
				payload?.message || `GitHub 提交失败（${response.status}）。`,
			);
		}
		localStorage.removeItem(writerStorageKeys.draft);
		setStatus(
			draft
				? "草稿已提交到 GitHub，暂不会在正式站点显示。"
				: "文章已提交到 main，Cloudflare 将自动部署。",
			"success",
		);
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "文章发布失败。",
			"error",
		);
	} finally {
		isPublishing = false;
	}
}
</script>

<section class="writer-studio card-base">
	<div class="writer-actions">
		<div class="writer-actions__group">
			<label class="file-action"><input type="file" accept=".md,.mdx,text/markdown" onchange={importMarkdown} /><span>上传 MD</span></label>
			<button type="button" onclick={downloadMarkdown}>下载 MD</button>
			<button type="button" onclick={saveBrowserDraft}>保存草稿</button>
			<button type="button" onclick={loadBrowserDraft}>载入草稿</button>
		</div>
		<div class="writer-actions__group">
			{#if githubAuthorized}
				<button type="button" class="github-state" onclick={disconnectGitHub} title="点击退出 GitHub">{githubUser}</button>
			{:else}
				<button type="button" onclick={() => (authOpen = !authOpen)}>绑定 GitHub</button>
			{/if}
			<button type="button" class="primary" onclick={publishArticle} disabled={isPublishing}>{isPublishing ? "提交中…" : draft ? "提交草稿" : "发布文章"}</button>
		</div>
	</div>

	{#if authOpen && !githubAuthorized}
		<div class="github-auth">
			<input type="password" bind:value={githubTokenInput} placeholder="GitHub Token，将保存在当前设备浏览器" autocomplete="off" />
			<button type="button" class="primary" onclick={() => connectGitHub(false)}>验证并绑定</button>
		</div>
	{/if}

	<input class="title-input" bind:value={title} placeholder="输入文章标题…" aria-label="文章标题" />

	<div class="meta-grid" aria-label="文章设置">
		<label class="meta-wide">文章摘要<input bind:value={description} placeholder="用于文章列表与 SEO 的简短摘要" /></label>
		<label>标签<input bind:value={tags} placeholder="使用 # 分隔，例如 #技术 #Astro" /></label>
		<label>分类<input bind:value={category} list="writer-category-list" placeholder="选择或输入分类" /></label>
		<datalist id="writer-category-list">{#each categories as item}<option value={item}></option>{/each}</datalist>
		<label>发布日期<input type="date" bind:value={published} /></label>
		<div class="cover-control">
			<span>封面图片</span>
			{#if cover}<img src={cover} alt="文章封面预览" />{/if}
			<label class="cover-upload"><input type="file" accept="image/*" onchange={handleCoverInput} disabled={isUploading} /><span>{cover ? "更换封面" : "上传封面"}</span></label>
			{#if cover}<button type="button" class="icon-button" onclick={() => (cover = "")} aria-label="移除封面">×</button>{/if}
		</div>
		<div class="publish-flags">
			<label><input type="checkbox" bind:checked={draft} /><span>草稿</span></label>
			<label><input type="checkbox" bind:checked={pinned} /><span>置顶</span></label>
		</div>
	</div>

	<div class="editor-toolbar" aria-label="Markdown 编辑工具">
		<button type="button" onclick={() => wrapSelection("**", "**")} aria-label="加粗">B</button>
		<button type="button" class="italic" onclick={() => wrapSelection("*", "*")} aria-label="斜体">I</button>
		<button type="button" onclick={() => prefixLine("## ")} aria-label="二级标题">H2</button>
		<button type="button" onclick={() => prefixLine("### ")} aria-label="三级标题">H3</button>
		<button type="button" onclick={() => prefixLine("> ")} aria-label="引用">❝</button>
		<button type="button" onclick={() => wrapSelection("`", "`")} aria-label="行内代码">&lt;/&gt;</button>
		<button type="button" onclick={() => prefixLine("- ")} aria-label="无序列表">☷</button>
		<button type="button" onclick={() => prefixLine("1. ")} aria-label="有序列表">☰</button>
		<button type="button" onclick={() => wrapSelection("[", "](https://)", "链接文字")} aria-label="链接">↗</button>
		<label class="toolbar-upload" title="上传正文图片"><input type="file" accept="image/*" onchange={handleBodyImageInput} disabled={isUploading} /><span aria-hidden="true">▣</span><span class="sr-only">上传正文图片</span></label>
		<span class="toolbar-spacer"></span>
		<button type="button" class:active={editorMode === "write"} onclick={() => (editorMode = "write")}>编辑</button>
		<button type="button" class:active={editorMode === "preview"} onclick={() => (editorMode = "preview")}>预览</button>
	</div>

	{#if editorMode === "write"}
		<textarea class="markdown-editor" bind:this={textareaRef} bind:value={content} onpaste={handlePaste} ondragover={(event) => event.preventDefault()} ondrop={handleDrop} placeholder="开始写作… 支持 Markdown，也可以直接粘贴或拖入图片。"></textarea>
	{:else}
		<div class="markdown-preview">{@html previewHtml || "<p>还没有正文内容。</p>"}</div>
	{/if}

	<footer class:status-success={statusTone === "success"} class:status-error={statusTone === "error"} class="editor-status" role="status">
		<span>{content.length.toLocaleString()} 字符</span><span>{status}</span>
		{#if !settings.baseUrl || !settings.token}<a href="/config/">配置 K-Vault</a>{/if}
	</footer>
</section>

<style>
	.writer-studio { overflow: hidden; color: var(--deep-text); }
	.writer-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .7rem .85rem; border-bottom: 1px solid var(--line-divider); background: color-mix(in oklch, var(--btn-regular-bg) 35%, var(--card-bg)); }
	.writer-actions__group { display: flex; flex-wrap: wrap; gap: .4rem; }
	button, .file-action > span, .cover-upload > span { display: inline-flex; align-items: center; justify-content: center; min-height: 2.25rem; padding: .42rem .7rem; border: 1px solid var(--line-divider); border-radius: .45rem; background: var(--card-bg); color: var(--deep-text); font-size: .72rem; font-weight: 800; cursor: pointer; }
	button:hover, .file-action:hover > span, .cover-upload:hover > span { border-color: var(--primary); color: var(--primary); }
	button.primary { border-color: var(--primary); background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	button:disabled { cursor: wait; opacity: .58; }
	.github-state { color: var(--primary); }
	.file-action input, .toolbar-upload input, .cover-upload input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
	.github-auth { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; padding: .75rem .85rem; border-bottom: 1px solid var(--line-divider); background: color-mix(in oklch, var(--primary) 7%, var(--card-bg)); }
	.github-auth input { min-width: 0; }
	.title-input { width: 100%; min-height: 5rem; padding: 1rem 1.25rem; border: 0; border-bottom: 1px solid var(--line-divider); background: transparent; color: var(--deep-text); font-size: 2.15rem; font-weight: 850; letter-spacing: -.035em; outline: none; }
	.meta-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .65rem; padding: .85rem; border-bottom: 1px solid var(--line-divider); background: color-mix(in oklch, var(--btn-regular-bg) 28%, var(--card-bg)); }
	.meta-grid > label { display: grid; gap: .3rem; min-width: 0; color: var(--content-meta); font-size: .68rem; font-weight: 800; }
	.meta-wide { grid-column: span 2; }
	.meta-grid input, .github-auth input { width: 100%; min-height: 2.35rem; padding: .48rem .6rem; border: 1px solid var(--line-divider); border-radius: .45rem; background: var(--card-bg); color: var(--deep-text); font: inherit; font-size: .73rem; outline: none; }
	.meta-grid input::placeholder, .github-auth input::placeholder, .markdown-editor::placeholder { color: color-mix(in oklch, var(--content-meta) 55%, transparent); opacity: 1; }
	.cover-control { display: flex; align-items: center; gap: .4rem; min-width: 0; }
	.cover-control > span:first-child { color: var(--content-meta); font-size: .68rem; font-weight: 800; white-space: nowrap; }
	.cover-control img { width: 2.35rem; height: 2.35rem; object-fit: cover; border-radius: .4rem; }
	.cover-upload > span { min-height: 2.35rem; white-space: nowrap; }
	.icon-button { width: 2.1rem; min-height: 2.1rem; padding: 0; }
	.publish-flags { display: flex; align-items: center; gap: .65rem; }
	.publish-flags label { display: flex; align-items: center; gap: .3rem; color: var(--deep-text); font-size: .72rem; font-weight: 750; }
	.publish-flags input { width: 1rem; min-height: 1rem; accent-color: var(--primary); }
	.editor-toolbar { display: flex; align-items: center; gap: .15rem; overflow-x: auto; padding: .42rem .7rem; border-bottom: 1px solid var(--line-divider); scrollbar-width: thin; }
	.editor-toolbar button, .toolbar-upload { display: grid; place-items: center; flex: 0 0 auto; width: 2.15rem; height: 2.15rem; min-height: 0; padding: 0; border: 0; border-radius: .4rem; background: transparent; color: var(--content-meta); font-size: .7rem; font-weight: 850; cursor: pointer; }
	.editor-toolbar button:hover, .editor-toolbar button.active, .toolbar-upload:hover { background: var(--btn-regular-bg); color: var(--primary); }
	.italic { font-style: italic; }
	.toolbar-spacer { flex: 1; }
	.markdown-editor, .markdown-preview { box-sizing: border-box; width: 100%; min-height: 42rem; padding: 1.35rem 1.5rem; border: 0; background: transparent; color: var(--deep-text); font-size: .9rem; line-height: 1.85; outline: none; }
	.markdown-editor { resize: vertical; font-family: "JetBrains Mono", "Fira Code", Consolas, monospace; }
	.markdown-preview { overflow: auto; }
	.markdown-preview :global(img) { max-width: 100%; border-radius: .6rem; }
	.editor-status { display: flex; flex-wrap: wrap; gap: .8rem; padding: .55rem .9rem; border-top: 1px solid var(--line-divider); color: var(--content-meta); font-size: .68rem; }
	.editor-status a { margin-left: auto; color: var(--primary); font-weight: 750; }
	.status-success { color: color-mix(in oklch, #15803d 78%, var(--deep-text)); }
	.status-error { color: #dc2626; }
	input:focus-visible, textarea:focus-visible, button:focus-visible, .file-action:focus-within span, .cover-upload:focus-within span, .toolbar-upload:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
	@media (max-width: 1100px) { .meta-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@media (max-width: 640px) { .writer-actions { align-items: stretch; flex-direction: column; } .writer-actions__group > * { flex: 1; } .github-auth { grid-template-columns: 1fr; } .title-input { font-size: 1.65rem; } .meta-grid { grid-template-columns: 1fr 1fr; } .meta-wide { grid-column: span 2; } .cover-control, .publish-flags { grid-column: span 2; } .markdown-editor, .markdown-preview { min-height: 34rem; padding-inline: 1rem; } }
</style>
