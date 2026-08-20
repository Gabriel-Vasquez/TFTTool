import { buildTeamCode } from './team-code.js';

const state = { tab: 'home', bootstrap: null, analysis: null, history: null, metadata: null, search: '', region: 'GLOBAL', weight: 50, snapshotId: null, keyPrompted: false, pollTimer: null, dataPackStatus: '', copyStatus: '', expandedCompositions: new Set(), expandedInteractions: new Set() };
const copy = {
  es: { home: 'Meta actual', homeNav: 'Meta', items: 'Objetos', champions: 'Campeones', synergies: 'Sinergias', interactions: 'Interacciones', history: 'Historial', settings: 'Ajustes', eyebrow: 'ANÁLISIS DE ÉLITE', globalRegions: 'Global · todas las regiones', update: 'Actualizar datos', establishedMeta: 'Meta establecido', performance: 'Rendimiento', noData: 'Aún no hay una instantánea de meta', noDataDetail: 'Añade tu clave de Riot Games y pulsa Actualizar datos. El análisis usa exclusivamente partidas clasificatorias recientes y datos oficiales.', configure: 'Configurar clave de Riot', observations: 'observaciones', average: 'Posición media', top4: 'Top 4', win: 'Victoria', score: 'Puntuación meta', prevalence: 'Prevalencia', variants: 'variantes', patch: 'Parche', updated: 'Actualizado', compositions: 'Composiciones', noResults: 'Sin resultados', noResultsDetail: 'No hay resultados para el filtro actual.', evidence: 'EVIDENCIA Y DESGLOSE', sourceGames: 'Partidas fuente', officialIntegration: 'INTEGRACIÓN OFICIAL', riotKey: 'Clave de Riot Games', keySafety: 'Se cifra localmente para tu cuenta de Windows. Nunca se envía fuera de Riot ni se guarda en el repositorio.', saveRefresh: 'Guardar y actualizar', closeServer: 'Cerrar TFTTool', language: 'Idioma', preferences: 'PREFERENCIAS LOCALES', searchPlaceholder: 'Buscar campeones, objetos, sinergias o interacciones', expand: 'Ver variantes', collapse: 'Ocultar variantes' },
  en: { home: 'Current meta', homeNav: 'Meta', items: 'Items', champions: 'Champions', synergies: 'Synergies', interactions: 'Team Interactions', history: 'History', settings: 'Settings', eyebrow: 'ELITE ANALYSIS', globalRegions: 'Global · all regions', update: 'Update data', establishedMeta: 'Established meta', performance: 'Performance', noData: 'No meta snapshot yet', noDataDetail: 'Add your Riot Games key and press Update data. Analysis uses only recent ranked games and official data.', configure: 'Configure Riot key', observations: 'observations', average: 'Average placement', top4: 'Top 4', win: 'Win rate', score: 'Meta score', prevalence: 'Prevalence', variants: 'variants', patch: 'Patch', updated: 'Updated', compositions: 'Compositions', noResults: 'No results', noResultsDetail: 'There are no results for the current filter.', evidence: 'EVIDENCE AND BREAKDOWN', sourceGames: 'Source games', officialIntegration: 'OFFICIAL INTEGRATION', riotKey: 'Riot Games key', keySafety: 'It is encrypted locally for your Windows account. It is never sent anywhere except Riot or stored in the repository.', saveRefresh: 'Save and update', closeServer: 'Close TFTTool', language: 'Language', preferences: 'LOCAL PREFERENCES', searchPlaceholder: 'Search champions, items, traits, or interactions', expand: 'Show variants', collapse: 'Hide variants' }
};
const $ = (selector) => document.querySelector(selector);
const MAX_VISIBLE_RESULTS = 100;
const api = async (url, options) => { const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options }); if (!response.ok && response.status !== 204) throw new Error((await response.json()).error || 'request_failed'); return response.status === 204 ? null : response.json(); };
const percent = (value) => { const percentage = (value || 0) * 100; return `${new Intl.NumberFormat(language() === 'en' ? 'en-US' : 'es-ES', { maximumFractionDigits: percentage > 0 && percentage < 1 ? 1 : 0 }).format(percentage)}%`; };
const number = { format: (value) => new Intl.NumberFormat(language() === 'en' ? 'en-US' : 'es-ES').format(value) };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function language() { return state.bootstrap?.settings?.language || 'es'; }
function text(key) { return copy[language()][key] || key; }
function scored(items) { if (!items.length) return []; const weight = state.weight / 100; const prevalence = items.map((item) => item.prevalence); const placement = items.map((item) => item.averagePlacement); const minPrevalence = Math.min(...prevalence); const maxPrevalence = Math.max(...prevalence); const minPlacement = Math.min(...placement); const maxPlacement = Math.max(...placement); const normalize = (value, minimum, maximum) => maximum <= minimum ? 0 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum))); return items.map((item) => ({ ...item, score: (normalize(item.prevalence, minPrevalence, maxPrevalence) * weight) + ((1 - normalize(item.averagePlacement, minPlacement, maxPlacement)) * (1 - weight)) })).sort((a, b) => b.score - a.score || b.prevalence - a.prevalence || a.id.localeCompare(b.id)); }
function metadata(type, id) { const source = type === 'synergies' ? 'traits' : type; const key = type === 'synergies' ? id.split(':')[0] : id; return state.metadata?.[source]?.[key] || { id, name: id, image: null }; }
function teamCodeButton(champions, compact = false) {
  const code = buildTeamCode(champions, state.metadata?.champions);
  if (!code) return '';
  const label = language() === 'es' ? 'Copiar equipo' : 'Copy team';
  return `<button class="copy-team ${compact ? 'compact' : ''}" data-copy-team="${escapeHtml(code)}" title="${language() === 'es' ? 'Copiar código para el Planificador de equipos de TFT' : 'Copy code for the TFT Team Planner'}">${label}</button>`;
}
function compositionSearchText(item) { return [compositionDisplayName(item), ...item.champions.flatMap((champion) => [metadata('champions', champion.id).name, ...champion.items.map((entry) => metadata('items', entry.id).name)])].join(' '); }
function visible(items, type = state.tab) { const query = state.search.toLocaleLowerCase(language()).trim(); return scored(items).filter((item) => !query || `${JSON.stringify(item)} ${type === 'composition' ? compositionSearchText(item) : metadata(type, item.id).name}`.toLocaleLowerCase(language()).includes(query)); }
function resultLimitNotice(shown, total) { return total > shown ? `<p class="result-limit">${language() === 'es' ? `Mostrando los primeros ${number.format(shown)} de ${number.format(total)} resultados. Usa la búsqueda para filtrar todo el conjunto.` : `Showing the first ${number.format(shown)} of ${number.format(total)} results. Use search to filter the full dataset.`}</p>` : ''; }
function icon(type, id, className = 'entity-icon', detail = '') { const meta = metadata(type, id); const tooltip = [meta.name, meta.description, detail].filter(Boolean).join(' · '); return `<span class="icon-wrap">${meta.image ? `<img class="${className}" src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.name)}" loading="lazy">` : `<span class="${className}"></span>`}<span class="tooltip" role="tooltip">${escapeHtml(tooltip)}</span></span>`; }
function championTile(champion, { core = false, showName = false, hideItems = false, itemSlots = false, contextId = null } = {}) {
  const itemSource = itemSlots ? champion.itemSlots : champion.items;
  const items = (itemSource || []).map((item) => typeof item === 'string' ? { id: item } : item).filter((item) => item?.id).slice(0, 3);
  const modal = [...(champion.stars || [{ tier: champion.tier || 1, rate: 1 }])].sort((a, b) => (b.rate || 0) - (a.rate || 0))[0]?.tier || champion.tier || 1;
  const itemNames = items.map((item) => metadata('items', item.id).name).join(', ');
  const averageItems = Number.isFinite(champion.averageItems) ? `${champion.averageItems.toFixed(2)} ${text('items').toLowerCase()}` : itemNames;
  const itemIcons = !hideItems && items.length ? `<span class="champion-items">${items.map((item) => icon('items', item.id, 'champion-item', Number.isFinite(item.prevalence) ? `${percent(item.prevalence)} · ${number.format(item.count || 0)} / ${number.format(item.sampleSize || champion.sampleSize || 0)} ${text('observations')}` : '')).join('')}</span>` : '';
  const name = showName ? `<span class="champion-name">${escapeHtml(metadata('champions', champion.id).name)}</span>` : '';
  const interaction = contextId ? ` role="button" tabindex="0" data-composition-champion="${escapeHtml(champion.id)}" data-composition-context="${escapeHtml(contextId)}"` : '';
  return `<span class="champion-tile${core ? ' core-champion' : ''}${contextId ? ' contextual-champion' : ''}"${interaction}>${icon('champions', champion.id, 'champion-portrait', [`${modal}★`, averageItems, Number.isFinite(champion.presence) ? `${percent(champion.presence)} ${language() === 'es' ? 'presencia' : 'presence'}` : ''].filter(Boolean).join(' · '))}<b class="star-level">${modal}★</b>${itemIcons}${name}</span>`;
}
function patchLabel(value) { return String(value || '').match(/\b\d+\.\d+\b/)?.[0] || value || '—'; }
function setLabel(value) { return String(value || '').match(/\d+/)?.[0] || value || '—'; }
function compositionParts(item) { return (item.traits || []).map((trait) => ({ id: trait.id, tier: trait.breakpoint, prevalence: trait.prevalence })); }
function compositionDisplayName(item) {
  const carry = item.coreChampions?.[0] ? metadata('champions', item.coreChampions[0].id).name : '';
  const traits = compositionParts(item).map((part) => `${metadata('synergies', part.id).name} ${part.tier}`.trim());
  return [carry, ...traits].filter(Boolean).join(' · ') || (language() === 'es' ? 'Arquetipo flexible' : 'Flexible archetype');
}
function placementDistribution(item) { return `<div class="placement" aria-label="1st to 8th placement distribution">${item.placementDistribution.map((rate, index) => `<span style="--rate:${Math.max(0.04, rate)}" title="#${index + 1}: ${percent(rate)}"><i></i><small>${index + 1}</small></span>`).join('')}</div>`; }
function applyChromeTranslations() {
  document.documentElement.lang = language();
  $('#tabs').setAttribute('aria-label', language() === 'es' ? 'Navegación principal' : 'Primary navigation');
  document.querySelectorAll('[data-copy]').forEach((node) => { node.textContent = text(node.dataset.copy); });
  $('#search').placeholder = text('searchPlaceholder');
  $('#language-toggle').textContent = language() === 'es' ? 'ES / EN' : 'EN / ES';
  $('.score-help').setAttribute('aria-label', language() === 'es' ? 'Cómo se calcula la puntuación' : 'How the score is calculated');
  const weighting = language() === 'es' ? `${state.weight}% prevalencia · ${100 - state.weight}% posición media` : `${state.weight}% prevalence · ${100 - state.weight}% average placement`;
  $('#weight').title = weighting;
  $('#weight').value = String(100 - state.weight);
  $('#weight-value').textContent = `${state.weight} / ${100 - state.weight}`;
  $('#score-tooltip').textContent = language() === 'es' ? `${weighting}. Ambas métricas se normalizan entre las composiciones visibles; una posición media menor es mejor. El ranking cambia al instante sin pedir datos a Riot.` : `${weighting}. Both metrics are normalized across the visible compositions; lower average placement is better. Ranking updates instantly without fetching Riot data.`;
}
function sufficiencyReason(reason) {
  const reasons = {
    sample_too_small: { es: 'Muestra insuficiente para un análisis estable.', en: 'The sample is too small for stable analysis.' },
    regional_coverage_incomplete: { es: 'Cobertura regional incompleta.', en: 'Regional coverage is incomplete.' },
    regional_sample_imbalanced: { es: 'La muestra está desequilibrada entre regiones.', en: 'The sample is imbalanced across regions.' },
    composition_diversity_low: { es: 'Diversidad de composiciones insuficiente.', en: 'Composition diversity is too low.' },
    composition_concentration_high: { es: 'La muestra parece sesgada hacia pocas composiciones.', en: 'The sample appears concentrated in too few compositions.' },
    'Muestra insuficiente para un análisis estable.': { es: 'Muestra insuficiente para un análisis estable.', en: 'The sample is too small for stable analysis.' },
    'Cobertura regional incompleta.': { es: 'Cobertura regional incompleta.', en: 'Regional coverage is incomplete.' },
    'Diversidad de composiciones insuficiente.': { es: 'Diversidad de composiciones insuficiente.', en: 'Composition diversity is too low.' },
    'La muestra parece sesgada hacia pocas composiciones.': { es: 'La muestra parece sesgada hacia pocas composiciones.', en: 'The sample appears concentrated in too few compositions.' }
  };
  return reasons[reason]?.[language()] || reason;
}
function entities(items, type) {
  const matching = visible(items, type); const filtered = matching.slice(0, MAX_VISIBLE_RESULTS);
  if (!filtered.length) return `<section class="empty"><div><h2>${text('noResults')}</h2><p>${text('noResultsDetail')}</p></div></section>`;
  return `${resultLimitNotice(filtered.length, matching.length)}<div class="list">${filtered.map((item) => { const meta = metadata(type, item.id); const imageClass = type === 'items' ? 'entity-icon item-entity-icon' : type === 'champions' ? 'entity-icon champion-entity-icon' : 'entity-icon'; return `<article class="row entity" tabindex="0" data-detail-type="${type}" data-detail-id="${escapeHtml(item.id)}"><div class="entity-title">${icon(type, item.id, imageClass, `${number.format(item.sampleSize)} ${text('observations')} · ${text('average')} ${item.averagePlacement.toFixed(2)}`)}<div class="name">${escapeHtml(meta.name || item.name || item.id)}<div class="sub">${number.format(item.sampleSize)} ${text('observations')}</div>${placementDistribution(item)}</div></div><div><span class="sub">${text('average')}</span><div class="value">${item.averagePlacement.toFixed(2)}</div></div><div><span class="sub">${text('top4')}</span><div class="value">${percent(item.top4Rate)}</div></div><div><span class="sub">${text('win')}</span><div class="value">${percent(item.winRate)}</div></div><div><span class="sub">${text('prevalence')}</span><div class="value">${percent(item.prevalence)}</div></div><div class="score" title="${text('score')}">${Math.round(item.score * 100)}</div></article>`; }).join('')}</div>`;
}
function home(snapshot) {
  if (!snapshot) return `<section class="empty"><div><div class="crest">◇</div><p class="eyebrow">${language() === 'es' ? 'TU META, CON DATOS REALES' : 'YOUR META, POWERED BY REAL DATA'}</p><h2>${text('noData')}</h2><p>${text('noDataDetail')}</p><button class="primary" data-open-key>${text('configure')}</button></div></section>`;
  const result = snapshot.result;
  const matchingCompositions = visible(result.compositions, 'composition'); const compositions = matchingCompositions.slice(0, MAX_VISIBLE_RESULTS);
  const historical = state.snapshotId ? `<div class="snapshot-notice">${language() === 'es' ? 'Viendo una instantánea histórica.' : 'Viewing a historical snapshot.'} <button data-latest>${language() === 'es' ? 'Volver a la actual' : 'Return to latest'}</button></div>` : '';
  const cards = compositions.map((item) => {
    const expanded = state.expandedCompositions.has(item.id);
    const variants = item.variantCount ?? item.variants.length;
    const flagship = item.flagship || item.variants[0];
    const flagshipBoard = (flagship?.champions || []).map((champion) => championTile(champion, { core: true, showName: true, hideItems: true, contextId: item.id })).join('');
    const coreBoard = item.coreChampions.map((champion) => championTile(champion, { core: true, showName: true, itemSlots: true, contextId: item.id })).join('');
    const metrics = `<div><span class="sub">${text('average')}</span><div class="value">${item.averagePlacement.toFixed(2)}</div></div><div><span class="sub">${text('top4')}</span><div class="value">${percent(item.top4Rate)}</div></div><div><span class="sub">${text('win')}</span><div class="value">${percent(item.winRate)}</div></div><div><span class="sub">${text('prevalence')}</span><div class="value">${percent(item.prevalence)}</div></div>`;
    return `<article class="row comp-card ${expanded ? 'expanded' : ''}"><div class="comp comp-summary" tabindex="0" role="button" data-composition-id="${escapeHtml(item.id)}" aria-expanded="${expanded}"><div class="name"><div class="comp-title"><span class="trait-strip">${compositionParts(item).map((part) => icon('synergies', part.id, 'trait-icon', `${percent(part.prevalence || 0)} ${language() === 'es' ? 'del arquetipo' : 'of archetype'}`)).join('')}</span>${escapeHtml(compositionDisplayName(item))}</div><div class="card-section-label">${language() === 'es' ? 'COMPOSICIÓN INSIGNIA' : 'FLAGSHIP LINEUP'}</div><div class="portrait-strip flagship-strip">${flagshipBoard}</div><div class="card-section-label core-label">CORE</div><div class="portrait-strip core-strip">${coreBoard}</div><div class="sub">${number.format(item.sampleSize)} ${text('observations')} · ${number.format(variants)} ${text('variants')} · <span class="expand-label">${text(expanded ? 'collapse' : 'expand')}</span><div class="bar"><i style="width:${percent(item.prevalence)}"></i></div></div>${placementDistribution(item)}</div><div class="summary-metrics">${metrics}</div><div class="score-stack"><div class="score" title="${text('score')}">${Math.round(item.score * 100)}<span class="expand-chevron">${expanded ? '▴' : '▾'}</span></div>${teamCodeButton(flagship?.champions || [])}</div></div>${expanded ? `<div class="comp-expansion">${compositionBreakdown(item)}</div>` : ''}</article>`;
  }).join('');
  return `${historical}<section class="snapshot-meta"><article class="metric"><span>${text('observations')}</span><strong>${number.format(result.observations)}</strong></article><article class="metric"><span>${text('compositions')}</span><strong>${number.format(result.compositions.length)}</strong></article><article class="metric"><span>${text('patch')}</span><strong>${escapeHtml(patchLabel(snapshot.patch))}</strong><small>Set ${escapeHtml(setLabel(snapshot.set))}</small></article><article class="metric"><span>${text('updated')}</span><strong>${new Intl.DateTimeFormat(language()).format(new Date(snapshot.createdAt))}</strong></article></section>${resultLimitNotice(compositions.length, matchingCompositions.length)}<div class="list">${cards}</div>`;
}

