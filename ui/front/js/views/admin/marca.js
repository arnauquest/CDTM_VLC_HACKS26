/**
 * ADMIN · IMAGEN DE MARCA  (maqueta: UI_mock/profile_admin/imagen_marca.jpeg)
 * Editor white-label con vista previa en vivo (email + notificación móvil).
 *
 * Flujo:
 *  - Se carga la marca actual (GET /brand) en un BORRADOR local.
 *  - Cualquier cambio se refleja SOLO en la vista previa (variables --pv-*),
 *    la app no cambia hasta publicar.
 *  - Logo/isotipo: se suben al momento (POST /brand/assets) y se guarda la URL.
 *  - "Guardar Borrador" -> PUT /brand/draft
 *  - "Publicar Cambios de Marca" -> POST /brand/publish y applyBrand() global.
 *  - "Restaurar por Defectos" -> POST /brand/reset
 */
import { brandApi } from "../../api/endpoints.js";
import { applyBrand, getBrand, normalizeBrand, isHexColor, renderLogo, DEFAULT_BRAND } from "../../brand.js";
import { html, raw, on, escapeHtml } from "../../ui/dom.js";
import { icon } from "../../ui/icons.js";
import { tag, skeleton, withLoading, openModal, toast } from "../../ui/components.js";

const ACCEPT = "image/png,image/svg+xml";

function dropzone(kind, title, hint, url) {
  return html`
    <div class="field">
      <span class="field__label">${title}</span>
      <span class="field__hint">${hint}</span>
      <label class="dropzone" data-dropzone="${kind}">
        <input type="file" accept="${ACCEPT}" data-upload="${kind}" aria-label="${title}" />
        ${url
          ? raw(html`<img class="dropzone__preview" src="${url}" alt="" /><span class="field__hint">Pulsa o arrastra para reemplazar</span>`)
          : raw(html`${raw(icon("upload"))}<span>${kind === "logo" ? "Arrastra o selecciona tu logo principal (PNG, SVG)" : "Icono de marca (PNG, SVG)"}</span>`)}
      </label>
    </div>`;
}

function colorField(key, label, value) {
  return html`
    <div class="field">
      <span class="field__label">${label}</span>
      <div class="color-input">
        <span class="color-input__swatch" style="background:${value}" data-swatch="${key}"></span>
        <input type="text" value="${value}" data-color-text="${key}" maxlength="7" aria-label="${label} (hex)" spellcheck="false" />
        <input type="color" value="${value}" data-color-pick="${key}" aria-label="${label} (selector)" />
      </div>
    </div>`;
}

function previewHtml(b, tab) {
  return html`
    <div class="preview-body" style="--pv-primary:${b.colors.primary};--pv-accent:${b.colors.accent}">
      ${tab === "email" ? raw(html`
        <div class="pv-email">
          <div class="pv-email__logo">${raw(renderLogo(b))}</div>
          <div class="pv-email__bar"></div>
          <div class="pv-email__content">
            <span class="pv-email__cta">Ver mi Plan Vivo</span>
            <p class="pv-email__text">Hola Daniel, tu asesor ha actualizado tu plan financiero. Pulsa el botón para ver los detalles y los próximos pasos acordados.</p>
          </div>
          <div class="pv-email__footer">${b.legalFooter || "Texto legal del pie de correo"}</div>
        </div>`) : ""}
      <div class="pv-push">
        <div class="pv-push__icon">${raw(b.iconUrl ? `<img src="${escapeHtml(b.iconUrl)}" alt="" />` : renderLogo(b, { size: "sm" }))}</div>
        <div><div class="pv-push__title">${b.appName} - Actualización</div><div>Hola Daniel, el mercado bajó pero tu plan a largo plazo está seguro</div></div>
      </div>
    </div>`;
}

