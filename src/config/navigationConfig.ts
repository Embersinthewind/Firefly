import type {
	NavigationData,
	NavigationGitHubConfig,
} from "@/types/navigationConfig";
import navigationData from "../data/navigation.json";

export const navigationConfig = navigationData as NavigationData;

/**
 * 网站导航的公开仓库信息。写入操作统一通过 Cloudflare 作者代理完成，
 * GitHub Token 仅保存在 Cloudflare Secret 中。
 */
export const navigationGitHubConfig: NavigationGitHubConfig = {
	owner: "Embersinthewind",
	repo: "Firefly",
	branch: "main",
	path: "src/data/navigation.json",
};
