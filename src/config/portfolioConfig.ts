import { z } from "astro/zod";
import type {
	PortfolioData,
	SiteEditorGitHubConfig,
} from "@/types/portfolioConfig";
import portfolioData from "../data/portfolio.json";

const projectSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	url: z.url(),
	homepage: z.string().optional(),
	language: z.string().optional(),
	stars: z.number().optional(),
	forks: z.number().optional(),
	updatedAt: z.string().optional(),
	isFork: z.boolean().optional(),
	topics: z.array(z.string()).optional(),
});

const portfolioSchema = z.object({
	home: z.object({ heading: z.string().min(1), intro: z.string() }),
	github: z.object({
		username: z.string().min(1),
		limit: z.number().int().min(1).max(30),
		featured: z.array(z.string()),
		showForks: z.boolean(),
		defaultView: z.enum(["grid", "categories"]),
		gridColumns: z.union([z.literal(2), z.literal(3)]),
		categories: z.array(z.string().min(1)),
		projectMeta: z.array(
			z.object({
				name: z.string().min(1),
				category: z.string().min(1),
				tags: z.array(z.string()),
			}),
		),
		fallbackProjects: z.array(projectSchema),
	}),
	skills: z.array(
		z.object({ name: z.string().min(1), icon: z.string().min(1) }),
	),
	sidebar: z.object({
		showSkills: z.boolean(),
		showCalendar: z.boolean(),
		showAnnouncement: z.boolean(),
	}),
	appearance: z.object({
		bannerTitle: z.string(),
		bannerSubtitle: z.array(z.string()),
		desktopWallpaper: z.string(),
		mobileWallpaper: z.string(),
	}),
	statusEvent: z.object({
		mode: z.enum(["schedule", "working", "resting", "hidden"]),
		timezone: z.string().min(1),
		workStart: z.number().int().min(0).max(23),
		workEnd: z.number().int().min(0).max(24),
		workingLabel: z.string().min(1),
		restingLabel: z.string().min(1),
		linkUrl: z.string().min(1),
	}),
	announcement: z.object({
		title: z.string(),
		content: z.string(),
		closable: z.boolean(),
		linkText: z.string(),
		linkUrl: z.string(),
	}),
});

export const portfolioConfig = portfolioSchema.parse(
	portfolioData,
) as PortfolioData;

export const siteEditorGitHubConfig: SiteEditorGitHubConfig = {
	owner: "Embersinthewind",
	repo: "Firefly",
	branch: "main",
	paths: {
		site: "src/data/site.json",
		profile: "src/data/profile.json",
		portfolio: "src/data/portfolio.json",
	},
};
