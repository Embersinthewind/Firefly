<script lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import YAML from "yaml";

type LinkMode = "download" | "share";
type WriterSettings = {
	baseUrl: string;
	token: string;
	storage: string;
	folderPath: string;
	linkMode: LinkMode;
};

type UploadResponse = {
	links?: { download?: string; share?: string };
	file?: { url?: string; name?: string };
	error?: { message?: string };
	message?: string;
};

type ImportedFrontmatter = {
	title?: unknown;
	slug?: unknown;
	published?: unknown;
	draft?: unknown;
	pinned?: unknown;
	description?: unknown;
	image?: unknown;
	tags?: unknown;
	category?: unknown;
	views?: unknown;
};

const { categories = [] }: { categories?: string[] } = $props();
const settingsKey = "firefly:article-writer:kvault";
const today = new Date().toISOString().slice(0, 10);

let title = $state("");
let slug = $state("");
let published = $state(today);
let category = $state(categories[0] || "");
let tags = $state("");
let description = $state("");
let cover = $state("");
let draft = $state(false);
let pinned = $state(false);
let views = $state(0);
let content = $state("");
let editorMode = $state<"write" | "preview">("write");
let settings = $state<WriterSettings>({
	baseUrl: "",
	token: "",
	storage: "telegram",
	folderPath: "blog",
	linkMode: "download",
});
let uploadStatus = $state("可直接粘贴或拖入图片");
let importStatus = $state("");
let isUploading = $state(false);
let previewHtml = $state("");
let textareaRef: HTMLTextAreaElement | undefined = $state();

const normalizedTags = $derived(
	tags
		.split(/[#＃,，\n]+/)
		.map((tag) => tag.trim())
		.filter(Boolean),
);

const safeSlug = $derived(
	slug.trim() ||
		title
			.trim()
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^\p{L}\p{N}_-]/gu, "") ||
		"new-post",
);

const frontmatter = $derived(
	YAML.stringify({
		title: title.trim() || "未命名文章",
		slug: safeSlug,
		published: published || today,
		draft,
		pinned,
		description: description.trim(),
		image: cover.trim(),
		tags: normalizedTags,
		category: category.trim(),
		views: Math.max(0, Number(views) || 0),
	}),
);

const markdown = $derived(`---\n${frontmatter}---\n\n${content.trim()}\n`);
const fileName = $derived(`${safeSlug}.md`);

$effect(() => {
	if (typeof localStorage === "undefined") return;
	const raw = localStorage.getItem(settingsKey);
	if (!raw) return;
	try {
		settings = { ...settings, ...JSON.parse(raw) };
	} catch {
		// 忽略损坏的本地配置。
	}
});

$effect(() => {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(settingsKey, JSON.stringify(settings));
});

$effect(() => {
	if (typeof window === "undefined") return;
	const value = Math.max(0, Number(views) || 0);
	localStorage.setItem("firefly:article-writer:views", String(value));
	window.dispatchEvent(
		new CustomEvent("firefly:article-writer:views", {
			detail: value,
		}),
	);
});

$effect(() => {
	Promise.resolve(marked.parse(content || "", { async: false })).then(
		(html) => {
			previewHtml = DOMPurify.sanitize(String(html));
		},
	);
});

function normalizeBaseUrl(value: string) {
	return value.trim().replace(/\/+$/, "");
}

function insertAtCursor(text: string, selectOffset = 0) {
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
		target.selectionStart = target.selectionEnd =
			start + text.length - selectOffset;
	});
}

