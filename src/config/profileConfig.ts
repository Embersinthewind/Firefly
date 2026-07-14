import { z } from "astro/zod";
import profileData from "../data/profile.json";
import type { ProfileConfig } from "../types/profileConfig";

const profileConfigSchema = z.object({
	avatar: z.string().optional(),
	name: z.string().min(1),
	bio: z.string().optional(),
	links: z.array(
		z.object({
			name: z.string().min(1),
			url: z.string().min(1),
			icon: z.string().min(1),
			showName: z.boolean().optional().default(false),
		}),
	),
});

/**
 * CMS-editable profile data.
 *
 * Keep the exported TypeScript API stable for existing components while the
 * actual values live in a JSON file that a browser CMS can safely update.
 */
export const profileConfig: ProfileConfig =
	profileConfigSchema.parse(profileData);
