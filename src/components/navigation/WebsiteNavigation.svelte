<script lang="ts">
import { onMount } from "svelte";
import type {
	NavigationCategory,
	NavigationData,
	NavigationGitHubConfig,
	NavigationItem,
} from "@/types/navigationConfig";
import {
	clearLegacyAuthorTokens,
	getAuthorSession,
	logoutAuthor,
	openAuthorLogin,
	readAuthorFile,
	writeAuthorFile,
} from "@/utils/author-api";

type ItemDraft = {
	categoryId: string;
	title: string;
	url: string;
	description: string;
	icon: string;
};

let { initialData } = $props<{
	initialData: NavigationData;
	githubConfig: NavigationGitHubConfig;
}>();

const cloneData = (value: NavigationData): NavigationData =>
	JSON.parse(JSON.stringify(value)) as NavigationData;

let navigation = $state<NavigationData>(cloneData(initialData));
let baseline = $state<NavigationData>(cloneData(initialData));
let selectedCategory = $state("all");
let query = $state("");
let repositorySha = $state("");
let githubUser = $state("");
let isConnecting = $state(false);
let isSaving = $state(false);
let isDirty = $state(false);
let status = $state("游客模式：导航内容只读");
let statusKind = $state<"neutral" | "success" | "error">("neutral");
let editorOpen = $state(false);
let editingItemId = $state<string | null>(null);
let categoryEditorOpen = $state(false);
let editingCategoryId = $state<string | null>(null);
let categoryName = $state("");
let draft = $state<ItemDraft>({
	categoryId: navigation.categories[0]?.id ?? "",
	title: "",
	url: "https://",
	description: "",
	icon: "",
});

const totalItems = $derived(
	navigation.categories.reduce(
		(sum, category) => sum + category.items.length,
		0,
	),
);

const filteredCategories = $derived.by(() => {
	const normalizedQuery = query.trim().toLowerCase();
	return navigation.categories
		.filter(
			(category) =>
				selectedCategory === "all" || category.id === selectedCategory,
		)
		.map((category) => ({
			...category,
			items: category.items.filter((item) => {
				if (!normalizedQuery) return true;
				return [item.title, item.description, item.url, category.name]
					.join(" ")
					.toLowerCase()
					.includes(normalizedQuery);
			}),
		}))
		.filter((category) => category.items.length > 0 || !normalizedQuery);
});

const isOwner = $derived(Boolean(githubUser));

onMount(() => {
	clearLegacyAuthorTokens();
	void connectGitHub(true);
});

function setStatus(
	message: string,
	kind: "neutral" | "success" | "error" = "neutral",
): void {
	status = message;
	statusKind = kind;
}

function isNavigationData(value: unknown): value is NavigationData {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<NavigationData>;
	return (
		typeof candidate.title === "string" &&
		typeof candidate.description === "string" &&
		Array.isArray(candidate.categories) &&
		candidate.categories.every(
			(category) =>
				category &&
				typeof category.id === "string" &&
				typeof category.name === "string" &&
				Array.isArray(category.items),
		)
	);
}

async function connectGitHub(silent = false): Promise<void> {
	isConnecting = true;
	if (!silent) setStatus("正在验证 Cloudflare 作者身份…");

	try {
		const session = await getAuthorSession();
		if (!session) {
			githubUser = "";
			repositorySha = "";
			if (!silent) openAuthorLogin(window.location.pathname);
			return;
		}
		const file = await readAuthorFile("navigation");
		const parsed = JSON.parse(file.content) as unknown;
		if (!isNavigationData(parsed)) throw new Error("远程导航数据格式不正确");

		navigation = cloneData(parsed);
		baseline = cloneData(parsed);
		repositorySha = file.sha;
		githubUser = session.email;
		isDirty = false;
		setStatus(`作者模式已登录：${session.email}，编辑功能已解锁`, "success");
	} catch (error) {
		githubUser = "";
		repositorySha = "";
		setStatus(
			error instanceof Error ? error.message : "作者代理连接失败",
			"error",
		);
	} finally {
		isConnecting = false;
	}
}