function wrapSelection(before: string, after = before, placeholder = "文本") {
	const target = textareaRef;
	if (!target) return;
	const start = target.selectionStart ?? 0;
	const end = target.selectionEnd ?? start;
	const selected = content.slice(start, end) || placeholder;
	const next = `${before}${selected}${after}`;
	content = `${content.slice(0, start)}${next}${content.slice(end)}`;
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
	if (!baseUrl) {
		uploadStatus = "请先展开图片自动上传设置，填写 K-Vault 地址";
		return;
	}

	isUploading = true;
	uploadStatus = `正在上传 ${file.name}…`;
	try {
		const formData = new FormData();
		formData.append("file", file);
		if (settings.storage.trim())
			formData.append("storage", settings.storage.trim());
		if (settings.folderPath.trim())
			formData.append("folderPath", settings.folderPath.trim());
		const headers: HeadersInit = {};
		if (settings.token.trim())
			headers.Authorization = `Bearer ${settings.token.trim()}`;
		const response = await fetch(`${baseUrl}/api/v1/upload`, {
			method: "POST",
			headers,
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
		if (purpose === "cover") {
			cover = link;
		} else {
			const alt = file.name.replace(/\.[^.]+$/, "");
			insertAtCursor(`\n![${alt}](${link})\n`);
		}
		uploadStatus = `${file.name} 已上传到 K-Vault`;
	} catch (error) {
		uploadStatus = error instanceof Error ? error.message : "图片上传失败";
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
	const file = item?.getAsFile();
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
		title = stringValue(data.title);
		slug = stringValue(data.slug) || file.name.replace(/\.mdx?$/i, "");
		published = dateValue(data.published);
		draft = data.draft === true;
		pinned = data.pinned === true;
		description = stringValue(data.description);
		cover = stringValue(data.image);
		category = stringValue(data.category);
		views = Math.max(0, Number(data.views) || 0);
		const importedTags = Array.isArray(data.tags)
			? data.tags.map(stringValue)
			: stringValue(data.tags).split(/[,，#＃]+/);
		tags = importedTags
			.map((tag) => tag.trim())
			.filter(Boolean)
			.join(" #");
		content = (match ? match[2] : source).trim();
		importStatus = `${file.name} 已载入当前文章`;
	} catch (error) {
		importStatus =
			error instanceof Error ? `导入失败：${error.message}` : "导入失败";
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
</script>

<section class="writer-studio card-base">
	<header class="writer-heading">
		<div>
			<h1>写文章</h1>
			<p>专注 Markdown 写作，图片粘贴后自动上传到 K-Vault。</p>
		</div>
		<div class="writer-actions">
			<label class="file-action">
				<input type="file" accept=".md,.mdx,text/markdown" onchange={importMarkdown} />
				<span>上传 MD</span>
			</label>
			<button type="button" class="primary" onclick={downloadMarkdown}>下载 MD</button>
		</div>
	</header>

	<div class="writer-grid">
		<div class="editor-column">
			<input class="title-input" bind:value={title} placeholder="输入文章标题…" aria-label="文章标题" />
			<div class="editor-toolbar" aria-label="Markdown 编辑工具">
				<button type="button" onclick={() => wrapSelection("**", "**")} aria-label="加粗" title="加粗">B</button>
				<button type="button" class="italic" onclick={() => wrapSelection("*", "*")} aria-label="斜体" title="斜体">I</button>
				<button type="button" onclick={() => prefixLine("## ")} aria-label="二级标题" title="二级标题">H2</button>
				<button type="button" onclick={() => prefixLine("### ")} aria-label="三级标题" title="三级标题">H3</button>
				<button type="button" onclick={() => prefixLine("> ")} aria-label="引用" title="引用">❝</button>
				<button type="button" onclick={() => wrapSelection("`", "`")} aria-label="行内代码" title="行内代码">&lt;/&gt;</button>
				<button type="button" onclick={() => prefixLine("- ")} aria-label="无序列表" title="无序列表">☷</button>
				<button type="button" onclick={() => prefixLine("1. ")} aria-label="有序列表" title="有序列表">☰</button>
				<button type="button" onclick={() => wrapSelection("[", "](https://)", "链接文字")} aria-label="链接" title="链接">↗</button>
				<label class="toolbar-upload" title="上传正文图片">
					<input type="file" accept="image/*" onchange={handleBodyImageInput} disabled={isUploading} />
					<span aria-hidden="true">▣</span><span class="sr-only">上传正文图片</span>
				</label>
				<span class="toolbar-spacer"></span>
				<button type="button" class:active={editorMode === "write"} onclick={() => (editorMode = "write")}>编辑</button>
				<button type="button" class:active={editorMode === "preview"} onclick={() => (editorMode = "preview")}>预览</button>
			</div>

			{#if editorMode === "write"}
				<textarea
					class="markdown-editor"
					bind:this={textareaRef}
					bind:value={content}
					onpaste={handlePaste}
					ondragover={(event) => event.preventDefault()}
					ondrop={handleDrop}
					placeholder="开始写作… 支持 Markdown 语法，也可以直接粘贴图片。"
				></textarea>
			{:else}
				<div class="markdown-preview">{@html previewHtml || "<p>还没有正文内容。</p>"}</div>
			{/if}
			<footer class="editor-status">
				<span>{content.length.toLocaleString()} 字符</span>
				<span class:is-error={uploadStatus.includes("失败") || uploadStatus.includes("请先")}>{uploadStatus}</span>
				{#if importStatus}<span>{importStatus}</span>{/if}
			</footer>
		</div>

		<aside class="meta-column" aria-label="文章设置">
			<label>文章 Slug<input bind:value={slug} placeholder={safeSlug} /></label>
			<label>文章摘要<textarea rows="3" bind:value={description} placeholder="用于文章列表与 SEO"></textarea></label>
			<label>标签 <small>使用 # 分隔</small><input bind:value={tags} placeholder="#Astro #博客 #教程" /></label>
			<label>分类<input bind:value={category} list="writer-category-list" placeholder="选择或输入分类" /></label>
			<datalist id="writer-category-list">{#each categories as item}<option value={item}></option>{/each}</datalist>
			<label>发布日期<input type="date" bind:value={published} /></label>
			<label>文章浏览量<input type="number" min="0" step="1" bind:value={views} /></label>

			<div class="cover-field">
				<div class="field-label">封面图片</div>
				{#if cover}
					<div class="cover-preview">
						<img src={cover} alt="文章封面预览" />
						<button type="button" onclick={() => (cover = "")} aria-label="移除封面">×</button>
					</div>
				{/if}
				<label class="cover-upload">
					<input type="file" accept="image/*" onchange={handleCoverInput} disabled={isUploading} />
					<span>{cover ? "重新上传封面" : "上传封面图片"}</span>
				</label>
			</div>

			<div class="switches">
				<label><input type="checkbox" bind:checked={draft} /><span>草稿（不发布）</span></label>
				<label><input type="checkbox" bind:checked={pinned} /><span>置顶文章</span></label>
			</div>

			<details class="kvault-settings">
				<summary>K-Vault 图片自动上传设置</summary>
				<label>K-Vault 地址<input bind:value={settings.baseUrl} placeholder="https://img.example.com" /></label>
				<label>API Token<input type="password" bind:value={settings.token} placeholder="kvault_xxxxxxxxxxxx" /></label>
				<div class="settings-grid">
					<label>存储后端<input bind:value={settings.storage} placeholder="telegram" /></label>
					<label>目录<input bind:value={settings.folderPath} placeholder="blog" /></label>
				</div>
				<label>返回链接<select bind:value={settings.linkMode}><option value="download">图片直链</option><option value="share">分享链接</option></select></label>
				<p>配置保存在当前浏览器。正文中粘贴或拖入图片时会自动上传并插入 Markdown。</p>
			</details>
		</aside>
	</div>
</section>

<style>
	.writer-studio {
		overflow: hidden;
		color: var(--deep-text);
	}

	.writer-heading {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.4rem 1.5rem 1.1rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.writer-heading h1 {
		margin: 0;
		font-size: clamp(2.2rem, 5vw, 4rem);
		line-height: 0.95;
		letter-spacing: -0.04em;
	}

	.writer-heading p {
		margin: 0.45rem 0 0;
		color: var(--content-meta);
		font-size: 0.8rem;
	}

	.writer-actions {
		display: flex;
		gap: 0.5rem;
	}

	button,
	.file-action > span,
	.cover-upload > span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.4rem;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: var(--card-bg);
		color: var(--deep-text);
		font-size: 0.76rem;
		font-weight: 800;
		cursor: pointer;
	}

	button.primary {
		border-color: var(--primary);
		background: var(--primary);
		color: oklch(0.18 0.02 var(--hue));
	}

	.file-action input,
	.toolbar-upload input,
	.cover-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.writer-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(15rem, 18rem);
		min-height: 50rem;
	}

	.editor-column {
		display: flex;
		min-width: 0;
		flex-direction: column;
		border-right: 1px solid var(--line-divider);
	}

	.title-input {
		width: 100%;
		min-height: 6.3rem;
		padding: 1.5rem 1.6rem;
		border: 0;
		border-bottom: 1px solid var(--line-divider);
		background: transparent;
		color: var(--deep-text);
		font-size: clamp(1.7rem, 4vw, 2.7rem);
		font-weight: 850;
		letter-spacing: -0.035em;
		outline: none;
	}

	.editor-toolbar {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		overflow-x: auto;
		padding: 0.45rem 0.75rem;
		border-bottom: 1px solid var(--line-divider);
		scrollbar-width: thin;
	}

	.editor-toolbar button,
	.toolbar-upload {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.25rem;
		height: 2.25rem;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.72rem;
		font-weight: 850;
		cursor: pointer;
	}

	.editor-toolbar button:hover,
	.editor-toolbar button.active,
	.toolbar-upload:hover {
		background: var(--btn-regular-bg);
		color: var(--primary);
	}

	.editor-toolbar .italic {
		font-style: italic;
	}

	.toolbar-spacer {
		flex: 1;
	}

	.markdown-editor,
	.markdown-preview {
		box-sizing: border-box;
		width: 100%;
		min-height: 38rem;
		flex: 1;
		padding: 1.55rem 1.7rem;
		border: 0;
		background: transparent;
		color: var(--deep-text);
		font-size: 0.9rem;
		line-height: 1.85;
		outline: none;
	}

	.markdown-editor {
		resize: vertical;
		font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
	}

	.markdown-preview {
		overflow: auto;
	}

	.markdown-preview :global(img) {
		max-width: 100%;
		border-radius: 0.6rem;
	}

	.editor-status {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		padding: 0.55rem 1rem;
		border-top: 1px solid var(--line-divider);
		color: var(--content-meta);
		font-size: 0.68rem;
	}

	.editor-status .is-error {
		color: #dc2626;
	}

	.meta-column {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		background: color-mix(in oklch, var(--btn-regular-bg) 28%, var(--card-bg));
	}

	.meta-column > label,
	.kvault-settings label {
		display: grid;
		gap: 0.38rem;
		color: var(--deep-text);
		font-size: 0.75rem;
		font-weight: 800;
	}

	.meta-column small {
		color: var(--content-meta);
		font-weight: 600;
	}

	.meta-column input,
	.meta-column textarea,
	.meta-column select,
	.kvault-settings input,
	.kvault-settings select {
		width: 100%;
		min-height: 2.55rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--line-divider);
		border-radius: 0.5rem;
		background: var(--card-bg);
		color: var(--deep-text);
		font: inherit;
		font-size: 0.76rem;
		outline: none;
	}

	.meta-column textarea {
		resize: vertical;
		line-height: 1.55;
	}

	.meta-column input:focus,
	.meta-column textarea:focus,
	.meta-column select:focus,
	.title-input:focus,
	.markdown-editor:focus {
		box-shadow: inset 0 0 0 2px var(--primary);
	}

	.cover-field {
		display: grid;
		gap: 0.5rem;
	}

	.field-label {
		font-size: 0.75rem;
		font-weight: 800;
	}

	.cover-preview {
		position: relative;
		overflow: hidden;
		aspect-ratio: 16 / 9;
		border-radius: 0.55rem;
		background: var(--btn-regular-bg);
	}

	.cover-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-preview button {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 1.8rem;
		height: 1.8rem;
		min-height: 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.68);
		color: white;
	}

	.cover-upload > span {
		width: 100%;
		background: var(--btn-regular-bg);
	}

	.switches {
		display: grid;
		gap: 0.55rem;
		padding: 0.85rem;
		border-top: 1px solid var(--line-divider);
		border-bottom: 1px solid var(--line-divider);
	}

	.switches label {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.75rem;
		font-weight: 750;
	}

	.switches input {
		width: 1rem;
		min-height: 1rem;
		accent-color: var(--primary);
	}

	.kvault-settings {
		padding-top: 0.2rem;
		font-size: 0.74rem;
	}

	.kvault-settings summary {
		color: var(--deep-text);
		font-weight: 850;
		cursor: pointer;
	}

	.kvault-settings[open] {
		display: grid;
		gap: 0.75rem;
	}

	.kvault-settings p {
		margin: 0;
		color: var(--content-meta);
		font-size: 0.68rem;
		line-height: 1.55;
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem;
	}

	button:focus-visible,
	.file-action:focus-within span,
	.cover-upload:focus-within span,
	.toolbar-upload:focus-within {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	@media (max-width: 900px) {
		.writer-grid {
			grid-template-columns: 1fr;
		}

		.editor-column {
			border-right: 0;
			border-bottom: 1px solid var(--line-divider);
		}
	}

	@media (max-width: 640px) {
		.writer-heading {
			align-items: flex-start;
			flex-direction: column;
			padding: 1.1rem;
		}

		.writer-actions {
			width: 100%;
		}

		.writer-actions > * {
			flex: 1;
		}

		.title-input,
		.markdown-editor,
		.markdown-preview {
			padding-inline: 1rem;
		}

		.settings-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
