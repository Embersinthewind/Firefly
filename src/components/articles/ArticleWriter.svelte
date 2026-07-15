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
	links?: {
		download?: string;
		share?: string;
	};
	file?: {
		url?: string;
		name?: string;
	};
	error?: {
		message?: string;
	};
	message?: string;
};

const settingsKey = "firefly:article-writer:kvault";
const today = new Date().toISOString().slice(0, 10);

let title = $state("");
let slug = $state("");
let published = $state(today);
let category = $state("");
let tags = $state("");
let description = $state("");
let cover = $state("");
let draft = $state(false);
let content = $state(
	"从这里开始写正文。\n\n把图片拖到编辑区，或用右侧按钮上传到 K-Vault 后自动插入 Markdown 图片链接。",
);
let settings = $state<WriterSettings>({
	baseUrl: "",
	token: "",
	storage: "telegram",
	folderPath: "blog",
	linkMode: "download",
});
let uploadStatus = $state("尚未上传");
let copyStatus = $state("复制 Markdown");
let isUploading = $state(false);
let previewHtml = $state("");
let textareaRef: HTMLTextAreaElement | undefined = $state();

const normalizedTags = $derived(
	tags
		.split(/[,，\n]/)
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
		published: published || today,
		draft,
		description: description.trim(),
		image: cover.trim(),
		tags: normalizedTags,
		category: category.trim(),
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
	Promise.resolve(marked.parse(content || "", { async: false })).then(
		(html) => {
			previewHtml = DOMPurify.sanitize(String(html));
		},
	);
});

function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

