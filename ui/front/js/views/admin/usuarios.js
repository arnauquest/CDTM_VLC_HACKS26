/**
 * ADMIN · USUARIOS Y ROLES  (maqueta: UI_mock/profile_admin/users_roles.jpeg)
 * Onboarding de familias (cola de aprobación) + equipo interno.
 * Endpoints: GET/PUT /admin/onboarding/settings, GET /admin/onboarding/queue,
 *            POST /admin/onboarding/:id/accept|reject, GET/POST /admin/users,
 *            PATCH /admin/users/:id, POST /admin/portfolios/reassign
 */
import { adminApi } from "../../api/endpoints.js";
import { html, raw, on, fmt } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { avatar, familyAvatar, toggle, mountAsync, skeleton, emptyState, withLoading, openModal, toast } from "../../ui/components.js";

const autoAcceptLabel = (on) => (on
  ? `<span class="text-accent">[ON</span> <span class="muted">- Automático]</span>`
  : `<span class="text-danger">[OFF</span> <span class="muted">- Revisión Manual]</span>`);

export default {
  title: "Usuarios y Roles",
  render(el) {
    let consultants = [];

    el.innerHTML = html`
      <div class="page-header">
        <h1 style="flex:1;min-width:280px">Onboarding de Clientes<br />(Rol Familia)</h1>
        <div class="card onboarding-toggle" data-slot="auto">${raw(skeleton("line", 2))}</div>
      </div>
      <h2>Cola de aprobación</h2>
      <section class="list" data-slot="queue"></section>
      <div class="section-header" style="margin-top:var(--sp-6)">
        <h2>Equipo Interno (Consultores y Admins)</h2>
        <div class="section-header__actions"><button class="btn btn--accent" data-action="create">${raw(icon("plus"))}Crear Usuario (Consultor / Admin)</button></div>
      </div>
      <section class="card card--flush list list--joined" data-slot="team"></section>`;

    // --- Auto-aceptar
    const autoEl = el.querySelector('[data-slot="auto"]');
    mountAsync(autoEl, adminApi.onboardingSettings, (s) => html`
      ${raw(toggle({ id: "auto-accept", checked: s.autoAccept, label: "Auto-aceptar registros" }))}
      <div class="onboarding-toggle__text">Auto-aceptar registros de nuevas familias por defecto <span data-auto-label>${raw(autoAcceptLabel(s.autoAccept))}</span></div>`,
    { skeleton: skeleton("line", 2) });

    // --- Cola de onboarding (necesita la lista de consultores para el selector)
    const queueEl = el.querySelector('[data-slot="queue"]');
    const teamEl = el.querySelector('[data-slot="team"]');

    const loadTeam = () => mountAsync(teamEl, adminApi.team, (team) => {
      consultants = team;
      return team.length ? team.map((u) => html`
        <article class="list-row team-row" data-id="${u.id}">
          <div class="team-row__who">${raw(avatar(u.name, u.avatarUrl))}<span class="list-row__title">${u.name}</span></div>
          <span class="list-row__subtitle">${u.roleLabel}</span>
          <span class="list-row__subtitle">${u.familiesAssigned != null ? `${fmt.number(u.familiesAssigned)} familias asignadas` : u.scopeLabel || ""}</span>
          <div class="list-row__actions">
            <button class="btn btn--outline" data-action="perms">Editar Permisos</button>
            <button class="btn btn--outline-accent" data-action="reassign">Reasignar Familias</button>
          </div>
        </article>`).join("") : emptyState("Sin usuarios");
    }, { skeleton: skeleton("row", 3) });

    const loadQueue = () => mountAsync(queueEl, adminApi.onboardingQueue, (queue) =>
      queue.length ? queue.map((q) => html`
        <article class="list-row" data-id="${q.id}">
          ${raw(familyAvatar({ name: q.familyName, avatarUrls: q.avatarUrls }))}
          <div class="list-row__main">
            <span class="list-row__title">${q.familyName}</span>
            <span class="list-row__subtitle">Registrado: ${fmt.relative(q.registeredAt)} - ${q.members} miembros</span>
          </div>
          <div class="list-row__actions">
            <label class="row"><span class="list-row__subtitle">Asignar Consultor:</span>
              <select class="select select--sm" data-consultant>
                <option value="">Consultor</option>
                ${consultants.filter((c) => c.role === "consultor").map((c) => raw(html`<option value="${c.id}">${c.name}</option>`))}
              </select></label>
            <button class="btn btn--accent" data-action="accept">Aceptar y Activar Plan</button>
            <button class="btn btn--outline" data-action="reject">Rechazar</button>
          </div>
        </article>`).join("") : emptyState("No hay familias pendientes de aprobación"),
    { skeleton: skeleton("row", 1) });

    loadTeam().then(loadQueue);

    const offChange = on(el, "change", "#auto-accept", async (e, input) => {
      el.querySelector("[data-auto-label]").innerHTML = autoAcceptLabel(input.checked);
      try { await adminApi.saveOnboardingSettings({ autoAccept: input.checked }); toast("Preferencia guardada", "success"); }
      catch (err) { input.checked = !input.checked; el.querySelector("[data-auto-label]").innerHTML = autoAcceptLabel(input.checked); toast(err.message, "error"); }
    });

    const offClick = on(el, "click", "[data-action]", async (e, btn) => {
      const row = btn.closest("[data-id]");
      const id = row?.dataset.id;
      switch (btn.dataset.action) {
        case "accept": {
          const consultantId = row.querySelector("[data-consultant]").value;
          if (!consultantId) return toast("Selecciona un consultor", "error");
          await withLoading(btn, () => adminApi.acceptFamily(id, consultantId), { success: "Familia activada" }).then(() => row.remove()).catch(() => {});
          break;
        }
        case "reject":
          if (await openModal({ title: "Rechazar registro", bodyHtml: "<p>¿Seguro que quieres rechazar este registro?</p>", confirmLabel: "Rechazar", tone: "primary" }))
            await withLoading(btn, () => adminApi.rejectFamily(id), { success: "Registro rechazado" }).then(() => row.remove()).catch(() => {});
          break;
        case "create": {
          const fd = await openModal({
            title: "Crear usuario", confirmLabel: "Crear",
            bodyHtml: `
              <label class="field"><span class="field__label">Nombre</span><input class="input" name="name" required /></label>
              <label class="field"><span class="field__label">Email</span><input class="input" type="email" name="email" required /></label>
              <label class="field"><span class="field__label">Rol</span><select class="select" name="role"><option value="consultor">Consultor</option><option value="admin">Admin</option></select></label>`,
          });
          if (fd) { await withLoading(btn, () => adminApi.createUser(Object.fromEntries(fd)), { success: "Usuario creado" }).catch(() => {}); loadTeam(); }
          break;
        }
        case "perms": {
          const u = consultants.find((c) => c.id === id);
          const fd = await openModal({
            title: `Permisos · ${u.name}`, confirmLabel: "Guardar",
            bodyHtml: `<label class="field"><span class="field__label">Rol</span><select class="select" name="role">
              <option value="consultor" ${u.role === "consultor" ? "selected" : ""}>Consultor</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option></select></label>
              <p class="field__hint">El detalle de permisos granulares se definirá con backend.</p>`,
          });
          if (fd) { await withLoading(btn, () => adminApi.updatePermissions(id, Object.fromEntries(fd)), { success: "Permisos actualizados" }).catch(() => {}); loadTeam(); }
          break;
        }
        case "reassign":
          // Reutiliza la lógica del Resumen Ejecutivo (modal de reasignación).
          window.location.hash = "/admin/resumen";
          break;
      }
    });
    return () => { offChange(); offClick(); };
  },
};
