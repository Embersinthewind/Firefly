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
	readAuthorFile,
	uploadAuthorImage,
	writeAuthorFile,
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

type ContentImage = {
	key: string;
	alt: string;
	src: string;
	start: number;
	end: number;
	width: number;
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
let availableCategories = $state(
	Array.from(new Set(categories.map((item) => item.trim()).filter(Boolean))),
);
let category = $state(availableCategories[0] || "");
let showNewCategory = $state(false);
let newCategoryName = $state("");
let isSavingCategory = $state(false);
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

const contentImages = $derived.by(() => {
	const images: ContentImage[] = [];
	const markdownPattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
	const htmlPattern = /<img\b[^>]*>/gi;
	for (const match of content.matchAll(markdownPattern)) {
		images.push({
			key: `${match.index}-${match[2]}`,
			alt: match[1] || "正文图片",
			src: match[2],
			start: match.index,
			end: match.index + match[0].length,
			width: 100,
		});
	}
	for (const match of content.matchAll(htmlPattern)) {
		const source = match[0].match(/\bsrc=["']([^"']+)["']/i)?.[1];
		if (!source) continue;
		const alt = match[0].match(/\balt=["']([^"']*)["']/i)?.[1] || "正文图片";
		const widthValue =
			match[0].match(/\bwidth=["']?(\d+)%?["']?/i)?.[1] ||
			match[0].match(/\bwidth\s*:\s*(\d+)%/i)?.[1];
		images.push({
			key: `${match.index}-${source}`,
			alt,
			src: source,
			start: match.index,
			end: match.index + match[0].length,
			width: Math.min(100, Math.max(30, Number(widthValue) || 100)),
		});
	}
	return images.sort((left, right) => left.start - right.start);
});

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

function escapeImageAttribute(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function resizeContentImage(image: ContentImage, direction: -1 | 1) {
	const width = Math.min(100, Math.max(30, image.width + direction * 10));
	const replacement = `<img src="${escapeImageAttribute(image.src)}" alt="${escapeImageAttribute(image.alt)}" style="width: ${width}%; height: auto;" />`;
	content = `${content.slice(0, image.start)}${replacement}${content.slice(image.end)}`;
	setStatus(`正文图片宽度已调整为 ${width}%。`, "success");
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

function normalizeCategory(value: string) {
	return value.trim().replace(/\s+/g, " ");
}

function handleCategorySelect(event: Event) {
	const value = (event.currentTarget as HTMLSelectElement).value;
	if (value === "__new_category__") {
		showNewCategory = true;
		newCategoryName = "";
		return;
	}
	category = value;
	showNewCategory = false;
}

function parseCategoryFile(content: string): string[] {
	const data = JSON.parse(content) as { categories?: unknown };
	if (!Array.isArray(data.categories)) return [];
	return data.categories
		.filter((item): item is string => typeof item === "string")
		.map(normalizeCategory)
		.filter(Boolean);
}

async function createArticleCategory() {
	const name = normalizeCategory(newCategoryName);
	if (!name) {
		setStatus("请输入分类名称。", "error");
		return;
	}
	if (name.length > 40) {
		setStatus("分类名称不能超过 40 个字符。", "error");
		return;
	}
	if (availableCategories.includes(name)) {
		category = name;
		showNewCategory = false;
		setStatus(`已选择分类“${name}”。`, "success");
		return;
	}
	if (!githubAuthorized) {
		setStatus("请先登录作者模式，再新建分类。", "error");
		openAuthorLogin(window.location.pathname);
		return;
	}

	isSavingCategory = true;
	setStatus("正在创建分类…");
	try {
		const file = await readAuthorFile("articleCategories");
		const storedCategories = parseCategoryFile(file.content);
		const nextCategories = Array.from(
			new Set([...storedCategories, ...availableCategories, name]),
		);
		await writeAuthorFile(
			"articleCategories",
			`${JSON.stringify({ categories: nextCategories }, null, "\t")}\n`,
			file.sha,
		);
		availableCategories = nextCategories;
		category = name;
		newCategoryName = "";
		showNewCategory = false;
		setStatus(`分类“${name}”已创建并选中。`, "success");
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "新建分类失败。",
			"error",
		);
	} finally {
		isSavingCategory = false;
	}
}

function applyDraft(article: Partial<ArticleDraft>) {
	title = article.title ?? "";
	published = article.published ?? today;
	category = article.category ?? availableCategories[0] ?? "";
	if (category && !availableCategories.includes(category)) {
		availableCategories = [...availableCategories, category];
	}
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
			<a class="action-link" href="/articles/"><span aria-hidden="true">←</span> 返回列表</a>
			<label class="file-action action-quiet"><input type="file" accept=".md,.mdx,text/markdown" onchange={importMarkdown} /><span><b aria-hidden="true">⇧</b> 导入 MD</span></label>
			<button type="button" class="action-quiet" onclick={() => (editorMode = editorMode === "write" ? "preview" : "write")}><span aria-hidden="true">{editorMode === "write" ? "◉" : "✎"}</span> {editorMode === "write" ? "预览" : "返回编辑"}</button>
		</div>
		<div class="writer-actions__group">
			<button type="button" class="action-quiet" onclick={downloadMarkdown}><span aria-hidden="true">↓</span> 下载 MD</button>
			<button type="button" class="action-save" onclick={saveBrowserDraft}><span aria-hidden="true">▣</span> 保存草稿</button>
			<button type="button" class="action-quiet" onclick={loadBrowserDraft}><span aria-hidden="true">↺</span> 载入草稿</button>
			{#if githubAuthorized}
				<button type="button" class="github-state" onclick={logoutAuthor} title="退出作者模式"><span aria-hidden="true">●</span> {githubUser}</button>
			{:else}
				<button type="button" class="action-auth" onclick={connectAuthor}><span aria-hidden="true">◇</span> 作者登录</button>
			{/if}
			<button type="button" class="primary" onclick={publishArticle} disabled={isPublishing}><span aria-hidden="true">↑</span> {isPublishing ? "提交中…" : draft ? "提交草稿" : "发布文章"}</button>
		</div>
	</div>

	<div class="writer-workspace">
		<main class="writer-canvas">
			<input class="title-input" bind:value={title} placeholder="输入文章标题…" aria-label="文章标题" />

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
			</div>

			{#if editorMode === "write" && contentImages.length > 0}
				<section class="editor-media" aria-label="正文图片实时预览">
					<header><strong>正文图片</strong><span>实时预览 · 缩放会同步写入 Markdown</span></header>
					<div class="editor-media__items">
						{#each contentImages as image (image.key)}
							<figure>
								<div class="editor-media__canvas"><img src={image.src} alt={image.alt} style={`width: ${image.width}%`} /></div>
								<figcaption>
									<span title={image.alt}>{image.alt}</span>
									<div class="image-size-controls" aria-label="调整图片大小">
										<button type="button" onclick={() => resizeContentImage(image, -1)} disabled={image.width <= 30} aria-label="缩小图片">−</button>
										<output>{image.width}%</output>
										<button type="button" onclick={() => resizeContentImage(image, 1)} disabled={image.width >= 100} aria-label="放大图片">＋</button>
									</div>
								</figcaption>
							</figure>
						{/each}
					</div>
				</section>
			{/if}

			{#if editorMode === "write"}
				<textarea class="markdown-editor" bind:this={textareaRef} bind:value={content} onpaste={handlePaste} ondragover={(event) => event.preventDefault()} ondrop={handleDrop} placeholder="开始写作… 支持 Markdown，也可以直接粘贴或拖入图片。"></textarea>
			{:else}
				<div class="markdown-preview">{@html previewHtml || "<p>还没有正文内容。</p>"}</div>
			{/if}
		</main>

		<aside class="writer-sidebar" aria-label="文章设置">
			<div class="settings-heading"><span aria-hidden="true">◫</span><div><strong>文章设置</strong><small>发布信息与展示选项</small></div></div>
			<div class="meta-grid">
				<label class="meta-wide">文章摘要<textarea bind:value={description} rows="4" placeholder="用于文章列表与 SEO 的简短摘要"></textarea></label>
				<label>标签<input bind:value={tags} placeholder="使用 # 分隔，例如 #技术 #Astro" /></label>
				<label class="category-field">
					分类
					<select value={category} onchange={handleCategorySelect} aria-label="选择或新建分类">
						{#if !category}<option value="" disabled>选择分类</option>{/if}
						{#each availableCategories as item}<option value={item}>{item}</option>{/each}
						<option value="__new_category__">＋ 新建分类…</option>
					</select>
				</label>
				{#if showNewCategory}
					<div class="category-create-inline">
						<input bind:value={newCategoryName} maxlength="40" placeholder="输入新分类名称" onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createArticleCategory(); } }} />
						<button type="button" onclick={createArticleCategory} disabled={isSavingCategory}>{isSavingCategory ? "创建中…" : "创建"}</button>
						<button type="button" class="category-create-cancel" onclick={() => (showNewCategory = false)} aria-label="取消新建分类">×</button>
					</div>
				{/if}
				<label>发布日期<input type="date" bind:value={published} /></label>
				<div class="cover-control">
					<span>封面图片</span>
					{#if coverPreview || cover}
						<div class="cover-preview-wrap">
							<label class="cover-preview" class:is-success={coverUploadState === "success"} class:is-error={coverUploadState === "error"} aria-live="polite" title="单击更换封面">
								<input type="file" accept="image/*" onchange={handleCoverInput} disabled={isUploading} />
								<img src={coverPreview || cover} alt="文章封面预览" />
								<span class="cover-preview__text">
									<strong>{coverUploadState === "uploading" ? "正在上传…" : coverUploadState === "success" ? "✓ 已上传" : coverUploadState === "error" ? "上传失败" : "封面预览"}</strong>
									<small title={coverFileName}>{coverFileName || "远程封面"}</small>
									{#if coverUploadState === "uploading"}<span class="cover-progress" aria-hidden="true"><span></span></span>{/if}
								</span>
							</label>
							<button type="button" class="cover-remove" onclick={clearCover} aria-label="移除封面" title="移除封面">×</button>
						</div>
					{:else}
						<label class="cover-upload"><input type="file" accept="image/*" onchange={handleCoverInput} disabled={isUploading} /><span>上传封面</span></label>
					{/if}
				</div>
				<div class="publish-flags">
					<label><input type="checkbox" bind:checked={draft} /><span>草稿（不发布）</span></label>
					<label><input type="checkbox" bind:checked={pinned} /><span>置顶文章</span></label>
				</div>
			</div>
		</aside>
	</div>

	<footer class:status-success={statusTone === "success"} class:status-error={statusTone === "error"} class="editor-status" role="status">
		<span>{content.length.toLocaleString()} 字符</span><span>{status}</span>
		{#if !settings.baseUrl || !settings.token}<a href="/config/">配置 K-Vault</a>{/if}
	</footer>
</section>

<style>
	.writer-studio { overflow: hidden; color: var(--deep-text); }
	.writer-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: .65rem .85rem; border-bottom: 1px solid var(--line-divider); background: var(--card-bg); }
	.writer-actions__group { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem; }
	button, .action-link, .file-action > span, .cover-upload > span { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; min-height: 2.3rem; padding: .42rem .7rem; border: 1px solid var(--line-divider); border-radius: .5rem; background: var(--card-bg); color: var(--deep-text); font-size: .72rem; font-weight: 800; line-height: 1; text-decoration: none; cursor: pointer; }
	button:hover, .action-link:hover, .file-action:hover > span, .cover-upload:hover > span { border-color: var(--primary); color: var(--primary); }
	.action-quiet, .action-link, .file-action.action-quiet > span { border-color: transparent; background: transparent; color: var(--content-meta); }
	.action-save { border-color: color-mix(in oklch, var(--primary) 48%, var(--line-divider)); color: var(--primary); }
	.action-auth { border-color: #f59e0b; color: #c56b00; }
	button.primary { border-color: var(--primary); background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	button:disabled { cursor: wait; opacity: .58; }
	.github-state { border-color: color-mix(in oklch, #15803d 48%, var(--line-divider)); color: color-mix(in oklch, #15803d 82%, var(--deep-text)); }
	.file-action input, .toolbar-upload input, .cover-upload input, .cover-preview input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

	.writer-workspace { display: grid; grid-template-columns: minmax(0, 1fr) clamp(16rem, 22vw, 19rem); min-height: 48rem; }
	.writer-canvas { min-width: 0; border-right: 1px solid var(--line-divider); background: var(--card-bg); }
	.writer-sidebar { min-width: 0; padding: 1rem; background: color-mix(in oklch, var(--btn-regular-bg) 32%, var(--card-bg)); }
	.settings-heading { display: flex; align-items: center; gap: .55rem; padding: .15rem .1rem .9rem; border-bottom: 1px solid var(--line-divider); }
	.settings-heading > span { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: .45rem; background: color-mix(in oklch, var(--primary) 12%, var(--card-bg)); color: var(--primary); font-weight: 900; }
	.settings-heading > div { display: grid; gap: .12rem; }
	.settings-heading strong { font-size: .82rem; }
	.settings-heading small { color: var(--content-meta); font-size: .62rem; }
	.title-input { box-sizing: border-box; width: 100%; min-height: 5.5rem; padding: 1.15rem 1.5rem; border: 0; border-bottom: 1px solid var(--line-divider); background: transparent; color: var(--deep-text); font-size: 2.15rem; font-weight: 850; letter-spacing: -.035em; outline: none; }

	.meta-grid { display: flex; flex-direction: column; gap: .8rem; padding-top: 1rem; }
	.meta-grid > label { display: grid; gap: .35rem; min-width: 0; color: var(--deep-text); font-size: .69rem; font-weight: 800; }
	.meta-grid input, .meta-grid textarea, .meta-grid select { box-sizing: border-box; width: 100%; min-height: 2.45rem; padding: .52rem .62rem; border: 1px solid var(--line-divider); border-radius: .45rem; background: var(--card-bg); color: var(--deep-text); font: inherit; font-size: .73rem; line-height: 1.55; outline: none; resize: vertical; }
	.meta-grid select { cursor: pointer; }
	.category-create-inline { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: .35rem; padding: .55rem; border: 1px solid color-mix(in oklch, var(--primary) 32%, var(--line-divider)); border-radius: .55rem; background: color-mix(in oklch, var(--primary) 5%, var(--card-bg)); }
	.category-create-inline button { min-height: 2.45rem; border-color: var(--primary); background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	.category-create-inline .category-create-cancel { width: 2.45rem; padding: 0; border-color: var(--line-divider); background: var(--card-bg); color: var(--content-meta); font-size: 1rem; }
	.meta-grid textarea { min-height: 5.5rem; }
	.meta-grid input::placeholder, .meta-grid textarea::placeholder, .markdown-editor::placeholder { color: color-mix(in oklch, var(--content-meta) 72%, transparent); opacity: 1; }
	.cover-control { display: grid; gap: .4rem; min-width: 0; }
	.cover-control > span:first-child { color: var(--deep-text); font-size: .69rem; font-weight: 800; }
	.cover-preview-wrap { position: relative; min-width: 0; }
	.cover-preview { display: flex; align-items: center; gap: .5rem; min-width: 0; padding: .3rem .55rem .3rem .3rem; border: 1px solid var(--line-divider); border-radius: .5rem; background: var(--card-bg); cursor: pointer; transition: border-color 180ms ease, background-color 180ms ease; }
	.cover-preview:hover { border-color: var(--primary); background: color-mix(in oklch, var(--primary) 5%, var(--card-bg)); }
	.cover-preview.is-success { border-color: color-mix(in oklch, #15803d 55%, var(--line-divider)); }
	.cover-preview.is-error { border-color: color-mix(in oklch, #dc2626 55%, var(--line-divider)); }
	.cover-preview img { width: 3rem; height: 3rem; flex: 0 0 auto; object-fit: cover; border-radius: .35rem; }
	.cover-preview__text { display: grid; gap: .1rem; min-width: 0; }
	.cover-preview__text strong { color: var(--deep-text); font-size: .7rem; white-space: nowrap; }
	.cover-preview.is-success .cover-preview__text strong { color: color-mix(in oklch, #15803d 78%, var(--deep-text)); }
	.cover-preview.is-error .cover-preview__text strong { color: #dc2626; }
	.cover-preview__text small { max-width: 8rem; overflow: hidden; color: var(--content-meta); font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
	.cover-progress { width: 6rem; height: .2rem; margin-top: .12rem; overflow: hidden; border-radius: 999px; background: color-mix(in oklch, var(--primary) 16%, var(--line-divider)); }
	.cover-progress > span { display: block; width: 42%; height: 100%; border-radius: inherit; background: var(--primary); animation: cover-upload-progress 1.05s ease-in-out infinite; }
	@keyframes cover-upload-progress { from { transform: translateX(-105%); } to { transform: translateX(245%); } }
	.cover-remove { position: absolute; top: -.4rem; right: -.4rem; width: 1.35rem; min-height: 1.35rem; padding: 0; border-color: color-mix(in oklch, #dc2626 45%, var(--line-divider)); border-radius: 999px; background: var(--card-bg); color: #dc2626; font-size: .8rem; line-height: 1; opacity: 0; transform: scale(.82); transition: opacity 160ms ease, transform 160ms ease; }
	.cover-preview-wrap:hover .cover-remove, .cover-preview-wrap:focus-within .cover-remove { opacity: 1; transform: scale(1); }
	.cover-upload > span { width: 100%; min-height: 2.45rem; }
	.publish-flags { display: grid; gap: .55rem; padding-top: .75rem; border-top: 1px solid var(--line-divider); }
	.publish-flags label { display: flex; align-items: center; gap: .4rem; color: var(--deep-text); font-size: .72rem; font-weight: 750; }
	.publish-flags input { width: 1rem; min-height: 1rem; accent-color: var(--primary); }

	.editor-toolbar { display: flex; align-items: center; gap: .15rem; overflow-x: auto; min-height: 3rem; padding: .4rem 1rem; border-bottom: 1px solid var(--line-divider); scrollbar-width: thin; }
	.editor-toolbar button, .toolbar-upload { display: grid; place-items: center; flex: 0 0 auto; width: 2.15rem; height: 2.15rem; min-height: 0; padding: 0; border: 0; border-radius: .4rem; background: transparent; color: var(--content-meta); font-size: .7rem; font-weight: 850; cursor: pointer; }
	.editor-toolbar button:hover, .toolbar-upload:hover { background: var(--btn-regular-bg); color: var(--primary); }
	.upload-feedback { max-width: 18rem; overflow: hidden; padding-inline: .5rem; color: var(--content-meta); font-size: .66rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
	.italic { font-style: italic; }
	.editor-media { padding: .65rem 1rem .8rem; border-bottom: 1px solid var(--line-divider); background: color-mix(in oklch, var(--btn-regular-bg) 24%, var(--card-bg)); }
	.editor-media > header { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .5rem; }
	.editor-media > header strong { font-size: .7rem; }
	.editor-media > header span { color: var(--content-meta); font-size: .62rem; }
	.editor-media__items { display: flex; gap: .65rem; overflow-x: auto; padding: .1rem .1rem .3rem; scrollbar-width: thin; }
	.editor-media figure { width: 14rem; flex: 0 0 auto; margin: 0; overflow: hidden; border: 1px solid var(--line-divider); border-radius: .55rem; background: var(--card-bg); }
	.editor-media__canvas { display: flex; min-height: 8rem; align-items: center; justify-content: center; padding: .5rem; background: color-mix(in oklch, var(--btn-regular-bg) 45%, var(--card-bg)); }
	.editor-media__canvas img { display: block; max-height: 12rem; object-fit: contain; transition: width 180ms ease; }
	.editor-media figcaption { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .4rem .5rem; }
	.editor-media figcaption > span { overflow: hidden; color: var(--content-meta); font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
	.image-size-controls { display: flex; align-items: center; gap: .15rem; flex: 0 0 auto; }
	.image-size-controls button { width: 1.6rem; min-height: 1.6rem; padding: 0; border: 0; background: var(--btn-regular-bg); font-size: .78rem; }
	.image-size-controls output { width: 2.4rem; color: var(--deep-text); font-size: .62rem; font-weight: 800; text-align: center; }
	.markdown-editor, .markdown-preview { box-sizing: border-box; width: 100%; min-height: 42rem; padding: 1.6rem 1.75rem; border: 0; background: transparent; color: var(--deep-text); font-size: .9rem; line-height: 1.85; outline: none; }
	.markdown-editor { resize: vertical; font-family: "JetBrains Mono", "Fira Code", Consolas, monospace; }
	.markdown-preview { overflow: auto; }
	.markdown-preview :global(img) { max-width: 100%; border-radius: .6rem; }
	.editor-status { display: flex; flex-wrap: wrap; gap: .8rem; padding: .6rem .9rem; border-top: 1px solid var(--line-divider); color: var(--content-meta); font-size: .68rem; }
	.editor-status a { margin-left: auto; color: var(--primary); font-weight: 750; }
	.status-success { color: color-mix(in oklch, #15803d 78%, var(--deep-text)); }
	.status-error { color: #dc2626; }
	input:focus-visible, textarea:focus-visible, button:focus-visible, .action-link:focus-visible, .file-action:focus-within span, .cover-upload:focus-within span, .cover-preview:focus-within, .toolbar-upload:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }

	@media (max-width: 960px) { .writer-workspace { grid-template-columns: 1fr; } .writer-canvas { border-right: 0; } .writer-sidebar { border-top: 1px solid var(--line-divider); } .meta-grid { display: grid; grid-template-columns: 1fr 1fr; } .meta-wide, .cover-control, .publish-flags { grid-column: 1 / -1; } }
	@media (hover: none) { .cover-remove { opacity: 1; transform: scale(1); } }
	@media (prefers-reduced-motion: reduce) { .cover-preview, .cover-remove, .editor-media__canvas img { transition: none; } .cover-progress > span { width: 70%; animation: none; } }
	@media (max-width: 640px) { .writer-actions { align-items: stretch; flex-direction: column; } .writer-actions__group { width: 100%; } .writer-actions__group > * { flex: 1; } .title-input { min-height: 4.75rem; padding-inline: 1rem; font-size: 1.65rem; } .meta-grid { grid-template-columns: 1fr; } .meta-wide, .cover-control, .publish-flags { grid-column: auto; } .markdown-editor, .markdown-preview { min-height: 34rem; padding-inline: 1rem; } }
</style>
