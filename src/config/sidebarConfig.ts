import type { SidebarLayoutConfig } from "../types/sidebarConfig";
import { portfolioConfig } from "./portfolioConfig";

/**
 * 首页只保留个人资料、公告、日历与能力矩阵。
 * 分类、标签、统计和站点信息仅在文章详情页出现，避免干扰项目展示。
 */
export const sidebarLayoutConfig: SidebarLayoutConfig = {
	enable: true,
	position: "both",
	tabletSidebar: "left",
	hideSidebarOnPostPage: false,
	showBothSidebarsOnPostPage: true,
	leftComponents: [
		{
			type: "profile",
			enable: true,
			position: "top",
			showOnPostPage: true,
		},
		{
			type: "announcement",
			enable: portfolioConfig.sidebar.showAnnouncement,
			position: "top",
			showOnPostPage: true,
		},
		{
			type: "music",
			enable: false,
			position: "sticky",
			showOnPostPage: true,
		},
		{
			type: "categories",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { collapseThreshold: 5 },
		},
		{
			type: "tags",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { collapseThreshold: 10 },
		},
	],
	rightComponents: [
		{
			type: "calendar",
			enable: portfolioConfig.sidebar.showCalendar,
			showTitle: false,
			position: "top",
			showOnPostPage: false,
			specificConfig: { calendar: { showHeatmap: false } },
		},
		{
			type: "skills",
			enable: portfolioConfig.sidebar.showSkills,
			position: "top",
			showOnPostPage: true,
			hideOnWritePage: true,
		},
		{
			type: "articleViews",
			enable: true,
			position: "top",
			showOnPostPage: false,
			showOnWritePageOnly: true,
		},
		{
			type: "recentItems",
			enable: true,
			position: "top",
			showOnPostPage: false,
			showOnWritePageOnly: true,
		},
		{
			type: "stats",
			enable: true,
			position: "top",
			showOnPostPage: true,
			hideOnNonPostPage: true,
		},
		{
			type: "siteInfo",
			enable: true,
			position: "top",
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { siteInfo: { unknownBuildPlatform: "Unknown CI" } },
		},
		{
			type: "sidebarToc",
			enable: true,
			position: "sticky",
			showOnPostPage: true,
			hideOnNonPostPage: true,
		},
	],
	mobileBottomComponents: [
		{ type: "profile", enable: true, showOnPostPage: true },
		{
			type: "announcement",
			enable: portfolioConfig.sidebar.showAnnouncement,
			showOnPostPage: true,
		},
		{
			type: "skills",
			enable: portfolioConfig.sidebar.showSkills,
			showOnPostPage: true,
		},
		{ type: "music", enable: false, showOnPostPage: true },
		{
			type: "categories",
			enable: true,
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { collapseThreshold: 5 },
		},
		{
			type: "tags",
			enable: true,
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { collapseThreshold: 10 },
		},
		{
			type: "stats",
			enable: true,
			showOnPostPage: true,
			hideOnNonPostPage: true,
		},
		{
			type: "siteInfo",
			enable: true,
			showOnPostPage: true,
			hideOnNonPostPage: true,
			specificConfig: { siteInfo: { unknownBuildPlatform: "Unknown CI" } },
		},
	],
};
