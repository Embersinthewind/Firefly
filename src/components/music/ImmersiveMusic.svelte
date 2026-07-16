<script lang="ts">
import { onMount } from "svelte";
import * as THREE from "three";

type Player = NonNullable<Window["__fireflyMusic"]>;
type PlayerState = ReturnType<Player["getState"]>;
type Track = PlayerState["playlist"][number];
type Lyric = PlayerState["lyrics"][number];

let visualHost: HTMLDivElement;
let player: Player | null = null;
let analyser: AnalyserNode | null = null;
let playlist: Track[] = [];
let track: Track | null = null;
let currentIndex = 0;
let isPlaying = false;
let playMode = 0;
let volume = 0.7;
let isMuted = false;
let progress = 0;
let currentTime = "0:00";
let duration = "0:00";
let lyrics: Lyric[] = [];
let currentLrcIndex = -1;
let playlistOpen = false;
let errorMessage = "";

const modeLabels = ["列表循环", "单曲循环", "随机播放"];

function getVisibleLyrics() {
	if (!lyrics.length) {
		return [{ time: 0, text: "让旋律填满这一刻", index: -1 }];
	}
	const center = Math.max(0, currentLrcIndex);
	const start = Math.max(0, Math.min(center - 4, lyrics.length - 9));
	return lyrics.slice(start, start + 9).map((line, offset) => ({
		...line,
		index: start + offset,
	}));
}

function syncState() {
	if (!player) return;
	const state = player.getState();
	playlist = state.playlist;
	track = state.track;
	currentIndex = state.currentIndex;
	isPlaying = state.isPlaying;
	playMode = state.playMode;
	volume = state.volume;
	isMuted = state.isMuted;
	progress = state.progress;
	currentTime = state.currentTimeStr;
	duration = state.durationStr;
	lyrics = state.lyrics;
	currentLrcIndex = state.currentLrcIndex;
	errorMessage = state.error || "";
}

async function activateAudioGraph() {
	if (!player) return;
	await player.resumeAudioContext();
	analyser = player.getAnalyser();
}

async function togglePlayback() {
	await activateAudioGraph();
	player?.togglePlay();
}

async function playTrack(index: number) {
	await activateAudioGraph();
	player?.playTrackByIndex(index);
	if (window.innerWidth < 900) playlistOpen = false;
}

function seek(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	player?.seek(Number(input.value) / 100);
}

function setVolume(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	player?.setVolume(Number(input.value) / 100);
}

function seekLyric(time: number) {
	player?.seekToTime(time);
}

