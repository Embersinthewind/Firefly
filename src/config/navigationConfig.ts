import type {
	NavigationData,
	NavigationGitHubConfig,
} from "@/types/navigationConfig";
import navigationData from "../data/navigation.json";

export const navigationConfig = navigationData as NavigationData;

/**
 * 网站导航的写入目标。这里只保存公开仓库信息，不保存 GitHub Token。
 * 编辑者提供的 Token 仅保留在当前浏览器会话中。
 */
export const navigationGitHubConfig: NavigationGitHubConfig = {
	owner: "Embersinthewind",
	repo: "Firefly",
	branch: "main",
	path: "src/data/navigation.json",
};
