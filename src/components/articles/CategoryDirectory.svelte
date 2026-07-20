<script lang="ts">
import { onMount } from "svelte";
import {
	getAuthorSession,
	logoutAuthor,
	openAuthorLogin,
	readAuthorFile,
	writeAuthorFile,
} from "@/utils/author-api";

type CategoryItem = {
	name: string;
	count: number;
	url: string;
};

const { initialCategories = [] }: { initialCategories?: CategoryItem[] } =
	$props();

let categories = $state([...initialCategories]);
let newCategory = $state("");
let authorized = $state(false);
let authorName = $state("");
let saving = $state(false);
let message = $state("");
let messageTone = $state<"neutral" | "success" | "error">("neutral");

const totalPosts = $derived(
	categories.reduce((sum, category) => sum + category.count, 0),
);

onMount(() => {
	void refreshSession();
});

async function refreshSession() {
	try {
		const session = await getAuthorSession();
		authorized = Boolean(session);
		authorName = session?.email || "";
	} catch {
		authorized = false;
		authorName = "";
	}
}

function normalizeCategory(value: string) {
	return value.trim().replace(/\s+/g, " ");
}

function parseCategoryFile(content: string): string[] {
	const data = JSON.parse(content) as { categories?: unknown };
	if (!Array.isArray(data.categories)) return [];
	return data.categories
		.filter((item): item is string => typeof item === "string")
		.map(normalizeCategory)
		.filter(Boolean);
}

async function createCategory() {
	const name = normalizeCategory(newCategory);
	if (!name) {
		message = "请输入分类名称。";
		messageTone = "error";
		return;
	}
	if (name.length > 40) {
		message = "分类名称不能超过 40 个字符。";
		messageTone = "error";
		return;
	}
	if (categories.some((category) => category.name === name)) {
		message = "这个分类已经存在。";
		messageTone = "error";
		return;
	}
	if (!authorized) {
		openAuthorLogin(window.location.pathname);
		return;
	}

	saving = true;
	message = "正在创建分类…";
	messageTone = "neutral";
	try {
		const file = await readAuthorFile("articleCategories");
		const stored = parseCategoryFile(file.content);
		const nextNames = Array.from(new Set([...stored, name]));
		await writeAuthorFile(
			"articleCategories",
			`${JSON.stringify({ categories: nextNames }, null, "\t")}\n`,
			file.sha,
		);
		categories = [
			...categories,
			{
				name,
				count: 0,
				url: `/archive/?category=${encodeURIComponent(name)}`,
			},
		];
		newCategory = "";
		message = `分类“${name}”已创建，Cloudflare 更新后会在全站生效。`;
		messageTone = "success";
	} catch (error) {
		message = error instanceof Error ? error.message : "新建分类失败。";
		messageTone = "error";
	} finally {
		saving = false;
	}
}
</script>

