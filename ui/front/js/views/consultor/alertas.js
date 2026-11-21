/**
 * CONSULTOR · ALERTAS (listado)
 * No hay maqueta específica del listado: reutiliza el Feed de Inicio.
 * El detalle de cada alerta está en alerta-detalle.js.
 */
import { mountAlertFeed } from "./_alert-feed.js";

export default {
  title: "Alertas",
  render(el, { navigate, query }) {
    // ?consultant=<id> llega desde "Revisar Alertas" del Resumen Ejecutivo (admin).
    return mountAlertFeed(el, { title: "Alertas", navigate, consultantId: query.consultant });
  },
};
