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
import {
	clearLegacyAuthorTokens,
	getAuthorSession,
	logoutAuthor,
	openAuthorLogin,
	publishAuthorArticle,
	uploadAuthorImage,
} from "@/utils/author-api";

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
let coverPreview = $state("");
let coverFileName = $state("");
let coverUploadState = $state<"idle" | "uploading" | "success" | "error">(
	"idle",
);
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
let githubUser = $state("");
let githubAuthorized = $state(false);

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

	clearLegacyAuthorTokens();
	void refreshAuthorSession();
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

function imagePreview(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ""));
		reader.onerror = () => reject(new Error("无法读取图片预览。"));
		reader.readAsDataURL(file);
	});
}

function clearCover() {
	cover = "";
	coverPreview = "";
	coverFileName = "";
	coverUploadState = "idle";
}

async function uploadAsset(file: File, purpose: "body" | "cover") {
	if (purpose === "cover") {
		coverFileName = file.name || "剪贴板图片";
		coverUploadState = "uploading";
		try {
			coverPreview = await imagePreview(file);
		} catch {
			coverPreview = "";
		}
	}
	const baseUrl = normalizeBaseUrl(settings.baseUrl);
	if (!baseUrl || !settings.token.trim()) {
		if (purpose === "cover") coverUploadState = "error";
		setStatus("请先到“站点设置 → 写作设置”配置 K-Vault。", "error");
		return;
	}
	isUploading = true;
	setStatus(`正在上传 ${file.name}…`);
	try {
		const data = await uploadAuthorImage({
			file,
			baseUrl,
			token: settings.token.trim(),
			storage: settings.storage,
			folderPath: settings.folderPath,
		});
		const link = pickUploadUrl(data);
		if (!link) throw new Error("上传成功，但响应中没有可用链接");
		if (purpose === "cover") {
			cover = link;
			coverUploadState = "success";
		} else
			insertAtCursor(`\n![${file.name.replace(/\.[^.]+$/, "")}](${link})\n`);
		setStatus(`${file.name} 已上传到 K-Vault。`, "success");
	} catch (error) {
		if (purpose === "cover") coverUploadState = "error";
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
	let file = item?.getAsFile() || clipboardFile;
	if (!file) {
		const html = event.clipboardData?.getData("text/html") || "";
		const source = new DOMParser()
			.parseFromString(html, "text/html")
			.querySelector("img")
			?.getAttribute("src");
		if (source?.startsWith("data:image/")) {
			const response = await fetch(source);
			const blob = await response.blob();
			const extension =
				blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
			file = new File([blob], `pasted-image-${Date.now()}.${extension}`, {
				type: blob.type,
			});
		}
	}
	if (!file) return;
	event.preventDefault();
	setStatus("检测到剪贴板图片，正在上传到 K-Vault…");
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
	coverPreview = "";
	coverFileName = cover ? "已载入的封面" : "";
	coverUploadState = cover ? "success" : "idle";
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

async function refreshAuthorSession() {
	try {
		const session = await getAuthorSession();
		githubAuthorized = Boolean(session);
		githubUser = session?.email || "";
		if (session) setStatus(`作者模式已登录：${session.email}。`, "success");
	} catch (error) {
		githubUser = "";
		githubAuthorized = false;
		setStatus(
			error instanceof Error ? error.message : "作者代理连接失败。",
			"error",
		);
	}
}

function connectAuthor() {
	openAuthorLogin(window.location.pathname);
}

async function publishArticle() {
	if (!githubAuthorized) {
		setStatus("请先登录作者模式后再发布文章。", "error");
		return;
	}
	if (!title.trim() || !content.trim()) {
		setStatus("文章标题和正文不能为空。", "error");
		return;
	}
	isPublishing = true;
	setStatus(draft ? "正在提交草稿…" : "正在发布文章…");
	try {
		await publishAuthorArticle({
			fileName,
			content: markdown,
			draft,
		});
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
				<button type="button" class="github-state" onclick={logoutAuthor} title="退出 Cloudflare 作者模式">{githubUser}</button>
			{:else}
				<button type="button" onclick={connectAuthor}>作者登录</button>
			{/if}
			<button type="button" class="primary" onclick={publishArticle} disabled={isPublishing}>{isPublishing ? "提交中…" : draft ? "提交草稿" : "发布文章"}</button>
		</div>
	</div>

	<input class="title-input" bind:value={title} placeholder="输入文章标题…" aria-label="文章标题" />

	<div class="meta-grid" aria-label="文章设置">
		<label class="meta-wide">文章摘要<input bind:value={description} placeholder="用于文章列表与 SEO 的简短摘要" /></label>
		<label>标签<input bind:value={tags} placeholder="使用 # 分隔，例如 #技术 #Astro" /></label>
		<label>分类<input bind:value={category} list="writer-category-list" placeholder="选择或输入分类" /></label>
		<datalist id="writer-category-list">{#each categories as item}<option value={item}></option>{/each}</datalist>
		<label>发布日期<input type="date" bind:value={published} /></label>
		<div class="cover-control">
			<span>封面图片</span>
			{#if coverPreview || cover}
				<div class="cover-preview" class:is-success={coverUploadState === "success"} class:is-error={coverUploadState === "error"} aria-live="polite">
					<img src={coverPreview || cover} alt="文章封面预览" />
					<span class="cover-preview__text">
						<strong>{coverUploadState === "uploading" ? "正在上传…" : coverUploadState === "success" ? "✓ 已上传" : coverUploadState === "error" ? "上传失败" : "封面预览"}</strong>
						<small title={coverFileName}>{coverFileName || "远程封面"}</small>
					</span>
				</div>
			{/if}
			<label class="cover-upload"><input type="file" accept="image/*" onchange={handleCoverInput} disabled={isUploading} /><span>{cover ? "更换封面" : "上传封面"}</span></label>
			{#if coverPreview || cover}<button type="button" class="icon-button" onclick={clearCover} aria-label="移除封面">×</button>{/if}
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
		{#if isUploading || statusTone !== "neutral"}<span class:status-success={statusTone === "success"} class:status-error={statusTone === "error"} class="upload-feedback" role="status">{isUploading ? "图片上传中…" : status}</span>{/if}
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
	.cover-control { display: flex; align-items: center; gap: .45rem; min-width: 0; grid-column: span 2; }
	.cover-control > span:first-child { color: var(--content-meta); font-size: .68rem; font-weight: 800; white-space: nowrap; }
	.cover-preview { display: flex; align-items: center; gap: .5rem; min-width: 0; padding: .25rem .55rem .25rem .25rem; border: 1px solid var(--line-divider); border-radius: .5rem; background: var(--card-bg); }
	.cover-preview.is-success { border-color: color-mix(in oklch, #15803d 55%, var(--line-divider)); }
	.cover-preview.is-error { border-color: color-mix(in oklch, #dc2626 55%, var(--line-divider)); }
	.cover-preview img { width: 3rem; height: 3rem; flex: 0 0 auto; object-fit: cover; border-radius: .35rem; }
	.cover-preview__text { display: grid; gap: .1rem; min-width: 0; }
	.cover-preview__text strong { color: var(--deep-text); font-size: .7rem; white-space: nowrap; }
	.cover-preview.is-success .cover-preview__text strong { color: color-mix(in oklch, #15803d 78%, var(--deep-text)); }
	.cover-preview.is-error .cover-preview__text strong { color: #dc2626; }
	.cover-preview__text small { max-width: 8rem; overflow: hidden; color: var(--content-meta); font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
	.cover-upload > span { min-height: 2.35rem; white-space: nowrap; }
	.icon-button { width: 2.1rem; min-height: 2.1rem; padding: 0; }
	.publish-flags { display: flex; align-items: center; gap: .65rem; }
	.publish-flags label { display: flex; align-items: center; gap: .3rem; color: var(--deep-text); font-size: .72rem; font-weight: 750; }
	.publish-flags input { width: 1rem; min-height: 1rem; accent-color: var(--primary); }
	.editor-toolbar { display: flex; align-items: center; gap: .15rem; overflow-x: auto; padding: .42rem .7rem; border-bottom: 1px solid var(--line-divider); scrollbar-width: thin; }
	.editor-toolbar button, .toolbar-upload { display: grid; place-items: center; flex: 0 0 auto; width: 2.15rem; height: 2.15rem; min-height: 0; padding: 0; border: 0; border-radius: .4rem; background: transparent; color: var(--content-meta); font-size: .7rem; font-weight: 850; cursor: pointer; }
	.editor-toolbar button:hover, .editor-toolbar button.active, .toolbar-upload:hover { background: var(--btn-regular-bg); color: var(--primary); }
	.upload-feedback { max-width: 20rem; overflow: hidden; padding-inline: .5rem; color: var(--content-meta); font-size: .66rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
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