function interactionComposition(id) { return state.analysis?.result?.compositions.find((composition) => composition.id === id); }
function interactionDelta(value) { const formatted = Math.abs(value || 0).toLocaleString(language() === 'en' ? 'en-US' : 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return `${value > 0.005 ? '+' : value < -0.005 ? '−' : '±'}${formatted}`; }
function matchupSupport(matchup) { return matchup.supported ? `${number.format(matchup.lobbies)} ${language() === 'es' ? 'salas' : 'lobbies'}` : language() === 'es' ? 'Muestra insuficiente' : 'Insufficient sample'; }
function matchupCompact(matchup, kind) {
  const opponent = interactionComposition(matchup.opponentId) || { id: matchup.opponentId, coreChampions: [], traits: [] };
  return `<article class="matchup-mini ${kind}"><div><b>${escapeHtml(compositionDisplayName(opponent))}</b><span>${matchupSupport(matchup)}</span></div><strong>${interactionDelta(matchup.adjustedPlacementDelta)}</strong></article>`;
}
function counterItemTooltip(item, target) {
  const targetName = compositionDisplayName(target);
  const labels = language() === 'es'
    ? [`contra ${targetName}`, `posición ${item.conditionedAveragePlacement.toFixed(2)} vs base ${item.baselineAveragePlacement.toFixed(2)}`, `mejora ajustada ${interactionDelta(item.adjustedPlacementUplift)}`, `Top 4 ${percent(item.conditionedTop4Rate)} vs base ${percent(item.baselineTop4Rate)}`, `${number.format(item.lobbies)} salas · ${number.format(item.boards)} tableros`]
    : [`against ${targetName}`, `placement ${item.conditionedAveragePlacement.toFixed(2)} vs ${item.baselineAveragePlacement.toFixed(2)} baseline`, `adjusted uplift ${interactionDelta(item.adjustedPlacementUplift)}`, `Top 4 ${percent(item.conditionedTop4Rate)} vs ${percent(item.baselineTop4Rate)} baseline`, `${number.format(item.lobbies)} lobbies · ${number.format(item.boards)} boards`];
  return labels.join(' · ');
}
function interactionExpansion(entry) {
  const matchupRows = entry.matchups.map((matchup, index) => {
    const opponent = interactionComposition(matchup.opponentId) || { id: matchup.opponentId, coreChampions: [], traits: [] };
    return `<article class="interaction-table-row ${matchup.supported ? '' : 'unsupported'}"><span class="interaction-rank">${index + 1}</span><div><b>${escapeHtml(compositionDisplayName(opponent))}</b><span>${matchupSupport(matchup)}</span></div><strong class="${matchup.score >= 0 ? 'positive' : 'negative'}">${interactionDelta(matchup.adjustedPlacementDelta)}</strong><span>${language() === 'es' ? 'directo' : 'raw'} ${interactionDelta(matchup.rawPlacementDelta)}</span><span>${language() === 'es' ? 'esperado' : 'expected'} ${interactionDelta(matchup.expectedPlacementDelta)}</span><span>H2H ${percent(matchup.headToHeadRate)}</span></article>`;
  }).join('');
  const target = interactionComposition(entry.id) || { id: entry.id, coreChampions: [], traits: [] };
  const itemRows = entry.counterItems.slice(0, 20).map((item, index) => `<article class="counter-table-row"><span>${index + 1}</span>${icon('items', item.itemId, 'counter-item-icon', counterItemTooltip(item, target))}<div><b>${escapeHtml(metadata('items', item.itemId).name)}</b><span>${number.format(item.lobbies)} ${language() === 'es' ? 'salas' : 'lobbies'} · ${number.format(item.boards)} ${language() === 'es' ? 'tableros' : 'boards'}</span></div><strong>${interactionDelta(item.adjustedPlacementUplift)}</strong><span>${item.conditionedAveragePlacement.toFixed(2)} → ${item.baselineAveragePlacement.toFixed(2)}</span></article>`).join('');
  return `<section class="interaction-expansion"><div class="section-heading"><h3>${language() === 'es' ? 'Todos los enfrentamientos: mejor → peor' : 'All matchups: best → worst'}</h3><span>${number.format(entry.matchups.length)} ${language() === 'es' ? 'oponentes' : 'opponents'}</span></div><div class="interaction-table">${matchupRows}</div><div class="section-heading counter-heading"><h3>Counter Items</h3><span>${language() === 'es' ? 'Mejora contra este arquetipo frente a su contexto habitual' : 'Uplift against this archetype versus normal context'}</span></div><div class="counter-table">${itemRows}</div></section>`;
}
function interactionsView(snapshot) {
  const interactionData = snapshot?.result?.interactions;
  if (!interactionData) return `<section class="empty"><div><h2>${text('interactions')}</h2><p>${language() === 'es' ? 'Esta instantánea necesita el análisis local de interacciones.' : 'This snapshot needs local interaction analysis.'}</p></div></section>`;
  const byId = new Map(interactionData.archetypes.map((entry) => [entry.id, entry]));
  const query = state.search.toLocaleLowerCase(language()).trim();
  const ranked = scored(snapshot.result.compositions).map((composition) => ({ composition, interaction: byId.get(composition.id) })).filter(({ composition, interaction }) => interaction && (!query || `${compositionSearchText(composition)} ${interaction.counterItems.map((item) => metadata('items', item.itemId).name).join(' ')}`.toLocaleLowerCase(language()).includes(query)));
  const cards = ranked.map(({ composition, interaction }) => {
    const expanded = state.expandedInteractions.has(composition.id);
    const supported = interaction.matchups.filter((matchup) => matchup.supported).length;
    const portraits = composition.coreChampions.slice(0, 3).map((champion) => championTile(champion, { hideItems: true })).join('');
    const counters = interaction.counterItems.slice(0, 5).map((item) => icon('items', item.itemId, 'counter-item-icon', counterItemTooltip(item, composition))).join('');
    const insufficient = language() === 'es' ? 'No hay tres cruces con soporte suficiente.' : 'Fewer than three supported matchups.';
    return `<article class="interaction-card ${expanded ? 'expanded' : ''}"><button class="interaction-summary" data-interaction-id="${escapeHtml(composition.id)}" aria-expanded="${expanded}"><div class="interaction-identity"><div><h2>${escapeHtml(compositionDisplayName(composition))}</h2><span>${number.format(composition.sampleSize)} ${text('observations')} · ${number.format(supported)}/${number.format(interaction.matchups.length)} ${language() === 'es' ? 'cruces con soporte' : 'supported matchups'}</span></div><div class="interaction-core">${portraits}</div></div><section><h3>${language() === 'es' ? '3 mejores cruces' : '3 Best Matchups'}</h3><div class="matchup-compact-list">${interaction.bestMatchups.length ? interaction.bestMatchups.map((matchup) => matchupCompact(matchup, 'best')).join('') : `<p>${insufficient}</p>`}</div></section><section><h3>${language() === 'es' ? '3 peores cruces' : '3 Worst Matchups'}</h3><div class="matchup-compact-list">${interaction.worstMatchups.length ? interaction.worstMatchups.map((matchup) => matchupCompact(matchup, 'worst')).join('') : `<p>${insufficient}</p>`}</div></section><section class="counter-compact"><h3>Counter Items</h3><div class="counter-icons">${counters || `<span>${language() === 'es' ? 'Sin evidencia suficiente' : 'Insufficient evidence'}</span>`}</div></section><span class="interaction-expand">${expanded ? (language() === 'es' ? 'Ocultar análisis' : 'Hide analysis') : (language() === 'es' ? 'Ver orden completo' : 'Show full ordering')} ${expanded ? '▴' : '▾'}</span></button>${expanded ? interactionExpansion(interaction) : ''}</article>`;
  }).join('');
  return `<section class="interaction-intro"><p class="eyebrow">${language() === 'es' ? 'DATOS DE SALAS COMPARTIDAS' : 'SHARED-LOBBY EVIDENCE'}</p><p>${language() === 'es' ? 'La ventaja descuenta la fuerza base de cada arquetipo y regulariza muestras pequeñas. Un valor positivo significa que el arquetipo rinde mejor de lo esperado contra ese rival.' : 'Advantage removes each archetype’s baseline strength and regularizes small samples. A positive value means the archetype performs better than expected against that opponent.'}</p><span>${number.format(interactionData.lobbyCount)} ${language() === 'es' ? 'salas únicas' : 'unique lobbies'} · ${number.format(interactionData.participantCount)} ${language() === 'es' ? 'tableros únicos' : 'unique boards'}</span></section><div class="interaction-list">${cards}</div>`;
}
function settings() {
  const description = language() === 'es' ? 'El idioma, los datos y todo el historial se guardan localmente. Tu clave de Riot Games se protege para tu cuenta de Windows y nunca se añade al repositorio.' : 'Language, data, and all history are stored locally. Your Riot Games key is protected for your Windows account and is never added to the repository.';
  const dataDescription = language() === 'es' ? 'Comparte instantáneas y metadatos en un único archivo verificado. Las claves de Riot y tus preferencias locales nunca se incluyen.' : 'Share snapshots and metadata in one verified file. Riot keys and local preferences are never included.';
  return `<section class="settings-card"><p class="eyebrow">${text('preferences')}</p><h2>${text('settings')}</h2><p>${description}</p><label>${text('language')} <select id="language"><option value="es" ${language() === 'es' ? 'selected' : ''}>Español</option><option value="en" ${language() === 'en' ? 'selected' : ''}>English</option></select></label><div class="settings-actions"><button class="primary" data-open-key>${state.bootstrap.hasApiKey ? (language() === 'es' ? 'Actualizar clave de Riot' : 'Update Riot key') : text('configure')}</button><button class="danger" data-shutdown>${text('closeServer')}</button></div><section class="data-pack-card"><p class="eyebrow">${language() === 'es' ? 'DATOS PORTÁTILES' : 'PORTABLE DATA'}</p><h3>${language() === 'es' ? 'TFTTool Data Pack' : 'TFTTool Data Pack'}</h3><p>${dataDescription}</p><div class="settings-actions"><button class="primary" data-export-pack>${language() === 'es' ? 'Exportar datos' : 'Export data'}</button><button class="secondary" data-import-pack>${language() === 'es' ? 'Importar datos' : 'Import data'}</button><input class="hidden" id="data-pack-input" type="file" accept=".tftpack,application/vnd.tfttool.pack"></div>${state.dataPackStatus ? `<p class="data-pack-status">${escapeHtml(state.dataPackStatus)}</p>` : ''}</section><p class="legal">TFTTool isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p></section>`;
}
function signed(value, formatter = (numberValue) => numberValue.toFixed(2)) { return value ? `${value > 0 ? '+' : ''}${formatter(value)}` : '—'; }
function trendName(item) { return item ? compositionDisplayName(item.current || item.previous || item) : '—'; }
function history() {
  const snapshots = state.bootstrap.snapshots || []; const trend = state.history;
  if (!snapshots.length) return home(null);
  const changes = trend?.changes?.filter((item) => item.kind !== 'unchanged').slice(0, 12) || [];
  const labels = language() === 'es' ? { new: 'Nueva en la muestra', disappeared: 'Ya no aparece', prevalence: 'Prevalencia', placement: 'Posición', top4: 'Top 4', win: 'Victoria', browse: 'Ver', remove: 'Eliminar', deleteAll: 'Eliminar todo el historial', newer: 'Mayor subida', lower: 'Mayor caída', newCount: 'Nuevas composiciones', goneCount: 'Desaparecidas' } : { new: 'New in sample', disappeared: 'No longer present', prevalence: 'Prevalence', placement: 'Placement', top4: 'Top 4', win: 'Win', browse: 'View', remove: 'Delete', deleteAll: 'Delete all history', newer: 'Biggest rise', lower: 'Biggest fall', newCount: 'New compositions', goneCount: 'Disappeared' };
  const trendHtml = trend?.available ? `<section class="snapshot-meta"><article class="metric"><span>${labels.newCount}</span><strong>${trend.changes.filter((item) => item.kind === 'new').length}</strong></article><article class="metric"><span>${labels.goneCount}</span><strong>${trend.changes.filter((item) => item.kind === 'disappeared').length}</strong></article><article class="metric"><span>${labels.newer}</span><strong>${escapeHtml(trendName(changes.find((item) => item.rankDelta > 0)))}</strong></article><article class="metric"><span>${labels.lower}</span><strong>${escapeHtml(trendName(changes.find((item) => item.rankDelta < 0)))}</strong></article></section>${changes.length ? `<div class="list">${changes.map((item) => `<article class="row history-item ${item.current ? 'clickable' : ''}" ${item.current ? `tabindex="0" data-detail-type="composition" data-detail-id="${escapeHtml(item.id)}"` : ''}><div><div class="name">${escapeHtml(trendName(item))}</div><div class="sub">${item.kind === 'new' ? labels.new : item.kind === 'disappeared' ? labels.disappeared : `${labels.prevalence} ${signed(item.prevalenceDelta, percent)} · ${labels.placement} ${signed(item.placementDelta)} · ${labels.top4} ${signed(item.top4Delta, percent)} · ${labels.win} ${signed(item.winDelta, percent)}`}</div></div><div class="score">${item.rankDelta === null ? '—' : signed(item.rankDelta)}</div></article>`).join('')}</div>` : `<section class="snapshot-notice">${language() === 'es' ? 'Sin cambios materiales entre las dos últimas muestras.' : 'No material changes between the latest two samples.'}</section>`}` : `<section class="snapshot-notice">${language() === 'es' ? 'Crea otra instantánea para activar la comparación de tendencias.' : 'Create another snapshot to enable trend comparison.'}</section>`;
  return `${trendHtml}<div class="history-heading"><h2>${language() === 'es' ? 'Instantáneas guardadas' : 'Saved snapshots'}</h2>${snapshots.length > 1 ? `<button class="danger" data-delete-all>${labels.deleteAll}</button>` : ''}</div><div class="list">${[...snapshots].reverse().map((snapshot) => `<article class="row history-item"><div><div class="name">${new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(snapshot.createdAt))}</div><div class="sub">${number.format(snapshot.observationCount)} ${text('observations')} · ${text('patch')} ${patchLabel(snapshot.patch)} · Set ${setLabel(snapshot.set)}</div></div><div class="history-actions"><button data-snapshot="${snapshot.id}">${labels.browse}</button><button class="danger" data-delete="${snapshot.id}">${labels.remove}</button></div></article>`).join('')}</div>`;
}
function render() {
  const snapshot = state.analysis;
  const result = snapshot?.result;
  applyChromeTranslations();
  const title = text(state.tab);
  $('#page-title').textContent = title;
  document.querySelectorAll('.nav').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.tab));
  const view = state.tab === 'home' ? home(snapshot) : state.tab === 'interactions' ? interactionsView(snapshot) : state.tab === 'history' ? history() : state.tab === 'settings' ? settings() : result ? entities(result[state.tab], state.tab) : home(null);
  $('#content').innerHTML = view;
  $('#connection').textContent = snapshot ? `${number.format(snapshot.result.observations)} ${text('observations')}` : (language() === 'es' ? 'Sin datos' : 'No data');
  $('#connection').classList.toggle('live', Boolean(snapshot));
  const refresh = state.bootstrap.refresh;
  const progress = $('#progress');
  clearTimeout(state.pollTimer); state.pollTimer = null;
  if (refresh?.state === 'running') { progress.classList.remove('hidden'); const stage = refresh.stage === 'processing' ? (language() === 'es' ? 'Procesando estadísticas' : 'Processing statistics') : refresh.stage === 'saving' ? (language() === 'es' ? 'Guardando instantánea' : 'Saving snapshot') : (language() === 'es' ? 'Actualizando' : 'Updating'); progress.textContent = `${stage}… ${Object.values(refresh.regions).map((item) => `${item.region}: ${['rate_limit', 'retry'].includes(item.stage) ? `${language() === 'es' ? 'reintentando en' : 'retrying in'} ${Math.max(0, Math.ceil(((item.retryUntil || (Date.now() + item.retryIn)) - Date.now()) / 1000))} s` : `${item.observations || 0} / ${number.format(refresh.targetPerRegion || 0)} ${text('observations')} · ${item.playersScanned || 0} ${language() === 'es' ? 'jugadores' : 'players'}`}`).join(' · ') || (language() === 'es' ? 'iniciando' : 'starting')}`; state.pollTimer = setTimeout(load, 3_000); } else if (refresh?.state === 'failed') { progress.classList.remove('hidden'); progress.textContent = refresh.error === 'RIOT_API_KEY_INVALID' ? (language() === 'es' ? 'La clave de Riot no es válida o ha caducado. Sustitúyela para reanudar la actualización.' : 'The Riot key is invalid or expired. Replace it to resume the update.') : refresh.error === 'RIOT_API_FORBIDDEN' ? (language() === 'es' ? 'Riot rechazó uno de los endpoints requeridos. La clave es válida; revisa el acceso de la aplicación.' : 'Riot rejected one of the required endpoints. The key is valid; review application access.') : `${language() === 'es' ? 'La actualización no se completó' : 'Update failed'}: ${refresh.error}`; if (refresh.error === 'RIOT_API_KEY_INVALID' && !state.keyPrompted) { state.keyPrompted = true; queueMicrotask(openKey); } } else if (snapshot && !snapshot.sufficiency?.publishable) { progress.classList.remove('hidden'); progress.textContent = `${language() === 'es' ? 'Cobertura incompleta' : 'Incomplete coverage'}: ${snapshot.sufficiency?.reasons?.map(sufficiencyReason).join(' ') || (language() === 'es' ? 'muestra degradada' : 'degraded sample')}`; } else progress.classList.add('hidden');
}
async function load() { state.bootstrap = await api('/api/bootstrap'); state.bootstrap.snapshots = await api('/api/snapshots'); const snapshot = state.snapshotId ? `&snapshot=${encodeURIComponent(state.snapshotId)}` : ''; state.analysis = await api(`/api/analysis?region=${encodeURIComponent(state.region)}${snapshot}`); state.history = await api('/api/history'); state.metadata = null; if (state.analysis) { try { state.metadata = await api(`/api/metadata?patch=${encodeURIComponent(state.analysis.patch || '')}&locale=${language() === 'en' ? 'en_US' : 'es_ES'}`); } catch {} } render(); }
function openKey() { $('#key-dialog').showModal(); }