export default {
  title: "Imagen de Marca",
  async render(el) {
    el.innerHTML = skeleton("line", 1) + `<div class="brand-editor">${skeleton("card", 2)}</div>`;

    let draft, voices;
    try {
      [draft, voices] = await Promise.all([brandApi.get().then(normalizeBrand), brandApi.voices().catch(() => [])]);
    } catch {
      draft = structuredClone(getBrand());
      voices = [];
      toast("No se pudo cargar la marca del servidor; se muestra la activa", "error");
    }
    let tab = "email";
    let dirty = false;

    const paint = () => {
      el.innerHTML = html`
        <div class="page-header">
          <div class="page-header__text">
            <h1>Imagen de Marca</h1>
            <p class="lead">Personaliza la identidad visual que verán tus clientes en todas las comunicaciones</p>
          </div>
          <div class="page-header__actions">
            <button class="btn btn--ghost" data-action="reset">Restaurar por Defectos</button>
            <button class="btn ${dirty ? "btn--primary" : "btn--muted"}" data-action="draft" ${dirty ? "" : "disabled"}>Guardar Borrador</button>
          </div>
        </div>

        <div class="brand-editor">
          <div class="brand-editor__col">
            <div class="brand-editor__colhead">
              <h2>Identidad Visual y Corporativa</h2>
              ${raw(draft.integrationActive ? tag("Integración MCP: Activa", "success", "tag--lg") : tag("Integración MCP: Inactiva", "", "tag--lg"))}
            </div>
            <form class="card brand-form" data-form>
              <div class="card__title">${raw(icon("palette"))}<h3>Configuración de Marca</h3></div>

              <h4>Logotipos de la Empresa</h4>
              <div class="grid-2">
                ${raw(dropzone("logo", "Logo Principal", "Para encabezados de correo y web", draft.logoUrl))}
                ${raw(dropzone("icon", "Isotipo / Icono", "Para notificaciones móviles y favicon", draft.iconUrl))}
              </div>

              <h4>Nombre y Colores Corporativos</h4>
              <div class="grid-2">
                <label class="field"><span class="field__label">Nombre de la marca</span>
                  <input class="input" name="appName" value="${draft.appName}" data-text="appName" /></label>
                <label class="field"><span class="field__label">Nombre visible del tenant</span>
                  <input class="input" name="tenantName" value="${draft.tenantName}" data-text="tenantName" /></label>
              </div>
              <div class="grid-2">
                ${raw(colorField("primary", "Color Primario", draft.colors.primary))}
                ${raw(colorField("accent", "Color de Acento", draft.colors.accent))}
              </div>

              <h4>Información Legal y Voz</h4>
              <label class="field"><span class="field__label">Texto de Descargo Legal (Footer)</span>
                <textarea class="textarea" data-text="legalFooter">${draft.legalFooter}</textarea></label>
              <label class="field"><span class="field__label">Perfil de Voz IA (Clonación)</span>
                <select class="select" data-text="voiceProfileId">
                  ${voices.length ? voices.map((v) => raw(html`<option value="${v.id}" ${v.id === draft.voiceProfileId ? "selected" : ""}>${v.label}</option>`)) : raw("<option>Sin perfiles de voz</option>")}
                </select></label>

              <button type="button" class="btn btn--accent btn--block" data-action="publish">${raw(icon("externalLink"))}<span>Publicar Cambios de Marca</span></button>
            </form>
          </div>

          <div class="brand-editor__col">
            <div class="brand-editor__colhead">
              <h2>Vista Previa en Vivo</h2>
              ${raw(tag("Borradores generados automáticamente", "", "tag--lg"))}
            </div>
            <section class="card">
              <div class="card__title">${raw(icon("eye"))}<h3>Vista Previa para el Cliente</h3></div>
              <div class="preview-frame">
                <div class="tabs" role="tablist">
                  <button class="tab ${tab === "email" ? "is-active" : ""}" role="tab" aria-selected="${tab === "email"}" data-tab="email">Email</button>
                  <button class="tab ${tab === "push" ? "is-active" : ""}" role="tab" aria-selected="${tab === "push"}" data-tab="push">Notificación Móvil</button>
                </div>
                <div data-preview>${raw(previewHtml(draft, tab))}</div>
              </div>
            </section>
          </div>
        </div>`;
    };

    const refreshPreview = () => { el.querySelector("[data-preview]").innerHTML = previewHtml(draft, tab); };
    const markDirty = () => {
      if (dirty) return;
      dirty = true;
      const b = el.querySelector('[data-action="draft"]');
      b.disabled = false;
      b.classList.replace("btn--muted", "btn--primary");
    };

    paint();

    const offs = [
      on(el, "input", "[data-text]", (e, input) => { draft[input.dataset.text] = input.value; markDirty(); refreshPreview(); }),
      on(el, "change", "select[data-text]", (e, input) => { draft[input.dataset.text] = input.value; markDirty(); }),
      on(el, "input", "[data-color-pick]", (e, input) => setColor(input.dataset.colorPick, input.value)),
      on(el, "change", "[data-color-text]", (e, input) => {
        let v = input.value.trim();
        if (!v.startsWith("#")) v = "#" + v;
        if (isHexColor(v)) setColor(input.dataset.colorText, v);
        else { toast("Color no válido (usa formato #RRGGBB)", "error"); input.value = draft.colors[input.dataset.colorText]; }
      }),
      on(el, "change", "[data-upload]", (e, input) => upload(input.dataset.upload, input.files[0])),
      on(el, "dragover", "[data-dropzone]", (e, zone) => { e.preventDefault(); zone.classList.add("is-dragover"); }),
      on(el, "dragleave", "[data-dropzone]", (e, zone) => zone.classList.remove("is-dragover")),
      on(el, "drop", "[data-dropzone]", (e, zone) => { e.preventDefault(); zone.classList.remove("is-dragover"); upload(zone.dataset.dropzone, e.dataTransfer.files[0]); }),
      on(el, "click", "[data-tab]", (e, btn) => {
        tab = btn.dataset.tab;
        el.querySelectorAll("[data-tab]").forEach((t) => { t.classList.toggle("is-active", t === btn); t.setAttribute("aria-selected", t === btn); });
        refreshPreview();
      }),
      on(el, "click", "[data-action]", async (e, btn) => {
        switch (btn.dataset.action) {
          case "draft":
            await withLoading(btn, () => brandApi.saveDraft(draft), { success: "Borrador guardado" }).catch(() => {});
            break;
          case "publish": {
            const ok = await openModal({ title: "Publicar marca", bodyHtml: "<p>Los cambios se aplicarán a toda la plataforma y a las comunicaciones con clientes.</p>", confirmLabel: "Publicar" });
            if (!ok) return;
            const saved = await withLoading(btn, () => brandApi.publish(draft), { success: "Marca publicada" }).catch(() => null);
            if (saved) applyBrand(saved);
            break;
          }
          case "reset": {
            const ok = await openModal({ title: "Restaurar por defecto", bodyHtml: "<p>Se descartarán los cambios no publicados y se cargará la marca por defecto.</p>", confirmLabel: "Restaurar", tone: "primary" });
            if (!ok) return;
            const def = await withLoading(btn, () => brandApi.reset()).catch(() => DEFAULT_BRAND);
            draft = normalizeBrand(def);
            dirty = false;
            paint();
            break;
          }
        }
      }),
    ];

    function setColor(key, value) {
      draft.colors[key] = value.toUpperCase();
      el.querySelector(`[data-swatch="${key}"]`).style.background = value;
      el.querySelector(`[data-color-text="${key}"]`).value = value.toUpperCase();
      el.querySelector(`[data-color-pick="${key}"]`).value = value;
      markDirty();
      refreshPreview();
    }

    async function upload(kind, file) {
      if (!file) return;
      if (!["image/png", "image/svg+xml"].includes(file.type)) return toast("Formato no admitido: usa PNG o SVG", "error");
      if (file.size > 2 * 1024 * 1024) return toast("El archivo supera 2 MB", "error");
      const zone = el.querySelector(`[data-dropzone="${kind}"]`);
      zone.classList.add("is-loading");
      try {
        const { url } = await brandApi.uploadAsset(kind, file);
        draft[kind === "logo" ? "logoUrl" : "iconUrl"] = url;
        dirty = true;
        paint();
      } catch (err) {
        toast(err.message || "No se pudo subir el archivo", "error");
      } finally {
        zone?.classList.remove("is-loading");
      }
    }

    return () => offs.forEach((off) => off());
  },
};
