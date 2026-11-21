/**
 * CONSULTOR · INICIO  (maqueta: UI_mock/profile_consultor/inicio.jpeg)
 * KPIs + filtros por categoría + Feed de Alertas.
 * Endpoints: GET /consultant/dashboard, GET /alerts/categories, GET /alerts
 */
import { consultorApi } from "../../api/endpoints.js";
import { html, raw, fmt, escapeHtml, on } from "../../ui/dom.js";
import { kpiCard, mountAsync, skeleton, openModal, withLoading } from "../../ui/components.js";
import { mountAlertFeed } from "./_alert-feed.js";

export default {
  title: "Inicio",
  async render(el, { navigate }) {
    el.innerHTML = html`
      <div class="section-header"><h1>Actividad de las familias</h1><div class="section-header__actions"><a class="btn btn--outline" href="/ops" target="_blank" rel="noopener">Ver proceso</a><button class="btn btn--accent" data-new-event>Nuevo evento</button></div></div><section class="grid-kpis" data-slot="kpis" aria-label="Indicadores"></section>
      <section class="stack" data-slot="feed"></section>`;

    mountAsync(el.querySelector('[data-slot="kpis"]'), consultorApi.dashboardSummary, (s) => [
      kpiCard({ icon: "family", tone: "accent", value: fmt.number(s.familiesMonitored), label: "Familias monitoreadas" }),
      kpiCard({ icon: "bell", tone: "warning", value: fmt.number(s.activeAlerts), label: "Alertas activas" }),
      kpiCard({ icon: "clock", tone: "neutral", labelHtml: `Tiempo de revisión: <b>${escapeHtml(fmt.minutes(s.avgReviewMinutes))}</b>` }),
      kpiCard({ icon: "history", tone: "neutral", value: fmt.number(s.silentActions), label: "Comunicaciones automáticas" }),
    ].join(""), { skeleton: skeleton("kpi", 4) });

    const offEvent=on(el,"click","[data-new-event]",async(e,btn)=>{
      const families=await consultorApi.families({status:"all"}).catch(()=>[]);
      const fd=await openModal({title:"Introducir evento de demostración",confirmLabel:"Analizar evento",bodyHtml:html`<label class="field"><span class="field__label">A quién puede afectar</span><select class="select" name="family"><option value="global">Todas las familias · filtrar con IA</option>${families.map(f=>html`<option value="${f.id}">${f.name}</option>`)}</select></label><label class="field"><span class="field__label">Qué ha ocurrido</span><textarea class="input" name="summary" placeholder="Noticia de mercado, cambio comunicado por el cliente, nueva pregunta…" required></textarea></label><p class="muted">El evento se identifica como demostración. El análisis y las decisiones usan los proveedores reales.</p>`});
      if(!fd)return;const family=fd.get("family");try{await withLoading(btn,()=>consultorApi.createEvent({summary:fd.get("summary"),scope:family==="global"?"global":"family",family_ids:family==="global"?[]:[family],origin:family==="global"?"demo_news":"advisor_input",kind:"manual_demo",simulated:true,dedupe_key:crypto.randomUUID()}),{success:"Evento en análisis. El feed se actualizará automáticamente."});}catch{}
    });
    const offFeed=await mountAlertFeed(el.querySelector('[data-slot="feed"]'), { title: "Feed de Alertas", navigate });
    return ()=>{offEvent();offFeed?.();};
  },
};