function exportDataPack() {
  const link = document.createElement('a');
  link.href = '/api/data-pack/export';
  link.download = `TFTTool-${new Date().toISOString().slice(0, 10)}.tftpack`;
  document.body.append(link); link.click(); link.remove();
  state.dataPackStatus = language() === 'es' ? 'Exportación iniciada. El archivo no contiene claves ni preferencias privadas.' : 'Export started. The file contains no keys or private preferences.';
  render();
}

async function importDataPack(file) {
  state.dataPackStatus = language() === 'es' ? 'Validando e importando…' : 'Validating and importing…'; render();
  try {
    const response = await fetch('/api/data-pack/import', { method: 'POST', headers: { 'content-type': 'application/vnd.tfttool.pack' }, body: file });
    if (!response.ok) throw new Error((await response.json()).error || 'DATA_PACK_IMPORT_FAILED');
    const imported = await response.json();
    state.snapshotId = null; state.expandedCompositions.clear(); state.expandedInteractions.clear();
    state.dataPackStatus = language() === 'es' ? `Importación completa: ${number.format(imported.observations)} observaciones disponibles sin conexión.` : `Import complete: ${number.format(imported.observations)} observations available offline.`;
    await load();
  } catch (error) {
    state.dataPackStatus = `${language() === 'es' ? 'No se importó ningún dato' : 'No data was imported'}: ${error.message}`;
    render();
  }
}

