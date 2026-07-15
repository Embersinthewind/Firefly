<script lang="ts">
import { onMount } from "svelte";
import type {
	GitHubProjectSnapshot,
	PortfolioData,
	ProjectViewMode,
} from "@/types/portfolioConfig";

const { config }: { config: PortfolioData["github"] } = $props();

type GitHubRepo = {
	name: string;
	description: string | null;
	html_url: string;
	homepage: string | null;
	language: string | null;
	stargazers_count: number;
	forks_count: number;
	updated_at: string;
	fork: boolean;
	archived: boolean;
	topics?: string[];
};

let projects = $state<GitHubProjectSnapshot[]>(config.fallbackProjects);
let sourceLabel = $state("仓库快照");
let refreshFailed = $state(false);
let activeView = $state<ProjectViewMode>(config.defaultView);
let activeCategory = $state("全部");

const cacheKey = `firefly:github-projects:${config.username}`;
const cacheDuration = 30 * 60 * 1000;

function rank(items: GitHubProjectSnapshot[]) {
	const featured = new Map(config.featured.map((name, index) => [name, index]));
	return items
		.filter((item) => config.showForks || !item.isFork)
		.sort((a, b) => {
			const aRank = featured.get(a.name);
			const bRank = featured.get(b.name);
			if (aRank !== undefined || bRank !== undefined) {
				return (aRank ?? 999) - (bRank ?? 999);
			}
			return (
				new Date(b.updatedAt ?? 0).getTime() -
				new Date(a.updatedAt ?? 0).getTime()
			);
		})
		.slice(0, config.limit);
}

function mapRepositories(repositories: GitHubRepo[]): GitHubProjectSnapshot[] {
	return rank(
		repositories
			.filter((repo) => !repo.archived)
			.map((repo) => ({
				name: repo.name,
				description: repo.description || "这个仓库暂时还没有添加项目说明。",
				url: repo.html_url,
				homepage: repo.homepage || undefined,
				language: repo.language || undefined,
				stars: repo.stargazers_count,
				forks: repo.forks_count,
				updatedAt: repo.updated_at,
				isFork: repo.fork,
				topics: repo.topics || [],
			})),
	);
}

function formatDate(value?: string) {
	if (!value) return "持续维护";
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(new Date(value));
}

function projectMeta(project: GitHubProjectSnapshot) {
	return config.projectMeta.find(
		(item) =>
			item.name.toLocaleLowerCase() === project.name.toLocaleLowerCase(),
	);
}

function projectCategory(project: GitHubProjectSnapshot) {
	return (
		projectMeta(project)?.category || (project.isFork ? "参与项目" : "个人项目")
	);
}

function projectTags(project: GitHubProjectSnapshot) {
	const values = [
		...(projectMeta(project)?.tags || []),
		...(project.topics || []),
		...(project.language ? [project.language] : []),
	];
	return [...new Set(values.filter(Boolean))].slice(0, 5);
}

const availableCategories = $derived([
	...new Set([
		...config.categories,
		...projects.map((project) => projectCategory(project)),
	]),
]);

const filteredProjects = $derived(
	activeCategory === "全部"
		? projects
		: projects.filter((project) => projectCategory(project) === activeCategory),
);

onMount(async () => {
	try {
		const cached = sessionStorage.getItem(cacheKey);
		if (cached) {
			const parsed = JSON.parse(cached) as {
				time: number;
				projects: GitHubProjectSnapshot[];
			};
			if (Date.now() - parsed.time < cacheDuration) {
				projects = rank(parsed.projects);
				sourceLabel = "GitHub 实时数据";
				return;
			}
		}

		const response = await fetch(
			`https://api.github.com/users/${encodeURIComponent(config.username)}/repos?per_page=100&sort=updated`,
			{ headers: { Accept: "application/vnd.github+json" } },
		);
		if (!response.ok) throw new Error(`GitHub API ${response.status}`);
		const liveProjects = mapRepositories(
			(await response.json()) as GitHubRepo[],
		);
		if (liveProjects.length > 0) projects = liveProjects;
		sessionStorage.setItem(
			cacheKey,
			JSON.stringify({ time: Date.now(), projects: liveProjects }),
		);
		sourceLabel = "GitHub 实时数据";
	} catch {
		projects = rank(config.fallbackProjects);
		refreshFailed = true;
		sourceLabel = "仓库快照";
	}
});
</script>

<div class="project-toolbar">
	<div class="project-source">
		<span class:project-source--cached={refreshFailed}></span>
		{sourceLabel}
	</div>
	<div class:show-categories={activeView === "categories"} class="view-switch" aria-label="项目查看方式">
		<span class="view-switch__indicator" aria-hidden="true"></span>
		<button type="button" aria-pressed={activeView === "grid"} onclick={() => (activeView = "grid")}>项目列表</button>
		<button type="button" aria-pressed={activeView === "categories"} onclick={() => (activeView = "categories")}>分类查看</button>
	</div>
</div>