onMount(() => {
	player = window.__fireflyMusic ?? null;
	const controller = new AbortController();
	const signal = controller.signal;

	const bind = (name: string, handler: (event: CustomEvent) => void) => {
		window.addEventListener(name, handler as EventListener, { signal });
	};

	bind("fm:init", () => syncState());
	bind("fm:track", () => syncState());
	bind("fm:play-state", (event) => {
		isPlaying = Boolean(event.detail?.isPlaying);
	});
	bind("fm:time", (event) => {
		progress = Number(event.detail?.progress || 0);
		currentTime = event.detail?.currentTimeStr || "0:00";
		duration = event.detail?.durationStr || "0:00";
	});
	bind("fm:volume", (event) => {
		volume = Number(event.detail?.volume ?? volume);
		isMuted = Boolean(event.detail?.isMuted);
	});
	bind("fm:mode", (event) => {
		playMode = Number(event.detail?.playMode ?? event.detail?.mode ?? 0);
	});
	bind("fm:lyrics", (event) => {
		lyrics = event.detail?.lyrics || [];
	});
	bind("fm:lrc-index", (event) => {
		currentLrcIndex = Number(event.detail?.index ?? -1);
	});
	bind("fm:error", (event) => {
		errorMessage = event.detail?.message || "音乐暂时无法加载";
	});

	if (player) {
		const state = player.getState();
		if (state.initialized) syncState();
		else void player.init();
	}

	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	const scene = new THREE.Scene();
	scene.background = new THREE.Color("#050711");
	scene.fog = new THREE.FogExp2("#050711", 0.028);

	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);
	camera.position.set(0, 27, 43);
	camera.lookAt(0, 0, 0);

	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.2;
	visualHost.appendChild(renderer.domElement);

	const mobile = window.innerWidth < 760;
	const gridSize = mobile ? 38 : 62;
	const count = gridSize * gridSize;
	const spacing = mobile ? 0.82 : 0.72;
	const geometry = new THREE.BoxGeometry(spacing * 0.8, 1, spacing * 0.8);
	geometry.translate(0, 0.5, 0);
	const material = new THREE.MeshStandardMaterial({
		color: "#ffffff",
		vertexColors: true,
		roughness: 0.32,
		metalness: 0.12,
		emissive: new THREE.Color("#102a66"),
		emissiveIntensity: 0.82,
	});
	const bars = new THREE.InstancedMesh(geometry, material, count);
	bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	bars.frustumCulled = false;
	scene.add(bars);

	const ambient = new THREE.HemisphereLight("#b7ecff", "#090618", 2.1);
	scene.add(ambient);
	const cyanLight = new THREE.PointLight("#22ddff", 1250, 68, 1.6);
	cyanLight.position.set(-8, 16, 4);
	scene.add(cyanLight);
	const magentaLight = new THREE.PointLight("#ff3caa", 950, 64, 1.7);
	magentaLight.position.set(12, 11, -4);
	scene.add(magentaLight);

	const starCount = mobile ? 240 : 620;
	const starPositions = new Float32Array(starCount * 3);
	for (let i = 0; i < starCount; i++) {
		starPositions[i * 3] = (Math.random() - 0.5) * 76;
		starPositions[i * 3 + 1] = 5 + Math.random() * 30;
		starPositions[i * 3 + 2] = (Math.random() - 0.5) * 65;
	}
	const starGeometry = new THREE.BufferGeometry();
	starGeometry.setAttribute(
		"position",
		new THREE.BufferAttribute(starPositions, 3),
	);
	const starMaterial = new THREE.PointsMaterial({
		color: "#b6eaff",
		size: 0.085,
		transparent: true,
		opacity: 0.48,
		depthWrite: false,
	});
	const stars = new THREE.Points(starGeometry, starMaterial);
	scene.add(stars);

	const positions: Array<{
		x: number;
		z: number;
		radius: number;
		angle: number;
		band: number;
	}> = [];
	const dummy = new THREE.Object3D();
	const color = new THREE.Color();
	const cool = new THREE.Color("#2855ff");
	const cyan = new THREE.Color("#2de2ff");
	const hot = new THREE.Color("#ff3c9f");
	const violet = new THREE.Color("#7542ff");
	for (let zIndex = 0; zIndex < gridSize; zIndex++) {
		for (let xIndex = 0; xIndex < gridSize; xIndex++) {
			const x = (xIndex - (gridSize - 1) / 2) * spacing;
			const z = (zIndex - (gridSize - 1) / 2) * spacing;
			const radius = Math.hypot(x, z);
			positions.push({
				x,
				z,
				radius,
				angle: Math.atan2(z, x),
				band: Math.min(1, Math.abs(x) / (gridSize * spacing * 0.5)),
			});
		}
	}

	let pointerX = 0;
	let pointerY = 0;
	let animationId = 0;
	let lastFrame = 0;
	let frequencyData: Uint8Array<ArrayBuffer> | null = null;

	const onPointerMove = (event: PointerEvent) => {
		pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
		pointerY = (event.clientY / window.innerHeight - 0.5) * 2;
	};

	const resize = () => {
		const width = visualHost.clientWidth || window.innerWidth;
		const height = visualHost.clientHeight || window.innerHeight;
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
	};

	const bandAverage = (
		data: Uint8Array<ArrayBuffer>,
		from: number,
		to: number,
	) => {
		let sum = 0;
		const start = Math.floor(data.length * from);
		const end = Math.max(start + 1, Math.floor(data.length * to));
		for (let i = start; i < end; i++) sum += data[i];
		return sum / (end - start) / 255;
	};

	const animate = (timestamp: number) => {
		animationId = requestAnimationFrame(animate);
		if (document.hidden || timestamp - lastFrame < (mobile ? 30 : 20)) return;
		lastFrame = timestamp;
		const elapsed = timestamp / 1000;

		if (
			analyser &&
			(!frequencyData || frequencyData.length !== analyser.frequencyBinCount)
		) {
			frequencyData = new Uint8Array(analyser.frequencyBinCount);
		}
		if (analyser && frequencyData) analyser.getByteFrequencyData(frequencyData);
		const measured = frequencyData ? bandAverage(frequencyData, 0, 0.45) : 0;
		const activity = isPlaying ? 1 : 0.68;
		const bass =
			measured > 0.005 && frequencyData
				? bandAverage(frequencyData, 0.005, 0.08)
				: (Math.sin(elapsed * 2.4) + 1) * 0.18;
		const mid =
			measured > 0.005 && frequencyData
				? bandAverage(frequencyData, 0.08, 0.24)
				: (Math.sin(elapsed * 1.7 + 1.1) + 1) * 0.14;
		const high =
			measured > 0.005 && frequencyData
				? bandAverage(frequencyData, 0.24, 0.48)
				: (Math.sin(elapsed * 3.1 + 2.4) + 1) * 0.1;

		positions.forEach((point, index) => {
			const envelope = Math.exp(
				-(point.radius * point.radius) / (gridSize * 5.4),
			);
			const ripple =
				(Math.sin(point.radius * 0.88 - elapsed * (isPlaying ? 3.1 : 0.7)) +
					1) *
				0.5;
			const crossWave =
				(Math.sin(point.x * 0.42 + elapsed * 1.35) *
					Math.cos(point.z * 0.34 - elapsed) +
					1) *
				0.5;
			const bandEnergy =
				point.band < 0.33 ? bass : point.band < 0.68 ? mid : high;
			const height =
				0.18 +
				envelope *
					activity *
					(0.55 + bandEnergy * 10 + ripple * 2.25 + crossWave * 1.35);
			dummy.position.set(point.x, -1.8, point.z);
			dummy.scale.set(1, reduceMotion ? Math.min(height, 2.2) : height, 1);
			dummy.updateMatrix();
			bars.setMatrixAt(index, dummy.matrix);

			const heat = Math.min(1, Math.max(0, (height - 0.5) / 6));
			if (Math.sin(point.angle * 2 + elapsed * 0.18) > 0.15)
				color.lerpColors(cool, cyan, Math.min(1, heat * 1.35));
			else color.lerpColors(violet, hot, heat);
			color.multiplyScalar(0.86 + envelope * 0.42);
			bars.setColorAt(index, color);
		});
		bars.instanceMatrix.needsUpdate = true;
		if (bars.instanceColor) bars.instanceColor.needsUpdate = true;

		const orbit = reduceMotion ? 0 : elapsed * 0.018;
		camera.position.x +=
			(Math.sin(orbit) * 4 + pointerX * 2.4 - camera.position.x) * 0.018;
		camera.position.y += (27 - pointerY * 1.8 - camera.position.y) * 0.018;
		camera.lookAt(0, 1.2, 0);
		stars.rotation.y = reduceMotion ? 0 : elapsed * 0.006;
		renderer.render(scene, camera);
	};

	window.addEventListener("resize", resize, { signal });
	window.addEventListener("pointermove", onPointerMove, { signal });
	resize();
	animationId = requestAnimationFrame(animate);

	return () => {
		controller.abort();
		cancelAnimationFrame(animationId);
		geometry.dispose();
		material.dispose();
		starGeometry.dispose();
		starMaterial.dispose();
		renderer.dispose();
		renderer.domElement.remove();
	};
});
</script>