async function copyTeamCode(button) {
  const code = button.dataset.copyTeam;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
    else {
      const input = document.createElement('textarea');
      input.value = code; input.setAttribute('readonly', ''); input.className = 'clipboard-fallback';
      document.body.append(input); input.select();
      const copied = document.execCommand('copy'); input.remove();
      if (!copied) throw new Error('CLIPBOARD_UNAVAILABLE');
    }
    button.textContent = language() === 'es' ? 'Copiado' : 'Copied';
    button.classList.add('copied');
    setTimeout(() => { if (button.isConnected) { button.textContent = language() === 'es' ? 'Copiar equipo' : 'Copy team'; button.classList.remove('copied'); } }, 1600);
  } catch {
    button.textContent = language() === 'es' ? 'No se pudo copiar' : 'Copy failed';
  }
}

function count(values) { const result = new Map(); values.forEach((value) => result.set(value, (result.get(value) || 0) + 1)); return [...result.entries()].sort((a, b) => b[1] - a[1]); }
function compositionForObservation(sample) { return state.analysis.result.compositions.find((item) => item.id === sample.compositionId); }
function rankedContext(title, entries, type) { if (!entries.length) return ''; return `<section class="detail-section"><h3>${title}</h3><div class="context-list">${entries.slice(0, 8).map(([id, total]) => `<span>${type === 'composition' ? escapeHtml(compositionDisplayName(state.analysis.result.compositions.find((item) => item.id === id) || { id })) : type === 'plain' ? escapeHtml(id) : `${icon(type, id, 'portrait')} ${escapeHtml(metadata(type, id).name)}`} <b>${total}</b></span>`).join('')}</div></section>`; }
function contextualBreakdown(type, id, evidence) {
  const compositionCounts = count(evidence.map((sample) => compositionForObservation(sample)?.id).filter(Boolean));
  if (type === 'items') { const champions = count(evidence.flatMap((sample) => sample.units.filter((unit) => unit.items.includes(id)).map((unit) => unit.id))); return rankedContext(language() === 'es' ? 'Campeones que lo equipan' : 'Champions using it', champions, 'champions') + rankedContext(language() === 'es' ? 'Mejores composiciones' : 'Best compositions', compositionCounts, 'composition'); }
  if (type === 'champions') { const units = evidence.flatMap((sample) => sample.units.filter((unit) => unit.id === id)); return rankedContext(language() === 'es' ? 'Objetos más usados' : 'Most used items', count(units.flatMap((unit) => unit.items)), 'items') + rankedContext(language() === 'es' ? 'Mejores composiciones' : 'Best compositions', compositionCounts, 'composition') + rankedContext(language() === 'es' ? 'Niveles de estrella' : 'Star levels', count(units.map((unit) => `${unit.tier}★`)), 'plain'); }
  if (type === 'synergies') return rankedContext(language() === 'es' ? 'Campeones frecuentes' : 'Frequent champions', count(evidence.flatMap((sample) => sample.units.map((unit) => unit.id))), 'champions') + rankedContext(language() === 'es' ? 'Composiciones' : 'Compositions', compositionCounts, 'composition') + rankedContext(language() === 'es' ? 'Objetos frecuentes' : 'Frequent items', count(evidence.flatMap((sample) => sample.units.flatMap((unit) => unit.items))), 'items');
  return '';
}
function variantDiff(flagship, variant) {
  const flagshipIds = new Set(flagship.champions.map((champion) => champion.id));
  const variantIds = new Set(variant.champions.map((champion) => champion.id));
  return {
    removed: flagship.champions.filter((champion) => !variantIds.has(champion.id)),
    added: variant.champions.filter((champion) => !flagshipIds.has(champion.id))
  };
}
function diffChampion(champion) {
  return `<span class="diff-unit">${championTile(champion, { hideItems: true })}<small>${escapeHtml(metadata('champions', champion.id).name)}</small></span>`;
}
function compositionBreakdown(entity) {
  const [flagship, ...alternatives] = entity.variants;
  const flagshipRow = flagship ? `<article class="variant flagship"><div class="variant-copy"><b>${language() === 'es' ? 'Composición insignia' : 'Flagship lineup'}</b><span>${number.format(flagship.sampleSize)} ${text('observations')} · ${percent(flagship.prevalence)}</span>${teamCodeButton(flagship.champions, true)}</div><div class="board">${flagship.champions.map((champion) => championTile(champion, { hideItems: true })).join('')}</div></article>` : '';
  const diffRows = alternatives.map((variant, index) => {
    const diff = variantDiff(flagship, variant);
    const removed = diff.removed.length ? diff.removed.map(diffChampion).join('') : `<span class="unchanged">${language() === 'es' ? 'Sin bajas' : 'No removals'}</span>`;
    const added = diff.added.length ? diff.added.map(diffChampion).join('') : `<span class="unchanged">${language() === 'es' ? 'Sin altas' : 'No additions'}</span>`;
    return `<article class="variant variant-diff"><div class="variant-copy"><b>${language() === 'es' ? 'Variante' : 'Variant'} ${index + 2}</b><span>${number.format(variant.sampleSize)} ${text('observations')} · ${percent(variant.prevalence)}</span>${teamCodeButton(variant.champions, true)}</div><div class="diff-board"><div class="diff-group removed"><strong>− ${language() === 'es' ? 'Quitar' : 'Remove'}</strong><div class="board">${removed}</div></div><div class="diff-arrow" aria-hidden="true">→</div><div class="diff-group added"><strong>+ ${language() === 'es' ? 'Añadir' : 'Add'}</strong><div class="board">${added}</div></div></div></article>`;
  }).join('');
  const variants = `<section class="inline-section"><div class="section-heading"><h3>${language() === 'es' ? 'Variantes por cambios' : 'Variants by changes'}</h3><span>${number.format(entity.variants.length)} / ${number.format(entity.variantCount ?? entity.variants.length)}</span></div><div class="variant-list">${flagshipRow}${diffRows}</div></section>`;
  const champions = `<section class="inline-section champion-analysis"><div class="section-heading"><h3>${language() === 'es' ? 'Análisis de campeones' : 'Champion analysis'}</h3><span>${language() === 'es' ? 'Dentro de este arquetipo' : 'Inside this archetype'}</span></div><div class="detail-grid">${entity.champions.slice(0, 10).map((champion) => `<article class="detail-card contextual-detail" role="button" tabindex="0" data-composition-champion="${escapeHtml(champion.id)}" data-composition-context="${escapeHtml(entity.id)}">${championTile(champion, { hideItems: true })}<div class="name">${escapeHtml(metadata('champions', champion.id).name)}</div><div class="sub">${percent(champion.presence)} ${language() === 'es' ? 'presencia' : 'presence'} · ${champion.averageItems.toFixed(2)} ${text('items').toLowerCase()} · ${text('average')} ${champion.averagePlacement.toFixed(2)} · ${text('top4')} ${percent(champion.top4Rate)} · ${text('win')} ${percent(champion.winRate)}</div><div class="star-summary">${champion.stars.map((star) => `<span>${star.tier}★ ${percent(star.rate)}</span>`).join('')}</div><div class="board item-board">${champion.items.slice(0, 6).map((item) => icon('items', item.id, 'item-detail-icon', `${percent(item.prevalence)} · ${number.format(item.count)} / ${number.format(item.sampleSize)} ${text('observations')}`)).join('')}</div></article>`).join('')}</div></section>`;
  return champions + variants;
}

