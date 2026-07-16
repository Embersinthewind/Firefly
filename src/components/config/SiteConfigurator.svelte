<script lang="ts">
import { onMount } from "svelte";
import {
	defaultKVaultWriterSettings,
	type KVaultWriterSettings,
	writerStorageKeys,
} from "@/config/writerConfig";
import type {
	PortfolioData,
	SiteEditorGitHubConfig,
	SiteEditorProfileData,
	SiteEditorSiteData,
} from "@/types/portfolioConfig";
import {
	clearLegacyAuthorTokens,
	getAuthorSession,
	logoutAuthor,
	openAuthorLogin,
	readAuthorFile,
	writeAuthorFile,
} from "@/utils/author-api";

type Tab =
	| "site"
	| "projects"
	| "profile"
	| "appearance"
	| "sidebar"
	| "writing"
	| "announcement";
type FileKey = "site" | "profile" | "portfolio";
type StatusTone = "info" | "success" | "error";

const {
	initialSite,
	initialProfile,
	initialPortfolio,
}: {
	initialSite: SiteEditorSiteData;
	initialProfile: SiteEditorProfileData;
	initialPortfolio: PortfolioData;
	repository: SiteEditorGitHubConfig;
} = $props();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const draftStorageKey = "firefly:config:draft";

function normalizePortfolio(value: PortfolioData): PortfolioData {
	const next = clone(value);
	if (next.statusEvent.workingLabel === "上班中") next.statusEvent.workingLabel = "上班";
	if (!next.statusEvent.offworkLabel || next.statusEvent.offworkLabel === "下班中") {
		next.statusEvent.offworkLabel = "下班";
	}
	if (next.statusEvent.restingLabel === "休息中") next.statusEvent.restingLabel = "摸鱼";
	return next;
}

function formatRepositoryJson(value: unknown): string {
	const displayWidth = (text: string) =>
		Array.from(text).reduce((width, character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return width + (codePoint > 127 ? 2 : 1);
		}, 0);
	const formatValue = (
		current: unknown,
		level: number,
		linePrefixWidth = level,
	): string => {
		if (Array.isArray(current)) {
			if (current.length === 0) return "[]";
			const isPrimitiveArray = current.every(
				(item) => item === null || typeof item !== "object",
			);
			const compact = isPrimitiveArray
				? `[${current.map((item) => JSON.stringify(item)).join(", ")}]`
				: JSON.stringify(current);
			if (isPrimitiveArray && linePrefixWidth + displayWidth(compact) <= 80) {
				return compact;
			}
			const indent = "\t".repeat(level);
			const childIndent = "\t".repeat(level + 1);
			return `[\n${current
				.map((item) => `${childIndent}${formatValue(item, level + 1)}`)
				.join(",\n")}\n${indent}]`;
		}
		if (current && typeof current === "object") {
			const entries = Object.entries(current as Record<string, unknown>);
			if (entries.length === 0) return "{}";
			const indent = "\t".repeat(level);
			const childIndent = "\t".repeat(level + 1);
			return `{\n${entries
				.map(([key, item]) => {
					const prefix = `${childIndent}${JSON.stringify(key)}: `;
					return `${prefix}${formatValue(item, level + 1, prefix.length)}`;
				})
				.join(",\n")}\n${indent}}`;
		}
		return JSON.stringify(current);
	};

	return `${formatValue(value, 0)}\n`;
}

let site = $state(clone(initialSite));
let profile = $state(clone(initialProfile));
let portfolio = $state(normalizePortfolio(initialPortfolio));
let writerSettings = $state<KVaultWriterSettings>(
	clone(defaultKVaultWriterSettings),
);
let baseline = $state({
	site: clone(initialSite),
	profile: clone(initialProfile),
	portfolio: normalizePortfolio(initialPortfolio),
});
let activeTab = $state<Tab>("site");
let authorized = $state(false);
let githubUser = $state("");
let busy = $state(false);
let statusMessage = $state(
	"游客模式：配置内容可以查看，但不能修改。绑定 GitHub 后解锁编辑。 ",
);
let statusTone = $state<StatusTone>("info");
let shas = $state<Record<FileKey, string>>({
	site: "",
	profile: "",
	portfolio: "",
});

