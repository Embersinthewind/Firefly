import {
	type NavBarConfig,
	type NavBarLink,
	type NavBarSearchConfig,
	NavBarSearchMethod,
} from "../types/navBarConfig";

const getDynamicNavBarConfig = (): NavBarConfig => {
	const links: NavBarLink[] = [LinkPresets.Home];

	links.push({
		name: "文章",
		url: "/articles/",
		icon: "material-symbols:article",
		children: [LinkPresets.Articles, LinkPresets.Categories, LinkPresets.Write],
	});

	links.push(LinkPresets.Navigation);

	links.push({
		name: "动态",
		url: "#",
		icon: "material-symbols:dynamic-feed-rounded",
		children: [LinkPresets.Gallery, LinkPresets.Guestbook],
	});

	links.push({
		name: "记录",
		url: "#",
		icon: "material-symbols:history-edu-rounded",
		children: [LinkPresets.Bangumi, LinkPresets.Anime, LinkPresets.Music],
	});

	links.push({
		name: "关于",
		url: "#",
		icon: "material-symbols:info-outline-rounded",
		children: [
			LinkPresets.About,
			LinkPresets.Friends,
			LinkPresets.Sponsor,
			LinkPresets.Config,
			{
				name: "项目主页",
				url: "https://github.com/Embersinthewind/Firefly",
				external: true,
				icon: "fa7-brands:github",
			},
		],
	});

	return { links } as NavBarConfig;
};

export const navBarSearchConfig: NavBarSearchConfig = {
	method: NavBarSearchMethod.PageFind,
};

export const LinkPresets: Record<string, NavBarLink> = {
	Home: {
		name: "主页",
		url: "/",
		icon: "material-symbols:home",
	},
	Articles: {
		name: "文章列表",
		url: "/articles/",
		icon: "material-symbols:article-outline",
	},
	Navigation: {
		name: "网站导航",
		url: "/navigation/",
		icon: "material-symbols:explore-outline-rounded",
	},
	Categories: {
		name: "分类",
		url: "/categories/",
		icon: "material-symbols:folder-open-rounded",
	},
	Write: {
		name: "写文章",
		url: "/write/",
		icon: "material-symbols:edit-note-rounded",
	},
	Tags: {
		name: "标签",
		url: "/tags/",
		icon: "material-symbols:tag-rounded",
	},
	Friends: {
		name: "友链",
		url: "/friends/",
		icon: "material-symbols:group",
		pageKey: "friends",
	},
	Sponsor: {
		name: "打赏",
		url: "/sponsor/",
		icon: "material-symbols:favorite",
		pageKey: "sponsor",
	},
	Guestbook: {
		name: "留言",
		url: "/guestbook/",
		icon: "material-symbols:chat",
		pageKey: "guestbook",
	},
	About: {
		name: "关于我",
		url: "/about/",
		icon: "material-symbols:person",
	},
	Bangumi: {
		name: "影视与游戏",
		url: "/bangumi/",
		icon: "material-symbols:movie",
		pageKey: "bangumi",
	},
	Gallery: {
		name: "相册",
		url: "/gallery/",
		icon: "material-symbols:photo-library",
		pageKey: "gallery",
	},
	Anime: {
		name: "番组记录",
		url: "/anime/",
		icon: "material-symbols:live-tv",
		pageKey: "anime",
	},
	Music: {
		name: "音乐",
		url: "/music/",
		icon: "material-symbols:music-note-rounded",
	},
	Config: {
		name: "站点配置",
		url: "/config/",
		icon: "material-symbols:settings-rounded",
	},
};

export const navBarConfig: NavBarConfig = getDynamicNavBarConfig();