function disconnectGitHub(): void {
	logoutAuthor();
}

function markDirty(message = "更改尚未提交到 GitHub"): void {
	isDirty = true;
	setStatus(message);
}

function createId(value: string, prefix: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 36);
	const random = Math.random().toString(36).slice(2, 7);
	return `${prefix}-${normalized || random}-${random}`;
}

function startAddItem(categoryId?: string): void {
	editingItemId = null;
	draft = {
		categoryId: categoryId ?? navigation.categories[0]?.id ?? "",
		title: "",
		url: "https://",
		description: "",
		icon: "",
	};
	editorOpen = true;
	categoryEditorOpen = false;
}

function startEditItem(categoryId: string, item: NavigationItem): void {
	editingItemId = item.id;
	draft = {
		categoryId,
		title: item.title,
		url: item.url,
		description: item.description,
		icon: item.icon ?? "",
	};
	editorOpen = true;
	categoryEditorOpen = false;
	window.scrollTo({
		top:
			document.querySelector(".navigation-shell")?.getBoundingClientRect()
				.top ?? 0,
		behavior: "smooth",
	});
}

function saveItemDraft(): void {
	const title = draft.title.trim();
	const targetUrl = draft.url.trim();
	const category = navigation.categories.find(
		(item) => item.id === draft.categoryId,
	);
	if (!category) {
		setStatus("请选择一个分类", "error");
		return;
	}
	if (!title || !targetUrl) {
		setStatus("网站名称和地址不能为空", "error");
		return;
	}
	try {
		const parsedUrl = new URL(targetUrl);
		if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error();
	} catch {
		setStatus("网站地址必须是有效的 HTTP 或 HTTPS 链接", "error");
		return;
	}

	const wasEditing = Boolean(editingItemId);
	const nextItem: NavigationItem = {
		id: editingItemId ?? createId(title, "site"),
		title,
		url: targetUrl,
		description: draft.description.trim(),
		...(draft.icon.trim() ? { icon: draft.icon.trim() } : {}),
	};

	if (editingItemId) {
		for (const sourceCategory of navigation.categories) {
			const index = sourceCategory.items.findIndex(
				(item) => item.id === editingItemId,
			);
			if (index === -1) continue;
			sourceCategory.items.splice(index, 1);
			break;
		}
	}

	const duplicateIndex = category.items.findIndex(
		(item) => item.id === nextItem.id,
	);
	if (duplicateIndex >= 0) category.items[duplicateIndex] = nextItem;
	else category.items.push(nextItem);

	editorOpen = false;
	editingItemId = null;
	markDirty(`已${wasEditing ? "更新" : "添加"}网站，等待提交`);
}

function deleteItem(category: NavigationCategory, item: NavigationItem): void {
	if (!window.confirm(`确认删除“${item.title}”吗？`)) return;
	category.items = category.items.filter(
		(candidate) => candidate.id !== item.id,
	);
	markDirty("网站已删除，等待提交");
}

function moveItem(
	category: NavigationCategory,
	itemId: string,
	offset: number,
): void {
	const index = category.items.findIndex((item) => item.id === itemId);
	const target = index + offset;
	if (index < 0 || target < 0 || target >= category.items.length) return;
	[category.items[index], category.items[target]] = [
		category.items[target],
		category.items[index],
	];
	markDirty("网站顺序已调整，等待提交");
}

function startAddCategory(): void {
	editingCategoryId = null;
	categoryName = "";
	categoryEditorOpen = true;
	editorOpen = false;
}

function startEditCategory(category: NavigationCategory): void {
	editingCategoryId = category.id;
	categoryName = category.name;
	categoryEditorOpen = true;
	editorOpen = false;
}

function saveCategory(): void {
	const name = categoryName.trim();
	if (!name) {
		setStatus("分类名称不能为空", "error");
		return;
	}

	if (editingCategoryId) {
		const category = navigation.categories.find(
			(item) => item.id === editingCategoryId,
		);
		if (category) category.name = name;
	} else {
		navigation.categories.push({
			id: createId(name, "category"),
			name,
			items: [],
		});
	}

	categoryEditorOpen = false;
	markDirty("分类已更新，等待提交");
}