{#if activeView === "categories"}
	<div class="category-filter" aria-label="项目分类">
		<button type="button" class:active={activeCategory === "全部"} onclick={() => (activeCategory = "全部")}>
			全部 <span>{projects.length}</span>
		</button>
		{#each availableCategories as category}
			<button type="button" class:active={activeCategory === category} onclick={() => (activeCategory = category)}>
				{category} <span>{projects.filter((project) => projectCategory(project) === category).length}</span>
			</button>
		{/each}
	</div>
{/if}

<div
	class="project-grid"
	class:project-grid--three={config.gridColumns === 3}
	class:project-grid--category={activeView === "categories"}
>
	{#each activeView === "categories" ? filteredProjects : projects as project, index (project.name)}
		<article class:project-featured={config.featured.includes(project.name)}>
			<header>
				<span class="project-index">{String(index + 1).padStart(2, "0")}</span>
				<span class="project-category">{projectCategory(project)}</span>
			</header>
			<div class="project-copy">
				<h3>{project.name}</h3>
				<p>{project.description}</p>
				<div class="project-tags" aria-label="项目标签">
					{#each projectTags(project) as tag}<span>{tag}</span>{/each}
				</div>
			</div>
			<div class="project-meta">
				<span>★ {project.stars ?? 0}</span>
				<span>⑂ {project.forks ?? 0}</span>
				<time datetime={project.updatedAt}>{formatDate(project.updatedAt)}</time>
			</div>
			<footer>
				{#if project.homepage}<a href={project.homepage} target="_blank" rel="noreferrer">访问项目</a>{/if}
				<a href={project.url} target="_blank" rel="noreferrer">查看仓库 <span aria-hidden="true">↗</span></a>
			</footer>
		</article>
	{/each}
</div>

<style>
	.project-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.project-source {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--content-meta);
		font-size: 0.75rem;
		font-weight: 700;
	}

	.project-source span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--primary);
		box-shadow: 0 0 0 0.2rem color-mix(in oklch, var(--primary) 16%, transparent);
	}

	.project-source span.project-source--cached {
		background: var(--content-meta);
		box-shadow: none;
	}

	.view-switch {
		position: relative;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		width: 12.5rem;
		padding: 0.22rem;
		border: 1px solid var(--line-divider);
		border-radius: 999px;
		background: var(--btn-regular-bg);
	}

	.view-switch__indicator {
		position: absolute;
		top: 0.22rem;
		bottom: 0.22rem;
		left: 0.22rem;
		width: calc(50% - 0.22rem);
		border-radius: 999px;
		background: var(--card-bg);
		box-shadow: 0 1px 5px color-mix(in oklch, var(--deep-text) 12%, transparent);
		transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.view-switch.show-categories .view-switch__indicator {
		transform: translateX(100%);
	}

	.view-switch button {
		position: relative;
		z-index: 1;
		min-height: 2rem;
		padding: 0.3rem 0.7rem;
		border: 0;
		background: transparent;
		color: var(--content-meta);
		font-size: 0.72rem;
		font-weight: 800;
		cursor: pointer;
	}

	.view-switch button[aria-pressed="true"] {
		color: var(--deep-text);
	}

	.category-filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding: 0 0 1rem;
		border-bottom: 1px solid var(--line-divider);
	}

	.category-filter button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2rem;
		padding: 0.35rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.72rem;
		font-weight: 800;
		cursor: pointer;
	}

	.category-filter button.active {
		background: var(--deep-text);
		color: var(--card-bg);
	}

	.category-filter span {
		font-variant-numeric: tabular-nums;
		opacity: 0.66;
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		border: 1px solid var(--line-divider);
		background: var(--line-divider);
	}

	.project-grid--three {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	article {
		display: flex;
		min-width: 0;
		min-height: 18rem;
		flex-direction: column;
		padding: 1.15rem;
		background: var(--card-bg);
	}

	article.project-featured {
		background: color-mix(in oklch, var(--primary) 6%, var(--card-bg));
	}

	article > header,
	article > footer,
	.project-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.project-index {
		color: var(--content-meta);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		font-weight: 850;
	}

	.project-category,
	.project-tags span {
		border-radius: 999px;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.64rem;
		font-weight: 800;
	}

	.project-category {
		padding: 0.2rem 0.55rem;
	}

	.project-copy {
		flex: 1;
		padding: 1.2rem 0 1rem;
	}

	h3 {
		margin: 0;
		color: var(--deep-text);
		font-size: clamp(1.05rem, 2vw, 1.32rem);
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
	}

	p {
		max-width: 65ch;
		margin: 0.55rem 0 0;
		color: var(--content-meta);
		font-size: 0.8rem;
		line-height: 1.65;
		text-wrap: pretty;
	}

	.project-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.85rem;
	}

	.project-tags span {
		padding: 0.18rem 0.45rem;
	}

	.project-meta {
		justify-content: flex-start;
		flex-wrap: wrap;
		padding: 0.75rem 0;
		border-top: 1px solid var(--line-divider);
		color: var(--content-meta);
		font-size: 0.66rem;
		font-weight: 750;
	}

	.project-meta time {
		margin-left: auto;
	}

	article > footer {
		justify-content: flex-end;
		padding-top: 0.85rem;
	}

	article > footer a {
		color: var(--deep-text);
		font-size: 0.72rem;
		font-weight: 850;
		white-space: nowrap;
	}

	article > footer a:hover {
		color: var(--primary);
	}

	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	@media (max-width: 960px) {
		.project-grid--three {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 640px) {
		.project-toolbar {
			align-items: stretch;
			flex-direction: column;
		}

		.view-switch {
			width: 100%;
		}

		.project-grid,
		.project-grid--three {
			grid-template-columns: 1fr;
		}

		article {
			min-height: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.view-switch__indicator {
			transition: none;
		}
	}
</style>