<section class="category-directory card-base" aria-labelledby="category-directory-title">
	<header class="category-directory__header">
		<div>
			<p>Categories</p>
			<h1 id="category-directory-title">分类</h1>
			<span>{categories.length} 个分类 · {totalPosts} 篇文章</span>
		</div>
		<div class="author-state">
			{#if authorized}
				<span title={authorName}>作者模式</span>
				<button type="button" class="quiet" onclick={logoutAuthor}>退出</button>
			{:else}
				<button type="button" class="quiet" onclick={() => openAuthorLogin(window.location.pathname)}>作者登录</button>
			{/if}
		</div>
	</header>

	<form class="category-create" onsubmit={(event) => { event.preventDefault(); void createCategory(); }}>
		<label for="new-category-name">新建分类</label>
		<div class="category-create__control">
			<input id="new-category-name" bind:value={newCategory} maxlength="40" placeholder="输入分类名称" autocomplete="off" />
			<button type="submit" disabled={saving}>{saving ? "创建中…" : "＋ 创建分类"}</button>
		</div>
		{#if message}<p class:success={messageTone === "success"} class:error={messageTone === "error"} role="status">{message}</p>{/if}
	</form>

	{#if categories.length > 0}
		<div class="category-directory__grid">
			{#each categories as category (category.name)}
				<a href={category.url} class="category-directory__item">
					<span class="category-directory__icon" aria-hidden="true">▱</span>
					<span class="category-directory__copy">
						<strong>{category.name}</strong>
						<small>{category.count} 篇文章</small>
					</span>
					<span class="category-directory__arrow" aria-hidden="true">›</span>
				</a>
			{/each}
		</div>
	{:else}
		<div class="category-directory__empty"><span aria-hidden="true">▱</span><p>创建第一个文章分类，写作时即可直接选择。</p></div>
	{/if}
</section>

<style>
	.category-directory { padding: 1.5rem; }
	.category-directory__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 0 .25rem 1.25rem; border-bottom: 1px solid var(--line-divider); }
	.category-directory__header p { margin: 0 0 .15rem; color: var(--primary); font-size: .78rem; font-weight: 750; }
	.category-directory__header h1 { margin: 0; color: var(--deep-text); font-size: 1.65rem; line-height: 1.25; letter-spacing: -.025em; }
	.category-directory__header > div > span { display: block; margin-top: .35rem; color: var(--content-meta); font-size: .875rem; }
	.author-state { display: flex; align-items: center; gap: .45rem; }
	.author-state > span { max-width: 8rem; overflow: hidden; color: var(--content-meta); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
	button { min-height: 2.4rem; padding: .5rem .8rem; border: 1px solid var(--line-divider); border-radius: .55rem; background: var(--card-bg); color: var(--deep-text); font: inherit; font-size: .76rem; font-weight: 800; cursor: pointer; }
	button:hover { border-color: var(--primary); color: var(--primary); }
	button:disabled { cursor: wait; opacity: .58; }
	button.quiet { min-height: 2rem; padding: .4rem .65rem; background: var(--btn-regular-bg); color: var(--btn-content); }
	.category-create { display: grid; gap: .5rem; margin: 1rem .25rem .5rem; padding: 1rem; border: 1px solid var(--line-divider); border-radius: .75rem; background: color-mix(in oklch, var(--btn-regular-bg) 42%, var(--card-bg)); }
	.category-create > label { color: var(--deep-text); font-size: .78rem; font-weight: 850; }
	.category-create__control { display: flex; gap: .55rem; }
	.category-create input { min-width: 0; min-height: 2.55rem; flex: 1; padding: .5rem .7rem; border: 1px solid var(--line-divider); border-radius: .55rem; background: var(--card-bg); color: var(--deep-text); font: inherit; font-size: .8rem; outline: none; }
	.category-create input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 14%, transparent); }
	.category-create button { border-color: var(--primary); background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	.category-create p { margin: 0; color: var(--content-meta); font-size: .72rem; }
	.category-create p.success { color: #15803d; }
	.category-create p.error { color: #dc2626; }
	.category-directory__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 2rem; padding-top: .5rem; }
	.category-directory__item { display: flex; align-items: center; gap: .9rem; min-width: 0; min-height: 5.6rem; padding: 1rem .25rem; border-bottom: 1px solid var(--line-divider); color: var(--deep-text); transition: color 180ms ease-out, transform 180ms ease-out; }
	.category-directory__item:hover { color: var(--primary); transform: translateX(2px); }
	.category-directory__icon { display: grid; width: 2.8rem; height: 2.8rem; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--btn-regular-bg); color: var(--btn-content); font-size: 1.3rem; }
	.category-directory__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: .2rem; }
	.category-directory__copy strong { overflow: hidden; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
	.category-directory__copy small { color: var(--content-meta); font-size: .78rem; }
	.category-directory__arrow { color: var(--content-meta); font-size: 1.4rem; }
	.category-directory__empty { display: grid; min-height: 15rem; place-items: center; color: var(--content-meta); text-align: center; }
	@media (max-width: 720px) {
		.category-directory { padding: 1.1rem; }
		.category-directory__header { align-items: stretch; flex-direction: column; }
		.author-state { justify-content: flex-end; }
		.category-create__control { align-items: stretch; flex-direction: column; }
		.category-directory__grid { grid-template-columns: 1fr; }
	}
	@media (prefers-reduced-motion: reduce) { .category-directory__item { transition: none; } .category-directory__item:hover { transform: none; } }
</style>