const tabs: { id: Tab; label: string; icon: string }[] = [
	{ id: "site", label: "站点配置", icon: "⚙" },
	{ id: "projects", label: "首页项目", icon: "⌘" },
	{ id: "profile", label: "用户资料", icon: "●" },
	{ id: "appearance", label: "背景壁纸", icon: "▧" },
	{ id: "sidebar", label: "侧边栏", icon: "▤" },
	{ id: "writing", label: "写作设置", icon: "✎" },
	{ id: "announcement", label: "公告", icon: "◖" },
];

function setStatus(message: string, tone: StatusTone = "info") {
	statusMessage = message;
	statusTone = tone;
}

async function readRepositoryFile(key: FileKey) {
	const payload = await readAuthorFile(key);
	return {
		data: JSON.parse(payload.content) as unknown,
		sha: payload.sha,
	};
}

async function connectGitHub(redirectIfNeeded = false) {
	busy = true;
	setStatus("正在验证 Cloudflare 作者身份并读取最新配置……");
	try {
		const session = await getAuthorSession();
		if (!session) {
			authorized = false;
			githubUser = "";
			if (redirectIfNeeded) openAuthorLogin(window.location.pathname);
			else setStatus("游客模式：使用作者密码登录后才能编辑。", "info");
			return;
		}

		const [siteFile, profileFile, portfolioFile] = await Promise.all([
			readRepositoryFile("site"),
			readRepositoryFile("profile"),
			readRepositoryFile("portfolio"),
		]);
		site = clone(siteFile.data as SiteEditorSiteData);
		profile = clone(profileFile.data as SiteEditorProfileData);
		portfolio = normalizePortfolio(portfolioFile.data as PortfolioData);
		baseline = {
			site: clone(site),
			profile: clone(profile),
			portfolio: clone(portfolio),
		};
		shas = {
			site: siteFile.sha,
			profile: profileFile.sha,
			portfolio: portfolioFile.sha,
		};
		authorized = true;
		githubUser = session.email;
		setStatus(`作者模式已登录：${session.email}，配置编辑已解锁。`, "success");
	} catch (error) {
		authorized = false;
		githubUser = "";
		setStatus(
			error instanceof Error ? error.message : "作者代理连接失败。",
			"error",
		);
	} finally {
		busy = false;
	}
}

function disconnect() {
	logoutAuthor();
}

function resetChanges() {
	site = clone(baseline.site);
	profile = clone(baseline.profile);
	portfolio = clone(baseline.portfolio);
	setStatus("已恢复到仓库中的配置。", "info");
}

function saveDraft() {
	if (!authorized) return;
	localStorage.setItem(
		draftStorageKey,
		JSON.stringify({ site, profile, portfolio }),
	);
	setStatus("草稿已保存在当前浏览器。", "success");
}

function loadDraft() {
	if (!authorized) return;
	const raw = localStorage.getItem(draftStorageKey);
	if (!raw) {
		setStatus("当前浏览器没有保存的配置草稿。", "error");
		return;
	}
	try {
		const draft = JSON.parse(raw) as {
			site: SiteEditorSiteData;
			profile: SiteEditorProfileData;
			portfolio: PortfolioData;
		};
		site = clone(draft.site);
		profile = clone(draft.profile);
		portfolio = normalizePortfolio(draft.portfolio);
		setStatus("已载入浏览器草稿，提交前请再次检查。", "success");
	} catch {
		setStatus("草稿格式无效。", "error");
	}
}

async function writeRepositoryFile(key: FileKey, value: unknown) {
	const payload = await writeAuthorFile(
		key,
		formatRepositoryJson(value),
		shas[key],
	);
	shas[key] = payload.sha || shas[key];
}

