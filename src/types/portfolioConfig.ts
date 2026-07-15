export type GitHubProjectSnapshot = {
	name: string;
	description: string;
	url: string;
	homepage?: string;
	language?: string;
	stars?: number;
	forks?: number;
	updatedAt?: string;
	isFork?: boolean;
	topics?: string[];
};

export type ProjectMeta = {
	name: string;
	category: string;
	tags: string[];
};

export type HeroStatusMode = "schedule" | "working" | "resting" | "hidden";

export type SkillItem = {
	name: string;
	icon: string;
};

export type SiteEditorSiteData = {
	title: string;
	subtitle: string;
	siteUrl: string;
	description: string;
	keywords: string[];
	siteStartDate: string;
	theme: {
		hue: number;
		fixed: boolean;
		defaultMode: "light" | "dark" | "system";
	};
	navbar: {
		title: string;
		logo: { type: "icon" | "image" | "url"; value: string; alt: string };
	};
	layout: { pageWidth: number; categoryBar: boolean; postsPerPage: number };
};

export type SiteEditorProfileData = {
	avatar?: string;
	name: string;
	bio?: string;
	links: { name: string; url: string; icon: string; showName?: boolean }[];
};

export type PortfolioData = {
	home: { heading: string; intro: string };
	github: {
		username: string;
		limit: number;
		featured: string[];
		showForks: boolean;
		gridColumns: 2 | 3;
		categories: string[];
		projectMeta: ProjectMeta[];
		fallbackProjects: GitHubProjectSnapshot[];
	};
	skills: SkillItem[];
	sidebar: {
		showSkills: boolean;
		showCalendar: boolean;
		showAnnouncement: boolean;
	};
	appearance: {
		bannerTitle: string;
		bannerSubtitle: string[];
		desktopWallpaper: string;
		mobileWallpaper: string;
	};
	statusEvent: {
		mode: HeroStatusMode;
		timezone: string;
		workStart: number;
		workEnd: number;
		workingLabel: string;
		restingLabel: string;
		linkUrl: string;
	};
	announcement: {
		title: string;
		content: string;
		closable: boolean;
		linkText: string;
		linkUrl: string;
	};
};

export type SiteEditorGitHubConfig = {
	owner: string;
	repo: string;
	branch: string;
	paths: { site: string; profile: string; portfolio: string };
};
