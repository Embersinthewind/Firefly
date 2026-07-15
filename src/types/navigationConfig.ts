export type NavigationItem = {
	id: string;
	title: string;
	url: string;
	description: string;
	icon?: string;
};

export type NavigationCategory = {
	id: string;
	name: string;
	items: NavigationItem[];
};

export type NavigationData = {
	title: string;
	description: string;
	categories: NavigationCategory[];
};

export type NavigationGitHubConfig = {
	owner: string;
	repo: string;
	branch: string;
	path: string;
};