async function submitConfiguration() {
	if (!authorized || busy) return;
	if (
		!site.title.trim() ||
		!profile.name.trim() ||
		!portfolio.github.username.trim()
	) {
		setStatus("站点标题、用户名称和 GitHub 用户名不能为空。", "error");
		return;
	}
	try {
		new URL(site.siteUrl);
	} catch {
		setStatus("站点 URL 格式不正确。", "error");
		return;
	}

	busy = true;
	setStatus("正在把配置提交到 GitHub……");
	try {
		await writeRepositoryFile("site", site);
		await writeRepositoryFile("profile", profile);
		await writeRepositoryFile("portfolio", portfolio);
		baseline = {
			site: clone(site),
			profile: clone(profile),
			portfolio: clone(portfolio),
		};
		localStorage.removeItem(draftStorageKey);
		setStatus("配置已提交到 main，Cloudflare 将自动重新部署。", "success");
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "配置提交失败。",
			"error",
		);
	} finally {
		busy = false;
	}
}

function addProfileLink() {
	if (!authorized) return;
	profile.links.push({
		name: "新链接",
		url: "https://",
		icon: "material-symbols:link",
		showName: false,
	});
}

function removeProfileLink(index: number) {
	if (!authorized) return;
	profile.links.splice(index, 1);
}

function addSkill() {
	if (!authorized) return;
	portfolio.skills.push({
		name: "新技能",
		icon: "material-symbols:code-rounded",
	});
}

function removeSkill(index: number) {
	if (!authorized) return;
	portfolio.skills.splice(index, 1);
}

function addProjectMeta() {
	if (!authorized) return;
	portfolio.github.projectMeta.push({
		name: "新仓库",
		category: portfolio.github.categories[0] || "个人项目",
		tags: [],
	});
}

function removeProjectMeta(index: number) {
	if (!authorized) return;
	portfolio.github.projectMeta.splice(index, 1);
}

function saveWriterSettings() {
	localStorage.setItem(
		writerStorageKeys.kvault,
		JSON.stringify(writerSettings),
	);
	setStatus(
		"K-Vault 写作配置已保存到当前浏览器，不会提交到 GitHub。",
		"success",
	);
}

function clearWriterToken() {
	writerSettings.token = "";
	saveWriterSettings();
	setStatus("本机保存的 K-Vault Token 已清除。", "success");
}

onMount(() => {
	const storedWriterSettings = localStorage.getItem(writerStorageKeys.kvault);
	if (storedWriterSettings) {
		try {
			writerSettings = {
				...clone(defaultKVaultWriterSettings),
				...(JSON.parse(storedWriterSettings) as Partial<KVaultWriterSettings>),
			};
		} catch {
			localStorage.removeItem(writerStorageKeys.kvault);
		}
	}
	clearLegacyAuthorTokens();
	void connectGitHub(false);
});
</script>

