/**
 * Tarjetas del plan del cliente. El backend envía { cards: PlanCard[] } y aquí
 * se pinta cada una según su `type`. Añadir un tipo nuevo = añadir una función
 * al mapa RENDERERS.
 */
import { html, raw, fmt } from "../../ui/dom.js";

const FORMATS = {
  money: fmt.money,
  money_k: fmt.moneyCompact,
  number: fmt.number,
  percent: fmt.percent,
};
const formatValue = (item) => (item.value == null ? "" : (FORMATS[item.format] || String)(item.value));

/* ---------- type: list ---------- */
function listCard(c) {
  return html`
    <article class="card plan-card plan-card--list">
      <h3 class="plan-card__title">${c.title}</h3>
      <ul class="plan-card__items">
        ${(c.items || []).map((it) => html`<li>${it.label}${it.value != null ? `: ${formatValue(it)}` : ""}</li>`)}
      </ul>
    </article>`;
}

/* ---------- type: goal / kind: trajectory ---------- */
function trajectorySvg(progress = 0, series) {
  const W = 220, H = 90, pad = 4;
  const p = Math.min(Math.max(progress, 0), 1);
  const xEnd = pad + (W - pad * 2) * Math.max(p, 0.05);
  // Si no hay serie, curva suave de crecimiento hasta el progreso actual.
  const values = series?.length > 1 ? series : Array.from({ length: 8 }, (_, i) => p * (i / 7) ** 1.4);
  const pts = values.map((v, i) => [pad + (xEnd - pad) * (i / (values.length - 1)), H - pad - v * (H - pad * 2)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return `
    <svg class="trajectory" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Progreso ${Math.round(p * 100)}%">
      <rect x="${lx}" y="${pad}" width="${W - pad - lx}" height="${H - pad * 2}" class="trajectory__rest"/>
      <path d="${line} L${lx},${H - pad} L${pad},${H - pad} Z" class="trajectory__area"/>
      <path d="${line}" class="trajectory__line"/>
      <path d="M${lx},${ly} L${W - pad - 2},${pad + 4}" class="trajectory__future"/>
      <path d="M${W - pad - 12},${pad + 2} L${W - pad - 2},${pad + 4} L${W - pad - 6},${pad + 14}" class="trajectory__future"/>
      <circle cx="${lx}" cy="${ly}" r="5" class="trajectory__dot"/>
    </svg>`;
}
function trajectoryCard(c) {
  return html`
    <article class="card plan-card plan-card--goal">
      <h3 class="plan-card__title plan-card__title--sm">${c.title}</h3>
      <div class="plan-card__viz">${raw(trajectorySvg(c.progress, c.series))}</div>
      ${c.caption ? raw(html`<p class="plan-card__caption">${c.caption}</p>`) : ""}
    </article>`;
}

/* ---------- type: goal / kind: progress ---------- */
function progressCard(c) {
  const pct = Math.round(Math.min(Math.max(c.progress || 0, 0), 1) * 100);
  return html`
    <article class="card plan-card plan-card--goal">
      <h3 class="plan-card__title plan-card__title--sm">${c.title}</h3>
      <div class="goal-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="goal-bar__fill" style="width:${pct}%"></div>
        <span class="goal-bar__label">${c.valueLabel || `${pct}%`}</span>
      </div>
      ${c.caption ? raw(html`<p class="plan-card__caption">${c.caption}</p>`) : ""}
    </article>`;
}

const RENDERERS = {
  list: listCard,
  goal: (c) => (c.kind === "progress" ? progressCard(c) : trajectoryCard(c)),
};

export function planCard(card) {
  const render = RENDERERS[card.type];
  if (!render) {
    console.warn("[plan] Tipo de tarjeta desconocido:", card.type, card);
    return "";
  }
  return render(card);
}
