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
  if (!config.USE_MOCKS) mountDemoNavigation(session);

  // Si cambia la marca (p.ej. el admin publica), los colores cambian solos vía
  // CSS vars; el logo y el nombre del tenant se repintan aquí.
  window.addEventListener("brand:change", () => updateShellBrand(session));
}

window.addEventListener("auth:expired", () => {
  // TODO(auth): redirigir a login real.
  if (!config.USE_MOCKS) location.reload();
});

async function mountDemoNavigation(session) {
  const bar=document.createElement("nav");bar.className="demo-session-bar";bar.setAttribute("aria-label","Sesión de demostración local");
  const label=document.createElement("span");label.textContent="DEMO LOCAL";bar.append(label);
  for(const [role,title,route] of [["consultor","Asesor","/inicio"],["admin","Admin","/admin/resumen"],["cliente","Cliente","/mi-plan"]]){
    const link=document.createElement("a");link.textContent=title;link.href=`?role=${role}&family=${encodeURIComponent(config.DEMO_FAMILY)}#${route}`;if(role===session.role)link.setAttribute("aria-current","page");bar.append(link);
  }
  if(session.role==="cliente"){
    const select=document.createElement("select");select.setAttribute("aria-label","Familia de demostración");
    try {const rows=await fetch(config.API_BASE_URL+"/demo/families").then(r=>r.json());for(const f of rows){const o=document.createElement("option");o.value=f.id;o.textContent=f.name;o.selected=f.id===config.DEMO_FAMILY;select.append(o);}select.onchange=()=>location.href=`?role=cliente&family=${encodeURIComponent(select.value)}#/mi-plan`;bar.append(select);}catch{}
  }
  const ops=document.createElement("a");ops.href="/ops";ops.target="_blank";ops.rel="noopener";ops.textContent="Ver proceso";bar.append(ops);document.body.append(bar);
}
boot();
