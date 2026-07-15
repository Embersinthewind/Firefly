import type { AnnouncementConfig } from "../types/announcementConfig";
import { portfolioConfig } from "./portfolioConfig";

const announcement = portfolioConfig.announcement;

export const announcementConfig: AnnouncementConfig = {
	title: announcement.title,
	content: announcement.content,
	closable: announcement.closable,
	link: {
		enable: Boolean(announcement.linkText && announcement.linkUrl),
		text: announcement.linkText,
		url: announcement.linkUrl,
		external: /^https?:\/\//.test(announcement.linkUrl),
	},
};
