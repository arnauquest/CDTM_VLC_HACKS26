/**
 * PUNTO DE ENTRADA
 * 1. Carga la marca (cache -> backend) para pintar ya con los colores correctos.
 * 2. Pide la sesión (GET /me) para saber el rol.
 * 3. Pinta el shell y arranca el router.
 */
import { config } from "./config.js";
import { initBrand } from "./brand.js";
import { sessionApi } from "./api/endpoints.js";
import { renderShell, setActiveNav, updateShellBrand } from "./shell.js";
import { startRouter } from "./router.js";
import { errorState } from "./ui/components.js";

const root = document.getElementById("root");

async function boot() {
  const brandReady = initBrand();
  let session;
  try {
    session = await sessionApi.me();
  } catch (err) {
    // TODO(auth): cuando exista login, redirigir aquí a la pantalla de acceso.
    root.innerHTML = `<div style="padding:32px">${errorState(err)}</div>`;
    root.querySelector('[data-action="retry"]')?.addEventListener("click", () => location.reload());
    return;
  }
  await brandReady;

  const outlet = renderShell(root, session);
  startRouter({ outlet, session, onRoute: setActiveNav });

  // Si cambia la marca (p.ej. el admin publica), los colores cambian solos vía
  // CSS vars; el logo y el nombre del tenant se repintan aquí.
  window.addEventListener("brand:change", () => updateShellBrand(session));
}

window.addEventListener("auth:expired", () => {
  // TODO(auth): redirigir a login real.
  if (!config.USE_MOCKS) location.href = "./";
});

boot();