<svelte:head>
	<meta name="theme-color" content="#050711" />
</svelte:head>

<div class="immersive-music" class:is-playing={isPlaying}>
	<h1 class="sr-only">我的音乐</h1>
	<div class="visualizer" bind:this={visualHost} aria-hidden="true"></div>
	<div class="scene-haze" aria-hidden="true"></div>
	<div class="scene-vignette" aria-hidden="true"></div>

	<section class="lyrics-stage" aria-label="同步歌词">
		<div class="lyrics-rail" aria-hidden="true"><span></span></div>
		<div class="lyrics-list">
			{#each getVisibleLyrics() as line}
				<button
					type="button"
					class:active={line.index === currentLrcIndex || (currentLrcIndex < 0 && line.index === -1)}
					onclick={() => seekLyric(line.time)}
					disabled={line.index < 0}
				>
					{line.text}
				</button>
			{/each}
		</div>
	</section>

	<button
		type="button"
		class="playlist-mobile-toggle"
		onclick={() => (playlistOpen = !playlistOpen)}
		aria-expanded={playlistOpen}
		aria-controls="immersive-playlist"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12M4 12h12M4 18h8M19 16v-6m0 6-2-2m2 2 2-2" /></svg>
		歌单
	</button>

	<aside id="immersive-playlist" class="playlist-stage" class:open={playlistOpen} aria-label="播放列表">
		<header>
			<div><span>PLAYLIST</span><strong>歌单切换</strong></div>
			<em>{playlist.length}</em>
		</header>
		<div class="playlist-list" role="listbox" aria-label="歌曲">
			{#if playlist.length}
				{#each playlist as item, index}
					<button
						type="button"
						class:active={index === currentIndex}
						onclick={() => playTrack(index)}
						role="option"
						aria-selected={index === currentIndex}
					>
						<span class="playlist-copy"><strong>{item.name}</strong><small>{item.artist}</small></span>
						{#if index === currentIndex && isPlaying}<span class="equalizer" aria-label="正在播放"><i></i><i></i><i></i></span>{/if}
						{#if item.pic}<img src={item.pic} alt="" loading="lazy" referrerpolicy="no-referrer" />{/if}
					</button>
				{/each}
			{:else}
				<p class="playlist-empty">正在连接歌单…</p>
			{/if}
		</div>
	</aside>

	<div class="mobile-lyric" aria-live="polite">
		{lyrics[currentLrcIndex]?.text || "让旋律填满这一刻"}
	</div>

	<footer class="player-console" aria-label="音乐播放器">
		<div class="track-summary">
			<div class="current-cover">
				{#if track?.pic}<img src={track.pic} alt="" referrerpolicy="no-referrer" />{:else}<span>♪</span>{/if}
			</div>
			<div><strong>{track?.name || "正在载入歌单"}</strong><small>{track?.artist || "Firefly Music"}</small></div>
		</div>

		<div class="progress-group">
			<span>{currentTime}</span>
			<input
				type="range"
				min="0"
				max="100"
				step="0.1"
				value={progress}
				oninput={seek}
				aria-label="播放进度"
				style={`--range-progress:${progress}%`}
			/>
			<span>{duration}</span>
		</div>

		<div class="console-actions">
			<button type="button" class="playlist-button" onclick={() => (playlistOpen = !playlistOpen)} aria-label="显示播放列表">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11M4 12h8M4 18h6M17 11v8m0 0-2.5-2.5M17 19l2.5-2.5" /></svg>
			</button>
			<button type="button" onclick={() => player?.cyclePlayMode()} aria-label={modeLabels[playMode] || "切换播放模式"} title={modeLabels[playMode]}>
				{#if playMode === 1}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l3 3-3 3M17 17H7l-3-3 3-3M12 9v6M10.5 10.5 12 9l1.5 1.5" /></svg>{:else if playMode === 2}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3c4 0 6 10 10 10h3M17 4l3 3-3 3M4 17h3c1.7 0 3-1.8 4.2-4M17 14l3 3-3 3" /></svg>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13l3 3-3 3M20 17H7l-3-3 3-3" /></svg>{/if}
			</button>
			<button type="button" onclick={() => player?.playPrev()} aria-label="上一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 6 9 12l10 6z" /></svg></button>
			<button type="button" class="play-button" onclick={togglePlayback} aria-label={isPlaying ? "暂停" : "播放"}>
				{#if isPlaying}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>{/if}
			</button>
			<button type="button" onclick={() => player?.playNext()} aria-label="下一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 6 10 6-10 6zM18 5v14" /></svg></button>
			<div class="volume-control">
				<button type="button" onclick={() => player?.toggleMute()} aria-label={isMuted ? "取消静音" : "静音"}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM17 9c1.5 1.4 1.5 4.6 0 6M19.5 6.5c3.4 3.2 3.4 7.8 0 11" /></svg>
				</button>
				<input type="range" min="0" max="100" value={isMuted ? 0 : volume * 100} oninput={setVolume} aria-label="音量" style={`--range-progress:${isMuted ? 0 : volume * 100}%`} />
			</div>
		</div>
	</footer>

	{#if errorMessage}<div class="music-error" role="status">{errorMessage}</div>{/if}
</div>

<style>
	:global(*) { box-sizing: border-box; }
	.immersive-music { position: relative; width: 100%; height: 100svh; overflow: hidden; background: #050711; color: #edf8ff; font-family: var(--font-family, ui-sans-serif, system-ui, sans-serif); }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	.visualizer { position: absolute; inset: 0; }
	.visualizer :global(canvas) { display: block; width: 100%; height: 100%; }
	.scene-haze { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 46%, transparent 0 34%, rgb(2 4 11 / 8%) 55%, rgb(2 4 10 / 72%) 100%), linear-gradient(to bottom, rgb(2 4 10 / 68%), transparent 24%, transparent 76%, rgb(2 4 10 / 72%)); }
	.scene-vignette { position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 13rem 4rem rgb(0 0 0 / 78%); }
	.lyrics-stage { position: absolute; z-index: 10; top: 18%; bottom: 18%; left: clamp(2rem, 5vw, 6rem); display: flex; width: min(24rem, 27vw); align-items: center; gap: 1.4rem; mask-image: linear-gradient(to bottom, transparent, black 16%, black 84%, transparent); }
	.lyrics-rail { position: relative; width: 1px; height: 100%; flex: 0 0 1px; background: linear-gradient(to bottom, transparent, rgb(34 220 255 / 48%) 25% 75%, transparent); }
	.lyrics-rail span { position: absolute; top: 50%; left: 50%; width: .72rem; height: .72rem; border: 2px solid #28e3ff; border-radius: 50%; background: #07101e; box-shadow: 0 0 0 .35rem rgb(40 227 255 / 10%), 0 0 1.2rem rgb(40 227 255 / 80%); transform: translate(-50%, -50%); }
	.lyrics-list { display: flex; min-width: 0; flex: 1; flex-direction: column; justify-content: center; gap: clamp(.8rem, 1.5vh, 1.35rem); }
	.lyrics-list button { width: fit-content; max-width: 100%; padding: 0; border: 0; background: transparent; color: rgb(205 222 235 / 25%); font: inherit; font-size: clamp(.72rem, .85vw, .95rem); font-weight: 650; line-height: 1.35; text-align: left; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; cursor: pointer; transition: color 220ms ease, font-size 220ms ease, text-shadow 220ms ease, opacity 220ms ease; }
	.lyrics-list button:hover { color: rgb(228 247 255 / 68%); }
	.lyrics-list button.active { color: #f4fcff; font-size: clamp(1.25rem, 1.7vw, 1.9rem); font-weight: 800; text-shadow: 0 0 .8rem rgb(46 224 255 / 52%); white-space: normal; }
	.lyrics-list button:disabled { cursor: default; }
	.playlist-stage { position: absolute; z-index: 12; top: 18%; right: clamp(1.7rem, 4.5vw, 5.5rem); bottom: 17%; display: flex; width: min(18rem, 21vw); flex-direction: column; mask-image: linear-gradient(to bottom, transparent, black 10%, black 92%, transparent); }
	.playlist-stage header { display: flex; align-items: flex-start; justify-content: space-between; padding: 1.4rem .7rem 1rem; }
	.playlist-stage header div { display: flex; flex-direction: column; }
	.playlist-stage header span { color: #39dff5; font-family: ui-monospace, monospace; font-size: .65rem; font-weight: 800; letter-spacing: .14em; }
	.playlist-stage header strong { margin-top: .25rem; font-size: 1.05rem; }
	.playlist-stage header em { display: grid; place-items: center; min-width: 2rem; height: 2rem; padding-inline: .45rem; border-radius: 999px; background: rgb(67 216 244 / 9%); color: rgb(207 243 250 / 62%); font-size: .72rem; font-style: normal; }
	.playlist-list { min-height: 0; overflow: auto; overscroll-behavior: contain; }
	.playlist-list button { display: grid; width: 100%; grid-template-columns: minmax(0, 1fr) 1.2rem 3rem; align-items: center; gap: .55rem; padding: .5rem .7rem; border: 0; border-radius: .55rem; background: transparent; color: rgb(210 225 236 / 29%); text-align: left; cursor: pointer; transition: background-color 180ms ease, color 180ms ease, transform 180ms ease; }
	.playlist-list button:hover { background: rgb(111 216 255 / 7%); color: rgb(229 246 255 / 72%); }
	.playlist-list button.active { background: rgb(24 190 231 / 8%); color: #f3fbff; transform: translateX(-.35rem); }
	.playlist-copy { display: flex; min-width: 0; flex-direction: column; }
	.playlist-copy strong, .playlist-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.playlist-copy strong { font-size: .78rem; }
	.playlist-copy small { margin-top: .15rem; color: inherit; font-size: .62rem; opacity: .62; }
	.playlist-list img { width: 3rem; height: 3rem; border-radius: .45rem; object-fit: cover; filter: saturate(.72) brightness(.78); }
	.playlist-list button.active img { box-shadow: 0 0 0 1px #25dbf5, 0 0 1rem rgb(37 219 245 / 28%); filter: none; }
	.playlist-empty { color: rgb(214 232 242 / 42%); font-size: .78rem; }
	.equalizer { display: flex; height: 1.1rem; align-items: end; justify-content: center; gap: 2px; }
	.equalizer i { width: 2px; height: 100%; border-radius: 2px; background: #27ddf7; animation: equalize .65s ease-in-out infinite alternate; }
	.equalizer i:nth-child(2) { animation-delay: -.25s; }
	.equalizer i:nth-child(3) { animation-delay: -.42s; }
	.player-console { position: absolute; z-index: 20; right: 50%; bottom: clamp(1.2rem, 3vh, 2.2rem); display: grid; width: min(58rem, calc(100vw - 25rem)); min-height: 4.8rem; grid-template-columns: minmax(9.5rem, .75fr) minmax(12rem, 1fr) auto; align-items: center; gap: 1rem; padding: .55rem 1rem; border: 1px solid rgb(222 245 255 / 12%); border-radius: .85rem; background: rgb(215 228 236 / 48%); color: #0c1723; box-shadow: 0 .4rem .8rem rgb(0 0 0 / 28%); backdrop-filter: blur(18px) saturate(125%); transform: translateX(50%); }
	.track-summary { display: flex; min-width: 0; align-items: center; gap: .7rem; }
	.current-cover { display: grid; width: 3rem; height: 3rem; flex: 0 0 auto; place-items: center; overflow: hidden; border-radius: .45rem; background: #0d1827; color: #33def6; }
	.current-cover img { width: 100%; height: 100%; object-fit: cover; }
	.track-summary > div:last-child { display: flex; min-width: 0; flex-direction: column; }
	.track-summary strong, .track-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.track-summary strong { font-size: .78rem; }
	.track-summary small { margin-top: .12rem; color: rgb(13 26 38 / 57%); font-size: .62rem; }
	.progress-group { display: grid; grid-template-columns: 2.3rem minmax(6rem, 1fr) 2.3rem; align-items: center; gap: .45rem; color: rgb(11 28 40 / 60%); font-family: ui-monospace, monospace; font-size: .56rem; text-align: center; }
	.console-actions { display: flex; align-items: center; gap: .18rem; }
	.console-actions button { display: grid; width: 2.2rem; height: 2.2rem; padding: 0; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #142432; cursor: pointer; transition: background-color 160ms ease, transform 160ms ease; }
	.console-actions button:hover { background: rgb(255 255 255 / 34%); transform: translateY(-1px); }
	.console-actions button:focus-visible, .playlist-mobile-toggle:focus-visible, .lyrics-list button:focus-visible, .playlist-list button:focus-visible { outline: 2px solid #2be1f8; outline-offset: 2px; }
	.console-actions svg, .playlist-mobile-toggle svg { width: 1.18rem; height: 1.18rem; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
	.console-actions .play-button { width: 3.15rem; height: 3.15rem; margin-inline: .2rem; background: #f8fcff; box-shadow: 0 .18rem .5rem rgb(6 16 24 / 24%); }
	.console-actions .play-button:hover { background: white; transform: scale(1.04); }
	.play-button svg { width: 1.45rem; height: 1.45rem; fill: currentColor; stroke: none; }
	.volume-control { display: flex; align-items: center; }
	.volume-control input { width: 4.2rem; }
	input[type="range"] { height: 1.2rem; margin: 0; appearance: none; background: transparent; cursor: pointer; }
	input[type="range"]::-webkit-slider-runnable-track { height: 3px; border-radius: 999px; background: linear-gradient(to right, #26cfe8 var(--range-progress), rgb(9 23 34 / 18%) var(--range-progress)); }
	input[type="range"]::-moz-range-track { height: 3px; border: 0; border-radius: 999px; background: linear-gradient(to right, #26cfe8 var(--range-progress), rgb(9 23 34 / 18%) var(--range-progress)); }
	input[type="range"]::-webkit-slider-thumb { width: .75rem; height: .75rem; margin-top: -.28rem; appearance: none; border: 2px solid #eafcff; border-radius: 50%; background: #19cde7; }
	input[type="range"]::-moz-range-thumb { width: .65rem; height: .65rem; border: 2px solid #eafcff; border-radius: 50%; background: #19cde7; }
	.playlist-mobile-toggle, .mobile-lyric { display: none; }
	.music-error { position: absolute; z-index: 30; top: 5.3rem; left: 50%; padding: .55rem .85rem; border-radius: .45rem; background: rgb(69 20 31 / 82%); color: #ffdfe5; font-size: .72rem; transform: translateX(-50%); }
	@keyframes equalize { from { height: 22%; } to { height: 100%; } }

	@media (max-width: 1100px) {
		.lyrics-stage { left: 2rem; width: 26vw; }
		.playlist-stage { right: 1.25rem; width: 16rem; }
		.player-console { width: min(48rem, calc(100vw - 12rem)); grid-template-columns: minmax(8rem, .65fr) minmax(10rem, 1fr) auto; }
		.volume-control input, .console-actions .playlist-button { display: none; }
	}

	@media (max-width: 820px) {
		.scene-vignette { box-shadow: inset 0 0 7rem 2rem rgb(0 0 0 / 76%); }
		.lyrics-stage { display: none; }
		.playlist-mobile-toggle { position: absolute; z-index: 22; top: 5.5rem; right: 1rem; display: flex; align-items: center; gap: .35rem; padding: .52rem .72rem; border: 1px solid rgb(113 225 255 / 18%); border-radius: 999px; background: rgb(5 11 23 / 62%); color: #dffaff; font-size: .72rem; backdrop-filter: blur(12px); }
		.playlist-stage { position: fixed; z-index: 25; top: 4.8rem; right: .75rem; bottom: 7.8rem; width: min(20rem, calc(100vw - 1.5rem)); padding: .4rem; border: 1px solid rgb(115 224 255 / 12%); border-radius: .75rem; background: rgb(4 9 19 / 88%); opacity: 0; mask-image: none; pointer-events: none; transform: translateX(1rem); transition: opacity 200ms ease, transform 200ms ease; backdrop-filter: blur(18px); }
		.playlist-stage.open { opacity: 1; pointer-events: auto; transform: translateX(0); }
		.playlist-list button { color: rgb(215 233 242 / 58%); }
		.mobile-lyric { position: absolute; z-index: 12; right: 1rem; bottom: 8.2rem; left: 1rem; display: block; overflow: hidden; color: #f2fbff; font-size: .92rem; font-weight: 750; text-align: center; text-overflow: ellipsis; text-shadow: 0 0 .8rem rgb(45 225 255 / 48%); white-space: nowrap; }
		.player-console { right: 1rem; bottom: 1rem; left: 1rem; width: auto; min-height: 6.4rem; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem .6rem; padding: .55rem .7rem; transform: none; }
		.track-summary { grid-column: 1; }
		.progress-group { grid-column: 1 / -1; grid-row: 2; }
		.console-actions { grid-column: 2; grid-row: 1; }
		.console-actions > button:not(.play-button), .volume-control { display: none; }
		.console-actions .play-button { display: grid; }
	}

	@media (prefers-reduced-motion: reduce) {
		.lyrics-list button, .playlist-list button, .console-actions button, .playlist-stage { transition-duration: 0.01ms; }
		.equalizer i { animation: none; height: 55%; }
	}
</style>