function moveCategory(categoryId: string, offset: number): void {
	const index = navigation.categories.findIndex(
		(item) => item.id === categoryId,
	);
	const target = index + offset;
	if (index < 0 || target < 0 || target >= navigation.categories.length) return;
	[navigation.categories[index], navigation.categories[target]] = [
		navigation.categories[target],
		navigation.categories[index],
	];
	markDirty("分类顺序已调整，等待提交");
}

function deleteCategory(category: NavigationCategory): void {
	const detail =
		category.items.length > 0
			? `，其中 ${category.items.length} 个网站也会被删除`
			: "";
	if (!window.confirm(`确认删除分类“${category.name}”${detail}吗？`)) return;
	navigation.categories = navigation.categories.filter(
		(item) => item.id !== category.id,
	);
	if (selectedCategory === category.id) selectedCategory = "all";
	markDirty("分类已删除，等待提交");
}

function discardChanges(): void {
	if (isDirty && !window.confirm("放弃尚未提交的更改吗？")) return;
	navigation = cloneData(baseline);
	isDirty = false;
	editorOpen = false;
	categoryEditorOpen = false;
	setStatus("已恢复到 GitHub 中的最新版本", "success");
}

async function publishChanges(): Promise<void> {
	if (!githubUser || !repositorySha || !isDirty) return;
	isSaving = true;
	setStatus("正在提交导航数据到 GitHub…");

	try {
		const content = `${JSON.stringify(navigation, null, "\t")}\n`;
		const result = await writeAuthorFile("navigation", content, repositorySha);
		repositorySha = result.sha || repositorySha;
		baseline = cloneData(navigation);
		isDirty = false;
		const commitText = result.commitUrl ? "，已生成新提交" : "";
		setStatus(`导航数据已写入 GitHub${commitText}`, "success");
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "提交失败", "error");
	} finally {
		isSaving = false;
	}
}

function hostname(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./, "");
	} catch {
		return value;
	}
}

function favicon(item: NavigationItem): string {
	if (item.icon) return item.icon;
	try {
		const domain = new URL(item.url).hostname;
		return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
	} catch {
		return "";
	}
}
</script>

