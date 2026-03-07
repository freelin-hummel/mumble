import { appHighlights, desktopScreens } from './features.js';

const appRoot = document.querySelector('#app');
const state = {
	search: '',
	route: getRoute()
};

const platformInfo = window.mumbleDesktop?.platform ?? 'browser';

function getRoute() {
	const hash = window.location.hash.replace(/^#/, '');
	return hash || '/';
}

function setRoute(route) {
	window.location.hash = route;
}

function getVisibleScreens() {
	const term = state.search.trim().toLowerCase();
	if (!term) {
		return desktopScreens;
	}

	return desktopScreens.filter((screen) => {
		return [
			screen.title,
			screen.group,
			screen.summary,
			screen.sourceUi ?? '',
			...screen.stubActions,
			...screen.surfaces
		].some((value) => value.toLowerCase().includes(term));
	});
}

function findScreenById(screenId) {
	return desktopScreens.find((screen) => screen.id === screenId);
}

function renderOverview() {
	const groups = groupScreens(desktopScreens);
	const representedForms = desktopScreens.filter((screen) => screen.sourceUi !== null).length;
	const stubActionCount = desktopScreens.reduce((count, screen) => count + screen.stubActions.length, 0);

	return `
		<section class="hero card">
			<div>
				<p class="eyebrow">Experimental client bootstrap</p>
				<h1>Mumble Web Client</h1>
				<p class="lede">A sleek, minimal web shell that mirrors the native Mumble UI surface area with implementation stubs.</p>
			</div>
			<div class="hero-actions">
				<button class="primary-action" data-route="/screen/main-window">Open workspace stub</button>
				<button class="secondary-action" data-route="/screen/connect-dialog">Review connect flow</button>
			</div>
		</section>
		<section class="stats-grid">
			<article class="stat card">
				<span class="stat-value">${desktopScreens.length}</span>
				<span class="stat-label">navigable screens</span>
			</article>
			<article class="stat card">
				<span class="stat-value">${representedForms}</span>
				<span class="stat-label">Qt forms mirrored</span>
			</article>
			<article class="stat card">
				<span class="stat-value">${Object.keys(groups).length}</span>
				<span class="stat-label">feature groups</span>
			</article>
			<article class="stat card">
				<span class="stat-value">${stubActionCount}</span>
				<span class="stat-label">stub workflows</span>
			</article>
		</section>
		<section class="card">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Coverage</p>
					<h2>Feature parity plan</h2>
				</div>
				<p class="section-copy">Every screen below is routable today, with implementation intentionally stubbed while UX and information architecture are refined.</p>
			</div>
			<div class="highlight-grid">
				${appHighlights.map((highlight) => `
					<article class="highlight-panel">
						<h3>${highlight.title}</h3>
						<p>${highlight.description}</p>
					</article>
				`).join('')}
			</div>
		</section>
		<section class="card">
			<div class="section-heading">
				<div>
					<p class="eyebrow">Groups</p>
					<h2>Stubbed journeys</h2>
				</div>
				<p class="section-copy">The navigation models the current desktop experience, but modernized for a responsive web shell.</p>
			</div>
			<div class="group-grid">
				${Object.entries(groups).map(([groupName, screens]) => `
					<article class="group-card">
						<div class="group-header">
							<h3>${groupName}</h3>
							<span>${screens.length} screens</span>
						</div>
						<ul class="group-list">
							${screens.slice(0, 4).map((screen) => `
								<li><button class="link-button" data-route="/screen/${screen.id}">${screen.title}</button></li>
							`).join('')}
						</ul>
					</article>
				`).join('')}
			</div>
		</section>
	`;
}

function renderScreen(screen) {
	const groupScreens = desktopScreens.filter((item) => item.group === screen.group);
	const currentIndex = groupScreens.findIndex((item) => item.id === screen.id);
	const nextScreen = groupScreens[(currentIndex + 1) % groupScreens.length];

	return `
		<section class="card detail-hero">
			<div class="detail-heading">
				<div>
					<p class="eyebrow">${screen.group}</p>
					<h1>${screen.title}</h1>
					<p class="lede">${screen.summary}</p>
				</div>
				<div class="badge-stack">
					<span class="status-badge">Stub</span>
					<span class="source-badge">${screen.sourceUi ?? 'Native code surface'}</span>
				</div>
			</div>
			<div class="hero-actions">
				<button class="primary-action" data-route="/screen/${nextScreen.id}">Next ${screen.group} screen</button>
				<button class="secondary-action" data-route="/">Back to overview</button>
			</div>
		</section>
		<section class="detail-grid">
			<article class="card">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Stub workflow</p>
						<h2>Primary actions</h2>
					</div>
				</div>
				<ol class="step-list">
					${screen.stubActions.map((action, index) => `
						<li>
							<span>${index + 1}</span>
							<div>
								<strong>${action}</strong>
								<p>Not yet wired to backend services.</p>
							</div>
						</li>
					`).join('')}
				</ol>
			</article>
			<article class="card">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Surface inventory</p>
						<h2>Layout modules</h2>
					</div>
				</div>
				<div class="chip-grid">
					${screen.surfaces.map((surface) => `<span class="chip">${surface}</span>`).join('')}
				</div>
			</article>
			<article class="card span-two">
				<div class="section-heading">
					<div>
						<p class="eyebrow">Preview</p>
						<h2>Modernized shell</h2>
					</div>
					<p class="section-copy">This keeps the native feature set visible while we iterate on actual web implementations.</p>
				</div>
				<div class="mock-grid">
					${screen.surfaces.map((surface) => `
						<section class="mock-panel">
							<header>
								<h3>${surface}</h3>
								<span class="panel-state">stub</span>
							</header>
							<p>${screen.summary}</p>
							<div class="panel-actions">
								<button disabled>Preview</button>
								<button disabled>Connect</button>
							</div>
						</section>
					`).join('')}
				</div>
			</article>
		</section>
	`;
}

function renderNotFound() {
	return `
		<section class="card empty-state">
			<p class="eyebrow">Unknown route</p>
			<h1>Screen not found</h1>
			<p class="lede">The requested stub does not exist yet. Return to the overview and choose a valid screen.</p>
			<button class="primary-action" data-route="/">Return home</button>
		</section>
	`;
}

function groupScreens(screens) {
	return screens.reduce((groups, screen) => {
		if (!groups[screen.group]) {
			groups[screen.group] = [];
		}

		groups[screen.group].push(screen);
		return groups;
	}, {});
}

function renderSidebar(visibleScreens) {
	const grouped = groupScreens(visibleScreens);

	return `
		<aside class="sidebar">
			<div class="brand card">
				<p class="eyebrow">Mumble</p>
				<h2>Web Client</h2>
				<p class="section-copy">Browser-first shell for the full native UI map.</p>
			</div>
			<label class="search card">
				<span>Search screens</span>
				<input id="screen-search" type="search" value="${state.search}" placeholder="Audio, ACL, overlay..." autocomplete="off">
			</label>
			<nav class="nav card" aria-label="Mumble web client navigation">
				<button class="nav-overview${state.route === '/' ? ' active' : ''}" data-route="/">Overview</button>
				${Object.entries(grouped).map(([groupName, screens]) => `
					<section class="nav-group">
						<p>${groupName}</p>
						${screens.map((screen) => `
							<button class="nav-link${state.route === `/screen/${screen.id}` ? ' active' : ''}" data-route="/screen/${screen.id}">
								<span>${screen.title}</span>
								<small>${screen.sourceUi ?? 'native'}</small>
							</button>
						`).join('')}
					</section>
				`).join('')}
			</nav>
			<section class="card runtime-card">
				<p class="eyebrow">Runtime</p>
				<h3>${platformInfo}</h3>
				<ul>
					<li>Hash routing for browser + Electron</li>
					<li>Electron preload with isolated bridge</li>
					<li>Build scripts for web and desktop packaging</li>
				</ul>
			</section>
		</aside>
	`;
}

function render() {
	const visibleScreens = getVisibleScreens();
	const routeParts = state.route.split('/').filter(Boolean);
	const screen = routeParts[0] === 'screen' ? findScreenById(routeParts[1]) : null;
	const content = state.route === '/'
		? renderOverview()
		: screen
			? renderScreen(screen)
			: renderNotFound();

	appRoot.innerHTML = `
		<div class="shell">
			${renderSidebar(visibleScreens)}
			<main class="content">
				<header class="topbar card">
					<div>
						<p class="eyebrow">Experimental parity shell</p>
						<h1>${screen ? screen.title : 'Overview'}</h1>
					</div>
					<div class="topbar-actions">
						<button class="secondary-action" data-route="/screen/config-dialog">Open settings</button>
						<button class="secondary-action" data-route="/screen/plugin-config">Open plugins</button>
					</div>
				</header>
				${content}
			</main>
		</div>
	`;

	const searchInput = document.querySelector('#screen-search');
	if (searchInput) {
		searchInput.addEventListener('input', (event) => {
			state.search = event.target.value;
			render();
		});
	}

	document.querySelectorAll('[data-route]').forEach((element) => {
		element.addEventListener('click', () => {
			setRoute(element.getAttribute('data-route'));
		});
	});
}

window.addEventListener('hashchange', () => {
	state.route = getRoute();
	render();
});

render();
