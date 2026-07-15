<script lang="ts">
import { onMount } from "svelte";
import type {
	GitHubProjectSnapshot,
	PortfolioData,
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
};

let projects = $state<GitHubProjectSnapshot[]>(config.fallbackProjects);
let sourceLabel = $state("仓库快照");
let refreshFailed = $state(false);

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

<div class="project-source">
	<span class:project-source--cached={refreshFailed}></span>
	{sourceLabel}
</div>

<div class="project-list">
	{#each projects as project, index (project.name)}
		<article class:project-featured={index < config.featured.length}>
			<div class="project-index">{String(index + 1).padStart(2, "0")}</div>
			<div class="project-copy">
				<div class="project-title-row">
					<h3>{project.name}</h3>
					{#if project.isFork}<span class="project-fork">参与项目</span>{/if}
				</div>
				<p>{project.description}</p>
				<div class="project-meta">
					{#if project.language}<span>{project.language}</span>{/if}
					<span>★ {project.stars ?? 0}</span>
					<span>⑂ {project.forks ?? 0}</span>
					<time datetime={project.updatedAt}>更新于 {formatDate(project.updatedAt)}</time>
				</div>
			</div>
			<div class="project-actions">
				{#if project.homepage}
					<a href={project.homepage} target="_blank" rel="noreferrer">访问项目 ↗</a>
				{/if}
				<a href={project.url} target="_blank" rel="noreferrer">查看仓库 ↗</a>
			</div>
		</article>
	{/each}
</div>

<style>
	.project-source {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 1.15rem;
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

	.project-list {
		border-top: 1px solid var(--line-divider);
	}

	article {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr) auto;
		gap: 1rem;
		align-items: start;
		padding: 1.25rem 0;
		border-bottom: 1px solid var(--line-divider);
	}

	article.project-featured {
		padding: 1.5rem 1rem;
		background: color-mix(in oklch, var(--primary) 7%, transparent);
	}

	.project-index {
		color: var(--content-meta);
		font-size: 0.76rem;
		font-variant-numeric: tabular-nums;
		font-weight: 800;
	}

	.project-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}

	h3 {
		margin: 0;
		color: var(--deep-text);
		font-size: clamp(1.05rem, 2vw, 1.35rem);
		letter-spacing: -0.025em;
	}

	.project-fork {
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: var(--btn-regular-bg);
		color: var(--content-meta);
		font-size: 0.68rem;
		font-weight: 750;
	}

	p {
		max-width: 68ch;
		margin: 0.45rem 0 0;
		color: var(--content-meta);
		font-size: 0.86rem;
		line-height: 1.65;
		text-wrap: pretty;
	}

	.project-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.85rem;
		margin-top: 0.75rem;
		color: var(--content-meta);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.project-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.45rem;
	}

	.project-actions a {
		color: var(--deep-text);
		font-size: 0.76rem;
		font-weight: 800;
		white-space: nowrap;
	}

	.project-actions a:hover {
		color: var(--primary);
	}

	@media (max-width: 720px) {
		article {
			grid-template-columns: 2rem minmax(0, 1fr);
		}

		.project-actions {
			grid-column: 2;
			flex-flow: row wrap;
			align-items: center;
		}
	}
</style>