<section class="navigation-shell card-base" aria-labelledby="website-navigation-title">
	<header class="navigation-header">
		<div class="navigation-heading">
			<span class="navigation-heading__icon" aria-hidden="true">⌑</span>
			<div>
				<h1 id="website-navigation-title">{navigation.title}</h1>
				<p>{navigation.description}</p>
			</div>
		</div>
		{#if isOwner}
			<div class="owner-identity" title={`作者模式：${githubUser}`}>
				<span>{githubUser}</span>
			</div>
		{:else}
			<button class="bind-button" type="button" onclick={() => void connectGitHub(false)}>
				<span aria-hidden="true">⌘</span>
				作者登录后编辑
			</button>
		{/if}
	</header>

	<div class="status-line" class:status-line--success={statusKind === "success"} class:status-line--error={statusKind === "error"} aria-live="polite">
		<span class="status-dot" aria-hidden="true"></span>
		<span>{status}</span>
	</div>

	{#if isOwner}
		<div class="owner-toolbar" aria-label="导航编辑操作">
			<button type="button" onclick={() => startAddItem()}>＋ 添加网站</button>
			<button type="button" onclick={startAddCategory}>＋ 添加分类</button>
			<button type="button" onclick={discardChanges} disabled={!isDirty}>撤销更改</button>
			<button class="owner-toolbar__primary" type="button" onclick={() => void publishChanges()} disabled={!isDirty || isSaving}>
				{isSaving ? "提交中…" : "提交到 GitHub"}
			</button>
			<button class="owner-toolbar__disconnect" type="button" onclick={disconnectGitHub}>退出编辑</button>
		</div>
	{/if}

	{#if editorOpen && isOwner}
		<form class="inline-editor" onsubmit={(event) => { event.preventDefault(); saveItemDraft(); }}>
			<header>
				<strong>{editingItemId ? "编辑网站" : "添加网站"}</strong>
				<button type="button" aria-label="关闭编辑" onclick={() => (editorOpen = false)}>×</button>
			</header>
			<div class="inline-editor__grid">
				<label><span>所属分类</span><select bind:value={draft.categoryId}>{#each navigation.categories as category}<option value={category.id}>{category.name}</option>{/each}</select></label>
				<label><span>网站名称</span><input bind:value={draft.title} placeholder="例如：ChatGPT" /></label>
				<label class="span-2"><span>网站地址</span><input type="url" bind:value={draft.url} placeholder="https://example.com/" /></label>
				<label class="span-2"><span>简介</span><textarea rows="2" bind:value={draft.description} placeholder="一句话说明这个网站的用途"></textarea></label>
				<label class="span-2"><span>图标地址（可选）</span><input type="url" bind:value={draft.icon} placeholder="留空时自动读取网站 favicon" /></label>
			</div>
			<footer><button type="button" onclick={() => (editorOpen = false)}>取消</button><button class="primary" type="submit">保存到草稿</button></footer>
		</form>
	{/if}

	{#if categoryEditorOpen && isOwner}
		<form class="category-editor" onsubmit={(event) => { event.preventDefault(); saveCategory(); }}>
			<label><span>{editingCategoryId ? "修改分类名称" : "新分类名称"}</span><input bind:value={categoryName} placeholder="例如：开发工具" /></label>
			<button type="button" onclick={() => (categoryEditorOpen = false)}>取消</button>
			<button class="primary" type="submit">保存</button>
		</form>
	{/if}

	<div class="navigation-controls">
		<div class="category-tabs" role="tablist" aria-label="网站分类">
			<button class:active={selectedCategory === "all"} type="button" onclick={() => (selectedCategory = "all")}>
				全部 <span>{totalItems}</span>
			</button>
			{#each navigation.categories as category}
				<button class:active={selectedCategory === category.id} type="button" onclick={() => (selectedCategory = category.id)}>
					{category.name} <span>{category.items.length}</span>
				</button>
			{/each}
		</div>
		<label class="navigation-search">
			<span aria-hidden="true">⌕</span>
			<input type="search" bind:value={query} placeholder="搜索网站" aria-label="搜索网站" />
		</label>
	</div>

	{#if filteredCategories.length > 0}
		<div class="navigation-groups">
			{#each filteredCategories as category, categoryIndex (category.id)}
				<section class="navigation-group" aria-labelledby={`navigation-category-${category.id}`}>
					<header class="group-heading">
						<div><span aria-hidden="true">▱</span><h2 id={`navigation-category-${category.id}`}>{category.name}</h2><small>{category.items.length}</small></div>
						{#if isOwner}
							<div class="category-actions">
								<button type="button" aria-label="上移分类" disabled={categoryIndex === 0} onclick={() => moveCategory(category.id, -1)}>↑</button>
								<button type="button" aria-label="下移分类" disabled={categoryIndex === filteredCategories.length - 1} onclick={() => moveCategory(category.id, 1)}>↓</button>
								<button type="button" onclick={() => startAddItem(category.id)}>添加</button>
								<button type="button" onclick={() => startEditCategory(category)}>改名</button>
								<button class="danger" type="button" onclick={() => deleteCategory(category)}>删除</button>
							</div>
						{/if}
					</header>

					{#if category.items.length > 0}
						<div class="site-grid">
							{#each category.items as item, itemIndex (item.id)}
								<article class="site-card">
									{#if isOwner}
										<div class="item-actions">
											<button type="button" aria-label="上移" disabled={itemIndex === 0} onclick={() => moveItem(category, item.id, -1)}>↑</button>
											<button type="button" aria-label="下移" disabled={itemIndex === category.items.length - 1} onclick={() => moveItem(category, item.id, 1)}>↓</button>
											<button class="edit" type="button" aria-label="编辑" onclick={() => startEditItem(category.id, item)}>✎</button>
											<button class="delete" type="button" aria-label="删除" onclick={() => deleteItem(category, item)}>×</button>
										</div>
									{/if}
									<a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title}（新窗口打开）`}>
										<div class="site-card__title">
											<span class="site-card__icon" aria-hidden="true">
												<b>{item.title.slice(0, 1)}</b>
												{#if favicon(item)}<img src={favicon(item)} alt="" onerror={(event) => ((event.currentTarget as HTMLImageElement).hidden = true)} />{/if}
											</span>
											<strong>{item.title}</strong>
										</div>
										<p>{item.description || "暂无简介"}</p>
										<footer><span>{hostname(item.url)}</span><span aria-hidden="true">↗</span></footer>
									</a>
								</article>
							{/each}
						</div>
					{:else}
						<div class="empty-category"><span>这个分类还没有网站</span>{#if isOwner}<button type="button" onclick={() => startAddItem(category.id)}>添加第一个网站</button>{/if}</div>
					{/if}
				</section>
			{/each}
		</div>
	{:else}
		<div class="navigation-empty"><strong>没有找到匹配的网站</strong><button type="button" onclick={() => { query = ""; selectedCategory = "all"; }}>清除筛选</button></div>
	{/if}
</section>

<style>
	.navigation-shell { padding: 1.25rem; color: var(--deep-text); }
	.navigation-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: .25rem .25rem 1rem; }
	.navigation-heading { display: flex; align-items: flex-start; gap: .8rem; }
	.navigation-heading__icon { display: grid; place-items: center; width: 2.25rem; height: 2.25rem; flex: 0 0 auto; border-radius: .6rem; background: var(--btn-regular-bg); color: var(--primary); font-size: 1.35rem; font-weight: 900; }
	.navigation-heading h1 { margin: 0; font-size: 1.55rem; line-height: 1.2; letter-spacing: -.025em; }
	.navigation-heading p { margin: .4rem 0 0; color: var(--content-meta); font-size: .85rem; }
	.bind-button, .owner-identity { display: inline-flex; align-items: center; gap: .45rem; min-height: 2.35rem; padding: .5rem .8rem; border-radius: .65rem; background: var(--btn-regular-bg); color: var(--deep-text); font-size: .78rem; font-weight: 760; }
	.bind-button:hover { background: var(--btn-regular-bg-hover); color: var(--primary); }
	.owner-identity img { width: 1.4rem; height: 1.4rem; border-radius: 50%; }
	.auth-panel { display: grid; grid-template-columns: minmax(15rem, 1fr) minmax(14rem, 1fr) auto; align-items: end; gap: .8rem; margin-bottom: .8rem; padding: .9rem; border-radius: .75rem; background: var(--btn-regular-bg); }
	.auth-panel strong { font-size: .88rem; }
	.auth-panel p { margin: .2rem 0 0; color: var(--content-meta); font-size: .72rem; line-height: 1.5; }
	.auth-panel input, .inline-editor input, .inline-editor select, .inline-editor textarea, .category-editor input, .navigation-search input { width: 100%; min-height: 2.4rem; padding: .5rem .65rem; border: 1px solid var(--line-divider); border-radius: .55rem; background: var(--card-bg); color: var(--deep-text); outline: none; }
	.auth-panel input:focus, .inline-editor input:focus, .inline-editor select:focus, .inline-editor textarea:focus, .category-editor input:focus, .navigation-search input:focus { border-color: var(--primary); outline: 2px solid color-mix(in oklch, var(--primary) 22%, transparent); outline-offset: 1px; }
	.auth-panel > button, .primary { min-height: 2.4rem; padding: .5rem .85rem; border-radius: .55rem; background: var(--primary); color: oklch(.18 .02 var(--hue)); font-weight: 800; }
	.status-line { display: flex; align-items: center; gap: .45rem; min-height: 2rem; margin-bottom: .8rem; padding: .4rem .65rem; border-block: 1px solid var(--line-divider); color: var(--content-meta); font-size: .75rem; }
	.status-dot { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
	.status-line--success { color: oklch(.56 .16 150); }
	.status-line--error { color: oklch(.58 .2 25); }
	.owner-toolbar { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .8rem; }
	.owner-toolbar button, .category-editor button, .inline-editor footer button { min-height: 2.2rem; padding: .42rem .7rem; border-radius: .55rem; background: var(--btn-regular-bg); color: var(--deep-text); font-size: .75rem; font-weight: 760; }
	.owner-toolbar button:hover, .category-editor button:hover, .inline-editor footer button:hover { background: var(--btn-regular-bg-hover); }
	.owner-toolbar button:disabled, .category-actions button:disabled, .item-actions button:disabled { cursor: not-allowed; opacity: .38; }
	.owner-toolbar .owner-toolbar__primary { background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	.owner-toolbar .owner-toolbar__disconnect { margin-left: auto; color: var(--content-meta); }
	.inline-editor, .category-editor { margin-bottom: 1rem; padding: 1rem; border: 1px solid var(--line-divider); border-radius: .75rem; background: color-mix(in oklch, var(--card-bg) 88%, var(--btn-regular-bg)); }
	.inline-editor header, .inline-editor footer { display: flex; align-items: center; justify-content: space-between; gap: .6rem; }
	.inline-editor header button { width: 2rem; height: 2rem; border-radius: .45rem; background: var(--btn-regular-bg); font-size: 1.2rem; }
	.inline-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: .8rem 0; }
	.inline-editor label, .category-editor label { display: grid; gap: .3rem; }
	.inline-editor label > span, .category-editor label > span { color: var(--content-meta); font-size: .7rem; font-weight: 760; }
	.inline-editor .span-2 { grid-column: span 2; }
	.inline-editor textarea { resize: vertical; }
	.inline-editor footer { justify-content: flex-end; }
	.inline-editor footer .primary, .category-editor .primary { background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	.category-editor { display: grid; grid-template-columns: minmax(12rem, 1fr) auto auto; align-items: end; gap: .6rem; }
	.navigation-controls { position: sticky; top: 4.75rem; z-index: 8; display: grid; grid-template-columns: minmax(0, 1fr) 12rem; gap: .75rem; align-items: center; margin-bottom: 1.2rem; padding: .45rem; border: 1px solid var(--line-divider); border-radius: .75rem; background: color-mix(in oklch, var(--card-bg) 94%, transparent); backdrop-filter: blur(10px); }
	.category-tabs { display: flex; gap: .25rem; overflow-x: auto; scrollbar-width: none; }
	.category-tabs::-webkit-scrollbar { display: none; }
	.category-tabs button { display: inline-flex; align-items: center; gap: .35rem; min-height: 2.15rem; padding: .4rem .68rem; border-radius: .55rem; color: var(--deep-text); font-size: .74rem; font-weight: 760; white-space: nowrap; }
	.category-tabs button:hover { background: var(--btn-regular-bg-hover); }
	.category-tabs button.active { background: var(--deep-text); color: var(--card-bg); }
	.category-tabs button span { min-width: 1.2rem; padding: .08rem .28rem; border-radius: 999px; background: color-mix(in oklch, currentColor 12%, transparent); font-size: .65rem; text-align: center; }
	.navigation-search { position: relative; display: flex; align-items: center; }
	.navigation-search > span { position: absolute; left: .65rem; z-index: 1; color: var(--content-meta); }
	.navigation-search input { min-height: 2.15rem; padding-left: 1.8rem; background: var(--btn-regular-bg); font-size: .75rem; }
	.navigation-groups { display: grid; gap: 1.4rem; }
	.group-heading { display: flex; align-items: center; justify-content: space-between; gap: .8rem; margin-bottom: .7rem; padding-bottom: .5rem; border-bottom: 1px solid var(--deep-text); }
	.group-heading > div:first-child { display: flex; align-items: center; gap: .45rem; }
	.group-heading h2 { margin: 0; font-size: 1rem; }
	.group-heading small { color: var(--content-meta); font-size: .7rem; font-weight: 750; }
	.category-actions, .item-actions { display: flex; gap: .25rem; }
	.category-actions button, .item-actions button { min-width: 1.85rem; min-height: 1.85rem; padding: .25rem .45rem; border-radius: .45rem; background: color-mix(in oklch, var(--deep-text) 66%, var(--card-bg)); color: var(--card-bg); font-size: .68rem; font-weight: 800; }
	.category-actions button:hover, .item-actions button:hover { background: var(--deep-text); }
	.category-actions .danger, .item-actions .delete { background: oklch(.64 .21 25); color: white; }
	.item-actions .edit { background: oklch(.64 .16 250); color: white; }
	.site-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr)); gap: .7rem; }
	.site-card { position: relative; min-width: 0; min-height: 10rem; border: 1px solid var(--line-divider); border-radius: .7rem; background: color-mix(in oklch, var(--card-bg) 96%, var(--btn-regular-bg)); transition: border-color 180ms ease-out, transform 180ms ease-out; }
	.site-card:hover { border-color: var(--deep-text); transform: translateY(-2px); }
	.site-card > a { display: flex; min-height: 10rem; flex-direction: column; padding: 1rem; color: var(--deep-text); }
	.site-card__title { display: flex; align-items: center; gap: .65rem; padding-right: 1rem; }
	.site-card__title strong { overflow: hidden; font-size: .9rem; text-overflow: ellipsis; white-space: nowrap; }
	.site-card__icon { position: relative; display: grid; place-items: center; width: 2.1rem; height: 2.1rem; flex: 0 0 auto; overflow: hidden; border-radius: .55rem; background: var(--btn-regular-bg); color: var(--primary); }
	.site-card__icon b { font-size: .85rem; }
	.site-card__icon img { position: absolute; inset: .2rem; width: calc(100% - .4rem); height: calc(100% - .4rem); object-fit: contain; }
	.site-card p { display: -webkit-box; overflow: hidden; margin: .75rem 0; color: var(--content-meta); font-size: .75rem; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
	.site-card footer { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-top: auto; padding-top: .55rem; border-top: 1px solid var(--line-divider); color: var(--content-meta); font-size: .66rem; }
	.site-card footer span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-actions { position: absolute; top: .45rem; right: .45rem; z-index: 2; }
	.item-actions button { min-width: 1.65rem; min-height: 1.65rem; padding: .18rem; }
	.navigation-empty, .empty-category { display: flex; align-items: center; justify-content: center; gap: .7rem; min-height: 8rem; border: 1px dashed var(--line-divider); border-radius: .7rem; color: var(--content-meta); font-size: .78rem; }
	.navigation-empty { min-height: 14rem; flex-direction: column; }
	.navigation-empty button, .empty-category button { padding: .4rem .65rem; border-radius: .5rem; background: var(--btn-regular-bg); color: var(--deep-text); font-weight: 750; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	button, input, select, textarea { transition: background-color 180ms ease-out, border-color 180ms ease-out, color 180ms ease-out, opacity 180ms ease-out; }
	button:focus-visible, a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

	@media (max-width: 760px) {
		.navigation-shell { padding: .85rem; }
		.navigation-header { align-items: stretch; flex-direction: column; }
		.bind-button, .owner-identity { align-self: flex-start; }
		.auth-panel { grid-template-columns: 1fr; align-items: stretch; }
		.navigation-controls { top: 4.2rem; grid-template-columns: 1fr; }
		.navigation-search { display: none; }
		.inline-editor__grid { grid-template-columns: 1fr; }
		.inline-editor .span-2 { grid-column: auto; }
		.category-editor { grid-template-columns: 1fr 1fr; }
		.category-editor label { grid-column: span 2; }
		.group-heading { align-items: flex-start; flex-direction: column; }
		.category-actions { width: 100%; overflow-x: auto; }
		.site-grid { grid-template-columns: 1fr; }
		.owner-toolbar .owner-toolbar__disconnect { margin-left: 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		.site-card, button, input, select, textarea { transition: none; }
		.site-card:hover { transform: none; }
	}
</style>
