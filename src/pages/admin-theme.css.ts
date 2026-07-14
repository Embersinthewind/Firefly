import { siteConfig } from "@/config/siteConfig";

export const prerender = true;

export function GET(): Response {
	const hue = siteConfig.themeColor.hue;
	const css = `
:root {
	--firefly-hue: ${hue};
	--firefly-primary: oklch(0.70 0.14 var(--firefly-hue));
	--firefly-page: oklch(0.97 0.008 var(--firefly-hue));
	--firefly-surface: oklch(1 0.004 var(--firefly-hue));
	--firefly-ink: oklch(0.25 0.02 var(--firefly-hue));
	--firefly-muted: oklch(0.48 0.018 var(--firefly-hue));
	--firefly-line: oklch(0.88 0.018 var(--firefly-hue));
	--firefly-code: oklch(0.17 0.015 var(--firefly-hue));
	color-scheme: light dark;
}

body {
	margin: 0;
	background: var(--firefly-surface);
	color: var(--firefly-ink);
	font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif;
	font-size: 16px;
	line-height: 1.75;
}

body > main,
body > article,
body > div:not(#nc-root) {
	box-sizing: border-box;
	width: min(72ch, calc(100% - 2rem));
	margin-inline: auto;
	padding-block: 2rem 4rem;
}

h1,
h2,
h3,
h4,
h5,
h6 {
	color: var(--firefly-ink);
	font-weight: 750;
	line-height: 1.28;
	letter-spacing: -0.025em;
	text-wrap: balance;
}

h1 { font-size: 2rem; }
h2 { margin-top: 2.4rem; font-size: 1.5rem; }
h3 { margin-top: 2rem; font-size: 1.25rem; }

p,
li {
	text-wrap: pretty;
}

a {
	color: oklch(0.52 0.13 var(--firefly-hue));
	text-underline-offset: 0.2em;
}

blockquote {
	margin-inline: 0;
	border: 1px solid var(--firefly-line);
	border-radius: 0.75rem;
	padding: 0.75rem 1rem;
	background: color-mix(in oklch, var(--firefly-primary) 8%, var(--firefly-surface));
}

code {
	border-radius: 0.35rem;
	padding: 0.12em 0.35em;
	background: color-mix(in oklch, var(--firefly-primary) 10%, var(--firefly-surface));
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	font-size: 0.9em;
}

pre {
	overflow: auto;
	border-radius: 0.75rem;
	padding: 1rem 1.125rem;
	background: var(--firefly-code);
	color: oklch(0.94 0.01 var(--firefly-hue));
}

pre code {
	padding: 0;
	background: transparent;
	color: inherit;
}

img {
	max-width: 100%;
	height: auto;
	border-radius: 0.75rem;
}

hr {
	border: 0;
	border-top: 1px solid var(--firefly-line);
	margin-block: 2.5rem;
}

table {
	width: 100%;
	border-collapse: collapse;
}

th,
td {
	border-bottom: 1px solid var(--firefly-line);
	padding: 0.65rem;
	text-align: start;
}

@media (prefers-color-scheme: dark) {
	:root {
		--firefly-page: oklch(0.16 0.014 var(--firefly-hue));
		--firefly-surface: oklch(0.23 0.015 var(--firefly-hue));
		--firefly-ink: oklch(0.92 0.012 var(--firefly-hue));
		--firefly-muted: oklch(0.70 0.018 var(--firefly-hue));
		--firefly-line: oklch(0.36 0.02 var(--firefly-hue));
	}
}

`;

	return new Response(css, {
		headers: {
			"Content-Type": "text/css; charset=utf-8",
			"Cache-Control": "public, max-age=300",
		},
	});
}
