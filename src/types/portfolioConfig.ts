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
};

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