function insertAtCursor(text: string): void {
	const target = textareaRef;
	if (!target) {
		content = `${content}\n\n${text}`;
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

function pickUploadUrl(response: UploadResponse): string {
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

async function uploadFile(file: File): Promise<void> {
	const baseUrl = normalizeBaseUrl(settings.baseUrl);
	if (!baseUrl) {
		uploadStatus = "请先填写 K-Vault 访问地址";
		return;
	}

	isUploading = true;
	uploadStatus = `正在上传 ${file.name} ...`;

	try {
		const formData = new FormData();
		formData.append("file", file);
		if (settings.storage.trim())
			formData.append("storage", settings.storage.trim());
		if (settings.folderPath.trim()) {
			formData.append("folderPath", settings.folderPath.trim());
		}

		const headers: HeadersInit = {};
		if (settings.token.trim()) {
			headers.Authorization = `Bearer ${settings.token.trim()}`;
		}

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
		if (!link) throw new Error("上传成功，但没有在响应中找到可用链接");

		const alt = file.name.replace(/\.[^.]+$/, "");
		insertAtCursor(`\n![${alt}](${link})\n`);
		if (!cover && file.type.startsWith("image/")) cover = link;
		uploadStatus = `已上传：${file.name}`;
	} catch (error) {
		uploadStatus = error instanceof Error ? error.message : "上传失败";
	} finally {
		isUploading = false;
	}
}

async function handleFileInput(event: Event): Promise<void> {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;
	await uploadFile(file);
	input.value = "";
}

async function handleDrop(event: DragEvent): Promise<void> {
	event.preventDefault();
	const file = event.dataTransfer?.files?.[0];
	if (file) await uploadFile(file);
}

async function copyMarkdown(): Promise<void> {
	await navigator.clipboard.writeText(markdown);
	copyStatus = "已复制";
	setTimeout(() => {
		copyStatus = "复制 Markdown";
	}, 1800);
}

function downloadMarkdown(): void {
	const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(href);
}
</script>

<section class="writer-shell">
	<div class="writer-panel writer-panel--editor card-base">
		<header class="writer-header">
			<div>
				<p>Article Studio</p>
				<h1>写文章</h1>
				<span>在浏览器里整理 frontmatter、正文和 K-Vault 图片链接，最后复制到 <code>src/content/posts</code>。</span>
			</div>
			<div class="writer-actions">
				<button type="button" on:click={copyMarkdown}>{copyStatus}</button>
				<button type="button" class="primary" on:click={downloadMarkdown}>下载 {fileName}</button>
			</div>
		</header>

		<div class="meta-grid">
			<label>
				<span>标题</span>
				<input bind:value={title} placeholder="文章标题" />
			</label>
			<label>
				<span>文件名 / Slug</span>
				<input bind:value={slug} placeholder={safeSlug} />
			</label>
			<label>
				<span>发布时间</span>
				<input type="date" bind:value={published} />
			</label>
			<label>
				<span>分类</span>
				<input bind:value={category} placeholder="例如：随笔" />
			</label>
			<label class="span-2">
				<span>标签</span>
				<input bind:value={tags} placeholder="用逗号分隔，例如 Astro, 图床, 博客" />
			</label>
			<label class="span-2">
				<span>摘要</span>
				<textarea rows="3" bind:value={description} placeholder="给首页和 SEO 使用的一句话摘要"></textarea>
			</label>
			<label class="span-2">
				<span>封面图 URL</span>
				<input bind:value={cover} placeholder="上传第一张图片后会自动填入，也可以手动粘贴 K-Vault 直链" />
			</label>
			<label class="check-line">
				<input type="checkbox" bind:checked={draft} />
				<span>保存为草稿</span>
			</label>
		</div>

		<label class="content-field" on:dragover|preventDefault on:drop={handleDrop}>
			<span>正文 Markdown</span>
			<textarea bind:this={textareaRef} bind:value={content} rows="20"></textarea>
		</label>
	</div>

	<aside class="writer-side">
		<section class="writer-panel card-base">
			<header class="side-title">
				<p>K-Vault 图床</p>
				<strong>上传并插入图片</strong>
			</header>
			<label>
				<span>K-Vault 地址</span>
				<input bind:value={settings.baseUrl} placeholder="https://img.example.com" />
			</label>
			<label>
				<span>API Token</span>
				<input type="password" bind:value={settings.token} placeholder="kvault_xxxxxxxxxxxx" />
			</label>
			<div class="two-cols">
				<label>
					<span>存储后端</span>
					<input bind:value={settings.storage} placeholder="telegram" />
				</label>
				<label>
					<span>返回链接</span>
					<select bind:value={settings.linkMode}>
						<option value="download">直链 download</option>
						<option value="share">分享页 share</option>
					</select>
				</label>
			</div>
			<label>
				<span>目录</span>
				<input bind:value={settings.folderPath} placeholder="blog" />
			</label>
			<label class="upload-box">
				<input type="file" accept="image/*" on:change={handleFileInput} disabled={isUploading} />
				<span>{isUploading ? "上传中..." : "选择图片上传"}</span>
				<small>{uploadStatus}</small>
			</label>
			<p class="hint">
				Token 只保存在当前浏览器的 localStorage，不会写入仓库。K-Vault 后台创建 Token 时需要勾选 <code>upload</code> 权限。
			</p>
		</section>

		<section class="writer-panel card-base">
			<header class="side-title">
				<p>Frontmatter</p>
				<strong>生成结果</strong>
			</header>
			<pre>{markdown}</pre>
		</section>
	</aside>
</section>

<section class="writer-panel preview-panel card-base">
	<header class="side-title">
		<p>Preview</p>
		<strong>正文预览</strong>
	</header>
	<div class="markdown-preview">{@html previewHtml}</div>
</section>

<style>
	.writer-shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
		gap: 1rem;
		align-items: start;
	}

	.writer-panel {
		padding: 1.25rem;
	}

	.writer-panel--editor {
		min-width: 0;
	}

	.writer-header {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-bottom: 1.2rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.writer-header p,
	.side-title p {
		margin: 0 0 0.15rem;
		color: var(--primary);
		font-size: 0.78rem;
		font-weight: 750;
	}

	.writer-header h1 {
		margin: 0;
		color: var(--deep-text);
		font-size: 1.65rem;
		line-height: 1.25;
	}

	.writer-header span,
	.hint,
	.upload-box small {
		color: var(--content-meta);
		font-size: 0.8rem;
		line-height: 1.7;
	}

	.writer-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-content: start;
		justify-content: flex-end;
	}

	button,
	.upload-box span {
		min-height: 2.35rem;
		padding: 0.55rem 0.85rem;
		border-radius: 0.6rem;
		background: var(--btn-regular-bg);
		color: var(--deep-text);
		font-size: 0.82rem;
		font-weight: 700;
		transition: background-color 180ms ease-out, color 180ms ease-out, transform 180ms ease-out;
	}

	button:hover,
	.upload-box:hover span {
		background: var(--btn-regular-bg-hover);
		color: var(--primary);
		transform: translateY(-1px);
	}

	button.primary {
		background: var(--primary);
		color: oklch(0.18 0.02 var(--hue));
	}

	.meta-grid,
	.two-cols {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
	}

	.meta-grid {
		margin-top: 1rem;
	}

	label {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.4rem;
	}

	label > span,
	.side-title strong {
		color: var(--deep-text);
		font-size: 0.86rem;
		font-weight: 730;
	}

	input,
	textarea,
	select {
		width: 100%;
		border: 1px solid var(--line-color);
		border-radius: 0.65rem;
		background: var(--card-bg);
		color: var(--deep-text);
		font: inherit;
		font-size: 0.88rem;
		outline: none;
		padding: 0.7rem 0.8rem;
		transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
	}

	textarea {
		resize: vertical;
		line-height: 1.7;
	}

	input:focus,
	textarea:focus,
	select:focus {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 18%, transparent);
	}

	.span-2,
	.content-field {
		grid-column: 1 / -1;
	}

	.content-field {
		margin-top: 1rem;
	}

	.content-field textarea {
		font-family: "JetBrains Mono", "Fira Code", Consolas, monospace;
		font-size: 0.86rem;
	}

	.check-line {
		align-items: center;
		flex-direction: row;
		justify-content: flex-start;
	}

	.check-line input {
		width: auto;
	}

	.writer-side {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
	}

	.writer-side .writer-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.side-title {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.upload-box input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	.upload-box span,
	.upload-box small {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.hint {
		margin: 0;
	}

	pre {
		overflow: auto;
		max-height: 20rem;
		margin: 0;
		padding: 0.85rem;
		border-radius: 0.65rem;
		background: var(--codeblock-bg);
		color: var(--deep-text);
		font-size: 0.72rem;
		line-height: 1.65;
		white-space: pre-wrap;
	}

	.preview-panel {
		margin-top: 1rem;
	}

	.markdown-preview {
		color: var(--deep-text);
		font-size: 0.95rem;
		line-height: 1.8;
	}

	.markdown-preview :global(img) {
		max-width: 100%;
		border-radius: 0.8rem;
	}

	@media (max-width: 1100px) {
		.writer-shell {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.writer-panel {
			padding: 1rem;
		}

		.writer-header,
		.meta-grid,
		.two-cols {
			grid-template-columns: 1fr;
		}

		.writer-header {
			flex-direction: column;
		}

		.writer-actions {
			justify-content: flex-start;
		}
	}
</style>