function itemPatternRow(pattern) {
  return `<article class="loadout-row"><div class="board">${pattern.items.map((id) => icon('items', id, 'item-detail-icon', metadata('items', id).name)).join('')}</div><span>${percent(pattern.prevalence)} · ${number.format(pattern.count)} / ${number.format(pattern.sampleSize)} ${text('observations')}</span></article>`;
}

async function openCompositionChampion(compositionId, championId) {
  const composition = state.analysis.result.compositions.find((item) => item.id === compositionId);
  const champion = composition?.champions.find((item) => item.id === championId);
  if (!composition || !champion) return;
  const snapshot = state.snapshotId ? `&snapshot=${encodeURIComponent(state.snapshotId)}` : '';
  const evidence = await api(`/api/evidence?type=composition-champion&id=${encodeURIComponent(championId)}&composition=${encodeURIComponent(compositionId)}&region=${encodeURIComponent(state.region)}${snapshot}`);
  const championMeta = metadata('champions', championId);
  const metrics = `<section class="detail-metrics"><span>${number.format(champion.sampleSize)} ${text('observations')}</span><span>${percent(champion.presence)} ${language() === 'es' ? 'presencia' : 'presence'}</span><span>${text('average')} <b>${champion.averagePlacement.toFixed(2)}</b></span><span>${text('top4')} <b>${percent(champion.top4Rate)}</b></span><span>${text('win')} <b>${percent(champion.winRate)}</b></span><span>${champion.averageItems.toFixed(2)} ${language() === 'es' ? 'objetos finales' : 'final items'}</span></section>`;
  const stars = `<section class="detail-section"><h3>${language() === 'es' ? 'Distribución de estrellas' : 'Star distribution'}</h3><div class="star-summary prominent">${champion.stars.map((star) => `<span>${star.tier}★ <b>${percent(star.rate)}</b></span>`).join('')}</div></section>`;
  const slots = `<section class="detail-section"><h3>${language() === 'es' ? 'Tres slots representativos' : 'Three representative slots'}</h3><p class="sub">${language() === 'es' ? 'La multiplicidad se conserva: un objeto puede aparecer dos o tres veces si los datos lo respaldan.' : 'Multiplicity is preserved: an item can appear twice or three times when supported by the data.'}</p><div class="item-analysis-grid">${champion.itemSlots.map((item) => `<article>${icon('items', item.id, 'item-detail-icon', `${percent(item.prevalence)} · ${number.format(item.count)} / ${number.format(item.sampleSize)}`)}<div><b>${escapeHtml(metadata('items', item.id).name)}</b><span>slot ${item.copy} · ${percent(item.prevalence)}</span></div></article>`).join('')}</div></section>`;
  const individualItems = `<section class="detail-section"><h3>${language() === 'es' ? 'Todos los objetos dentro de la composición' : 'All items inside the composition'}</h3><div class="item-analysis-grid">${champion.items.map((item) => `<article>${icon('items', item.id, 'item-detail-icon', `${percent(item.prevalence)} · ${number.format(item.count)} / ${number.format(item.sampleSize)}`)}<div><b>${escapeHtml(metadata('items', item.id).name)}</b><span>${percent(item.prevalence)} · ${number.format(item.count)} / ${number.format(item.sampleSize)}</span></div></article>`).join('')}</div></section>`;
  const combinations = champion.combinations.length ? `<section class="detail-section"><h3>${language() === 'es' ? 'Combinaciones frecuentes de 2' : 'Common 2-item combinations'}</h3><div class="loadout-list">${champion.combinations.map(itemPatternRow).join('')}</div></section>` : '';
  const loadouts = champion.loadouts.length ? `<section class="detail-section"><h3>${language() === 'es' ? 'Loadouts finales frecuentes' : 'Common final loadouts'}</h3><div class="loadout-list">${champion.loadouts.map(itemPatternRow).join('')}</div></section>` : '';
  const source = `<section class="detail-section"><h3>${text('sourceGames')} (${number.format(Math.min(evidence.length, 12))})</h3>${evidence.slice(0, 12).map((sample) => { const unit = sample.units.find((entry) => entry.id === championId); return `<article class="evidence"><div class="name">${escapeHtml(sample.playerName || '—')} · ${escapeHtml(sample.region)} · #${sample.placement}</div><div class="board">${unit ? championTile(unit) : ''}</div></article>`; }).join('')}</section>`;
  $('#detail-body').innerHTML = `<div class="champion-modal-heading">${championTile(champion, { core: true, hideItems: true })}<div><p class="eyebrow">${language() === 'es' ? 'CAMPEÓN EN COMPOSICIÓN' : 'CHAMPION IN COMPOSITION'}</p><h2>${escapeHtml(championMeta.name || championId)}</h2><p>${escapeHtml(compositionDisplayName(composition))}</p></div></div>${metrics}${placementDistribution(champion)}${stars}${slots}${individualItems}${combinations}${loadouts}${source}`;
  $('#detail-dialog').showModal();
}