<section class="config-shell" aria-labelledby="config-title">
	<header class="config-hero">
		<div>
			<span>CONFIG</span>
			<h1 id="config-title">站点配置</h1>
			<p>在浏览器中调整站点展示配置，并通过受保护的 Cloudflare 作者代理提交。</p>
		</div>
		<div class="config-actions">
			{#if authorized}
				<button type="button" class="button-secondary" onclick={resetChanges} disabled={busy}>重置</button>
				<button type="button" class="button-secondary" onclick={saveDraft} disabled={busy}>保存草稿</button>
				<button type="button" class="button-secondary" onclick={loadDraft} disabled={busy}>载入草稿</button>
				<button type="button" class="button-primary" onclick={submitConfiguration} disabled={busy}>
					{busy ? "处理中…" : "提交配置"}
				</button>
				<button type="button" class="button-secondary" onclick={disconnect}>退出 {githubUser}</button>
			{:else}
				<button type="button" class="button-primary" onclick={() => connectGitHub(true)}>
					作者登录后编辑
				</button>
			{/if}
		</div>
	</header>

	<div class:status-success={statusTone === "success"} class:status-error={statusTone === "error"} class="config-status" role="status">
		{statusMessage}
	</div>

	<nav class="config-tabs" aria-label="配置分组">
		{#each tabs as tab}
			<button type="button" class:active={activeTab === tab.id} onclick={() => (activeTab = tab.id)}>
				<span aria-hidden="true">{tab.icon}</span>{tab.label}
			</button>
		{/each}
	</nav>

	<form onsubmit={(event) => event.preventDefault()}>
		<fieldset disabled={(activeTab !== "writing" && !authorized) || busy}>
			{#if activeTab === "writing"}
				<div class="config-section">
					<header>
						<div><h2>K-Vault 图片自动上传</h2><p>保存一次后，写文章时粘贴、拖入或选择图片会直接上传到指定存储源。</p></div>
						<div class="section-actions">
							<button type="button" class="button-secondary" onclick={clearWriterToken}>清除 Token</button>
							<button type="button" class="button-primary" onclick={saveWriterSettings}>保存到本机</button>
						</div>
					</header>
					<label>K-Vault 地址<input type="url" bind:value={writerSettings.baseUrl} placeholder="https://img.example.com" /></label>
					<label>API Token<input type="password" bind:value={writerSettings.token} placeholder="仅保存在当前浏览器" autocomplete="off" /></label>
					<div class="form-grid three">
						<label>存储源<input bind:value={writerSettings.storage} placeholder="telegram" /></label>
						<label>上传目录<input bind:value={writerSettings.folderPath} placeholder="blog" /></label>
						<label>返回链接<select bind:value={writerSettings.linkMode}><option value="download">图片直链</option><option value="share">分享链接</option></select></label>
					</div>
					<p class="local-secret-note">地址与 Token 只写入当前浏览器的本地存储，不参与“提交配置”，也不会出现在 GitHub 仓库中。</p>
				</div>
			{:else if activeTab === "site"}
				<div class="config-section">
					<header><h2>基础信息</h2><p>站点标题、地址、描述和搜索关键词。</p></header>
					<div class="form-grid two">
						<label>站点标题<input bind:value={site.title} /></label>
						<label>副标题<input bind:value={site.subtitle} /></label>
					</div>
					<label>站点 URL<input type="url" bind:value={site.siteUrl} /></label>
					<label>站点描述<textarea rows="3" bind:value={site.description}></textarea></label>
					<label>关键词（逗号分隔）<input value={site.keywords.join(", ")} oninput={(event) => (site.keywords = event.currentTarget.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
				</div>
				<div class="config-section">
					<header><h2>导航栏设置</h2><p>配置左上角站点标识及导航标题。</p></header>
					<div class="form-grid two">
						<label>导航标题<input bind:value={site.navbar.title} /></label>
						<label>Logo 类型<select bind:value={site.navbar.logo.type}><option value="image">本地图片</option><option value="url">网络图片</option><option value="icon">Iconify 图标</option></select></label>
					</div>
					<label>Logo 值<input bind:value={site.navbar.logo.value} /></label>
					<label>Logo 替代文字<input bind:value={site.navbar.logo.alt} /></label>
				</div>
				<div class="config-section">
					<header><h2>主题与布局</h2><p>这些配置会在 Cloudflare 完成下一次构建后生效。</p></header>
					<label>主题色 Hue：{site.theme.hue}<input type="range" min="0" max="360" bind:value={site.theme.hue} /></label>
					<div class="form-grid three">
						<label>默认模式<select bind:value={site.theme.defaultMode}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
						<label>页面宽度（rem）<input type="number" min="60" max="140" bind:value={site.layout.pageWidth} /></label>
						<label>每页文章数<input type="number" min="1" max="50" bind:value={site.layout.postsPerPage} /></label>
					</div>
					<label>站点开始日期<input type="date" bind:value={site.siteStartDate} /></label>
					<label class="check"><input type="checkbox" bind:checked={site.theme.fixed} />固定主题色，隐藏访客调色选项</label>
					<label class="check"><input type="checkbox" bind:checked={site.layout.categoryBar} />显示分类快捷导航</label>
				</div>
				<div class="config-section">
					<header><h2>其他设置</h2><p>控制首页右下角状态事件，可按指定时区和工作时间自动切换。</p></header>
					<div class="form-grid three">
						<label>状态显示方式<select bind:value={portfolio.statusEvent.mode}><option value="schedule">按时间自动切换</option><option value="working">始终显示上班</option><option value="offwork">始终显示下班</option><option value="resting">始终显示休息</option><option value="hidden">隐藏状态圆圈</option></select></label>
						<label>时区<input bind:value={portfolio.statusEvent.timezone} placeholder="Asia/Shanghai" /></label>
						<label>点击跳转<input bind:value={portfolio.statusEvent.linkUrl} placeholder="/about/" /></label>
					</div>
					<div class="form-grid two">
						<label>上班时间（0–23）<input type="number" min="0" max="23" bind:value={portfolio.statusEvent.workStart} /></label>
						<label>下班时间（1–24）<input type="number" min="1" max="24" bind:value={portfolio.statusEvent.workEnd} /></label>
					</div>
					<div class="form-grid three">
						<label>工作状态文字<input bind:value={portfolio.statusEvent.workingLabel} /></label>
						<label>下班状态文字<input bind:value={portfolio.statusEvent.offworkLabel} /></label>
						<label>休息状态文字<input bind:value={portfolio.statusEvent.restingLabel} /></label>
					</div>
				</div>
			{:else if activeTab === "projects"}
				<div class="config-section">
					<header><h2>GitHub 项目主页</h2><p>公开仓库由 GitHub API 自动同步，不需要另建展示仓库。</p></header>
					<div class="form-grid two">
						<label>GitHub 用户名<input bind:value={portfolio.github.username} /></label>
						<label>展示项目数量<input type="number" min="1" max="30" bind:value={portfolio.github.limit} /></label>
					</div>
					<label>置顶仓库（逗号分隔）<input value={portfolio.github.featured.join(", ")} oninput={(event) => (portfolio.github.featured = event.currentTarget.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
					<label class="check"><input type="checkbox" bind:checked={portfolio.github.showForks} />展示参与或 Fork 的项目</label>
				</div>
				<div class="config-section">
					<header><h2>项目分类展示</h2><p>主页固定使用分类查看，可设置每行项目数与自定义分类。</p></header>
					<label>每行项目数<select bind:value={portfolio.github.gridColumns}><option value={2}>2 个</option><option value={3}>3 个</option></select></label>
					<label>项目分类（逗号分隔）<input value={portfolio.github.categories.join(", ")} oninput={(event) => (portfolio.github.categories = event.currentTarget.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
				</div>
				<div class="config-section">
					<header><div><h2>仓库分类与标签</h2><p>仓库名称需与 GitHub 一致；分类和标签均可自定义。</p></div><button type="button" class="button-secondary" onclick={addProjectMeta}>添加仓库规则</button></header>
					<div class="repeater">
						{#each portfolio.github.projectMeta as item, index}
							<div class="repeater-row project-rule">
								<input aria-label="GitHub 仓库名称" bind:value={item.name} placeholder="仓库名称" />
								<input aria-label="项目分类" bind:value={item.category} list="project-category-options" placeholder="项目分类" />
								<input aria-label="项目标签" value={item.tags.join(", ")} oninput={(event) => (item.tags = event.currentTarget.value.split(",").map((tag) => tag.trim()).filter(Boolean))} placeholder="标签，逗号分隔" />
								<button type="button" class="danger" onclick={() => removeProjectMeta(index)}>删除</button>
							</div>
						{/each}
					</div>
					<datalist id="project-category-options">{#each portfolio.github.categories as category}<option value={category}></option>{/each}</datalist>
				</div>
				<div class="config-section">
					<header><h2>首页文案</h2><p>用于项目列表上方的标题与简介。</p></header>
					<label>标题<input bind:value={portfolio.home.heading} /></label>
					<label>简介<textarea rows="4" bind:value={portfolio.home.intro}></textarea></label>
				</div>
			{:else if activeTab === "profile"}
				<div class="config-section">
					<header><h2>基本资料</h2><p>用于个人资料卡、横幅和文章作者信息。</p></header>
					<label>头像 URL<input bind:value={profile.avatar} /></label>
					<div class="form-grid two"><label>名称<input bind:value={profile.name} /></label><label>个性签名<input bind:value={profile.bio} /></label></div>
				</div>
				<div class="config-section">
					<header><div><h2>社交链接</h2><p>游客只能查看，授权后可新增或删除。</p></div><button type="button" class="button-secondary" onclick={addProfileLink}>添加链接</button></header>
					<div class="repeater">
						{#each profile.links as link, index}
							<div class="repeater-row profile-link">
								<input aria-label="链接名称" bind:value={link.name} />
								<input aria-label="链接地址" bind:value={link.url} />
								<input aria-label="图标名称" bind:value={link.icon} />
								<button type="button" class="danger" onclick={() => removeProfileLink(index)}>删除</button>
							</div>
						{/each}
					</div>
				</div>
			{:else if activeTab === "appearance"}
				<div class="config-section">
					<header><h2>横幅文字</h2><p>副标题每行一条，打字机会按顺序循环。</p></header>
					<label>横幅主标题<input bind:value={portfolio.appearance.bannerTitle} /></label>
					<label>横幅副标题<textarea rows="5" value={portfolio.appearance.bannerSubtitle.join("\n")} oninput={(event) => (portfolio.appearance.bannerSubtitle = event.currentTarget.value.split("\n").map((item) => item.trim()).filter(Boolean))}></textarea></label>
				</div>
				<div class="config-section">
					<header><h2>壁纸图片</h2><p>留空时继续使用仓库内置的桌面和移动壁纸。</p></header>
					<label>桌面壁纸 URL<input type="url" bind:value={portfolio.appearance.desktopWallpaper} placeholder="留空使用默认壁纸" /></label>
					<label>移动壁纸 URL<input type="url" bind:value={portfolio.appearance.mobileWallpaper} placeholder="留空使用默认壁纸" /></label>
				</div>
			{:else if activeTab === "sidebar"}
				<div class="config-section">
					<header><h2>首页侧边栏</h2><p>主页已隐藏文章分类、站点统计和站点信息。</p></header>
					<div class="toggle-grid">
						<label class="check"><input type="checkbox" bind:checked={portfolio.sidebar.showSkills} />能力矩阵</label>
						<label class="check"><input type="checkbox" bind:checked={portfolio.sidebar.showCalendar} />日历</label>
						<label class="check"><input type="checkbox" bind:checked={portfolio.sidebar.showAnnouncement} />公告</label>
					</div>
				</div>
				<div class="config-section">
					<header><div><h2>能力矩阵</h2><p>图标使用 Iconify 名称，例如 simple-icons:astro。</p></div><button type="button" class="button-secondary" onclick={addSkill}>添加技能</button></header>
					<div class="repeater">
						{#each portfolio.skills as skill, index}
							<div class="repeater-row skill-row"><input aria-label="技能名称" bind:value={skill.name} /><input aria-label="图标名称" bind:value={skill.icon} /><button type="button" class="danger" onclick={() => removeSkill(index)}>删除</button></div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="config-section">
					<header><h2>公告设置</h2><p>控制左侧公告组件的内容和链接。</p></header>
					<label>公告标题<input bind:value={portfolio.announcement.title} /></label>
					<label>公告内容<textarea rows="4" bind:value={portfolio.announcement.content}></textarea></label>
					<div class="form-grid two"><label>链接文字<input bind:value={portfolio.announcement.linkText} /></label><label>链接 URL<input bind:value={portfolio.announcement.linkUrl} /></label></div>
					<label class="check"><input type="checkbox" bind:checked={portfolio.announcement.closable} />允许访客关闭公告</label>
				</div>
			{/if}
		</fieldset>
	</form>
</section>

<style>
	.config-shell { color: var(--deep-text); }
	.config-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem; margin-bottom: 1.2rem; }
	.config-hero span { color: var(--content-meta); font-size: .75rem; font-weight: 850; letter-spacing: .12em; }
	.config-hero h1 { margin: .15rem 0; font-size: clamp(2.4rem, 6vw, 4.8rem); line-height: .95; letter-spacing: -.04em; }
	.config-hero p { max-width: 48ch; margin: .7rem 0 0; color: var(--content-meta); line-height: 1.65; }
	.config-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
	button { min-height: 2.35rem; padding: .48rem .8rem; border-radius: .5rem; font-size: .76rem; font-weight: 800; cursor: pointer; }
	button:disabled { cursor: not-allowed; opacity: .52; }
	.button-primary { background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	.button-secondary { border: 1px solid var(--line-divider); background: var(--card-bg); color: var(--deep-text); }
	.auth-panel { display: grid; grid-template-columns: minmax(14rem, 1fr) minmax(16rem, 1fr) auto; gap: 1rem; align-items: center; padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--primary); border-radius: .75rem; background: color-mix(in oklch, var(--primary) 7%, var(--card-bg)); }
	.auth-panel p { margin: .25rem 0 0; color: var(--content-meta); font-size: .76rem; }
	.config-status { padding: .75rem 1rem; margin-bottom: 1rem; border-radius: .6rem; background: var(--btn-regular-bg); color: var(--content-meta); font-size: .78rem; font-weight: 700; }
	.config-status.status-success { background: color-mix(in oklch, #16a34a 12%, var(--card-bg)); color: color-mix(in oklch, #15803d 74%, var(--deep-text)); }
	.config-status.status-error { background: color-mix(in oklch, #dc2626 10%, var(--card-bg)); color: color-mix(in oklch, #b91c1c 72%, var(--deep-text)); }
	.config-tabs { display: flex; gap: .35rem; overflow-x: auto; padding: .4rem; margin-bottom: 1rem; border-radius: .75rem; background: var(--btn-regular-bg); scrollbar-width: none; }
	.config-tabs button { display: inline-flex; align-items: center; gap: .4rem; flex: 0 0 auto; background: transparent; color: var(--content-meta); }
	.config-tabs button.active { background: var(--primary); color: oklch(.18 .02 var(--hue)); }
	fieldset { display: grid; gap: 1rem; padding: 0; border: 0; }
	.config-section { padding: 1.2rem; border: 1px solid var(--line-divider); border-radius: .8rem; background: var(--card-bg); }
	.config-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding-bottom: 1rem; margin-bottom: 1rem; border-bottom: 1px solid var(--line-divider); }
	.config-section h2 { margin: 0; font-size: 1rem; }
	.config-section header p { margin: .25rem 0 0; color: var(--content-meta); font-size: .75rem; line-height: 1.5; }
	.section-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
	.local-secret-note { margin: 1rem 0 0; padding: .75rem; border-radius: .55rem; background: var(--btn-regular-bg); color: var(--content-meta); font-size: .72rem; line-height: 1.55; }
	.config-section label { display: grid; gap: .45rem; margin-top: .9rem; color: var(--content-meta); font-size: .75rem; font-weight: 750; }
	.config-section header + label, .config-section header + .form-grid, .config-section header + .toggle-grid { margin-top: 0; }
	input, textarea, select { width: 100%; min-height: 2.55rem; padding: .55rem .7rem; border: 1px solid color-mix(in oklch, var(--line-divider) 80%, var(--deep-text)); border-radius: .5rem; background: var(--card-bg); color: var(--deep-text); font: inherit; }
	textarea { resize: vertical; line-height: 1.6; }
	input:disabled, textarea:disabled, select:disabled { background: var(--btn-regular-bg); color: var(--content-meta); opacity: .82; }
	input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
	input[type="range"] { padding: 0; border: 0; accent-color: var(--primary); }
	.form-grid { display: grid; gap: .9rem; }
	.form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.check { display: flex !important; align-items: center; grid-template-columns: auto 1fr; gap: .55rem !important; }
	.check input { width: 1rem; min-height: 1rem; accent-color: var(--primary); }
	.toggle-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .6rem; }
	.toggle-grid .check { padding: .75rem; margin: 0; border-radius: .55rem; background: var(--btn-regular-bg); }
	.repeater { display: grid; gap: .6rem; }
	.repeater-row { display: grid; gap: .6rem; align-items: center; }
	.profile-link { grid-template-columns: .7fr 1.4fr 1fr auto; }
	.skill-row { grid-template-columns: 1fr 1.5fr auto; }
	.project-rule { grid-template-columns: .9fr .8fr 1.25fr auto; }
	.danger { border: 1px solid color-mix(in oklch, #dc2626 38%, transparent); background: transparent; color: #dc2626; }
	@media (max-width: 900px) { .config-hero { align-items: flex-start; flex-direction: column; } .config-actions { justify-content: flex-start; } .auth-panel, .form-grid.three { grid-template-columns: 1fr; } }
	@media (max-width: 640px) { .form-grid.two, .toggle-grid, .profile-link, .skill-row, .project-rule { grid-template-columns: 1fr; } .config-section > header { flex-direction: column; } }
</style>