async function openDetails(type, id) {
  const snapshot = state.snapshotId ? `&snapshot=${encodeURIComponent(state.snapshotId)}` : '';
  const evidence = await api(`/api/evidence?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&region=${encodeURIComponent(state.region)}${snapshot}`);
  const source = state.analysis.result[type];
  const entity = source.find((item) => item.id === id);
  const meta = metadata(type, id);
  if (!entity) return;
  const summary = `<section class="detail-metrics"><span>${number.format(entity.sampleSize)} ${text('observations')}</span><span>${text('average')} <b>${entity.averagePlacement.toFixed(2)}</b></span><span>${text('top4')} <b>${percent(entity.top4Rate)}</b></span><span>${text('win')} <b>${percent(entity.winRate)}</b></span></section>${placementDistribution(entity)}`;
  const breakdown = contextualBreakdown(type, id, evidence);
  const evidenceDisclosure = entity.sampleSize > evidence.length ? `<p class="sub">${language() === 'es' ? `Mostrando las ${number.format(evidence.length)} partidas más recientes de ${number.format(entity.sampleSize)} observaciones.` : `Showing the ${number.format(evidence.length)} most recent games from ${number.format(entity.sampleSize)} observations.`}</p>` : '';
  $('#detail-body').innerHTML = `<p class="eyebrow">${text('evidence')}</p><h2>${escapeHtml(meta.name || id)}</h2>${summary}${breakdown}<section class="detail-section"><h3>${text('sourceGames')} (${number.format(evidence.length)})</h3>${evidenceDisclosure}${evidence.map((sample) => `<article class="evidence"><div class="name">${escapeHtml(sample.playerName || '—')} · ${escapeHtml(sample.region)} · #${sample.placement} · ${new Intl.DateTimeFormat(language(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sample.recordedAt))}</div><div class="sub">${escapeHtml(sample.matchId || '')}</div><div class="board">${sample.units.map(championTile).join('')}</div></article>`).join('') || `<p>${text('noResultsDetail')}</p>`}</section>`;
  $('#detail-dialog').showModal();
}

document.querySelector('.sidebar').addEventListener('click', (event) => { const button = event.target.closest('[data-tab]'); if (!button) return; state.tab = button.dataset.tab; render(); });
$('#search').addEventListener('input', (event) => { state.search = event.target.value; render(); });
$('#weight').addEventListener('input', (event) => { state.weight = 100 - Number(event.target.value); $('#weight-value').textContent = `${state.weight} / ${100 - state.weight}`; render(); });
$('#language-toggle').addEventListener('click', async () => { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ language: language() === 'es' ? 'en' : 'es' }) }); await load(); });
$('#region-filter').addEventListener('change', async (event) => { state.region = event.target.value; state.expandedCompositions.clear(); state.expandedInteractions.clear(); await load(); });
$('#update').addEventListener('click', async () => { if (!state.bootstrap.hasApiKey) return openKey(); state.snapshotId = null; await api('/api/refresh', { method: 'POST' }); await load(); });
$('#content').addEventListener('click', async (event) => {
  if (event.target.closest('[data-open-key]')) return openKey();
  const copyTeam = event.target.closest('[data-copy-team]'); if (copyTeam) return copyTeamCode(copyTeam);
  if (event.target.closest('[data-export-pack]')) return exportDataPack();
  if (event.target.closest('[data-import-pack]')) return $('#data-pack-input')?.click();
  if (event.target.closest('[data-latest]')) { state.snapshotId = null; state.tab = 'home'; return load(); }
  const snapshot = event.target.closest('[data-snapshot]'); if (snapshot) { state.snapshotId = snapshot.dataset.snapshot; state.tab = 'home'; return load(); }
  const contextualChampion = event.target.closest('[data-composition-champion]'); if (contextualChampion) return openCompositionChampion(contextualChampion.dataset.compositionContext, contextualChampion.dataset.compositionChampion);
  const interaction = event.target.closest('[data-interaction-id]'); if (interaction) { const id = interaction.dataset.interactionId; if (state.expandedInteractions.has(id)) state.expandedInteractions.delete(id); else state.expandedInteractions.add(id); return render(); }
  const composition = event.target.closest('[data-composition-id]'); if (composition) { const id = composition.dataset.compositionId; if (state.expandedCompositions.has(id)) state.expandedCompositions.delete(id); else state.expandedCompositions.add(id); return render(); }
  const detail = event.target.closest('[data-detail-type]'); if (detail) return openDetails(detail.dataset.detailType, detail.dataset.detailId);
  const id = event.target.dataset.delete; if (id && confirm(language() === 'es' ? '¿Eliminar esta instantánea? Esta acción no se puede deshacer.' : 'Delete this snapshot? This cannot be undone.')) { await api(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (state.snapshotId === id) state.snapshotId = null; return load(); }
  if (event.target.closest('[data-delete-all]') && confirm(language() === 'es' ? '¿Eliminar TODO el historial? Esta acción no se puede deshacer.' : 'Delete ALL history? This cannot be undone.')) { await api('/api/snapshots', { method: 'DELETE' }); state.snapshotId = null; return load(); }
  if (event.target.closest('[data-shutdown]') && confirm(language() === 'es' ? '¿Cerrar TFTTool y detener su servidor local?' : 'Close TFTTool and stop its local server?')) { await api('/api/shutdown', { method: 'POST' }); $('#content').innerHTML = `<section class="empty"><div><h2>${language() === 'es' ? 'TFTTool cerrado' : 'TFTTool closed'}</h2><p>${language() === 'es' ? 'Ya puedes cerrar esta pestaña.' : 'You can now close this tab.'}</p></div></section>`; }
});
$('#content').addEventListener('keydown', (event) => { if (!['Enter', ' '].includes(event.key)) return; if (event.target.matches('[data-composition-champion]')) { event.preventDefault(); void openCompositionChampion(event.target.dataset.compositionContext, event.target.dataset.compositionChampion); } else if (event.target.matches('[data-interaction-id], [data-composition-id], [data-detail-type]')) { event.preventDefault(); event.target.click(); } });
$('#detail-dialog').addEventListener('click', (event) => { if (event.target.closest('[data-close-detail]')) $('#detail-dialog').close(); });
$('#content').addEventListener('change', async (event) => { if (event.target.id === 'language') { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ language: event.target.value }) }); await load(); } else if (event.target.id === 'data-pack-input' && event.target.files?.[0]) await importDataPack(event.target.files[0]); });
$('#key-form').addEventListener('submit', async (event) => { if (event.submitter?.value !== 'save') return; event.preventDefault(); const error = $('#key-error'); error.classList.add('hidden'); try { await api('/api/settings/riot-key', { method: 'PUT', body: JSON.stringify({ key: $('#riot-key').value }) }); $('#riot-key').value = ''; $('#key-dialog').close(); state.keyPrompted = false; state.snapshotId = null; await api('/api/refresh', { method: 'POST' }); await load(); } catch (cause) { error.textContent = `${language() === 'es' ? 'No se pudo guardar la clave' : 'Could not save the key'}: ${cause.message}`; error.classList.remove('hidden'); } });
load().catch((error) => { $('#content').innerHTML = `<section class="empty"><div><h2>${language() === 'es' ? 'Error local' : 'Local error'}</h2><p>${escapeHtml(error.message)}</p></div></section>`; });
