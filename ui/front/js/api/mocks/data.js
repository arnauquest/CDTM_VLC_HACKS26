/**
 * DATOS DE EJEMPLO (SOLO DESARROLLO)
 * ---------------------------------------------------------------------------
 * Reproducen el contenido de las maquetas de UI_mock/ y sirven como
 * EJEMPLO VIVO del contrato de datos que esperamos del backend.
 * Se cargan solo si config.USE_MOCKS === true. Borrables cuando haya backend.
 */

export const brand = {
  appName: "sherpas",                 // nombre del producto (wordmark de texto si no hay logo)
  tenantName: "CDTM Valencia Hacks 2026",
  logoUrl: null,                      // URL logo principal (PNG/SVG). null -> wordmark con appName
  iconUrl: null,                      // URL isotipo (favicon, notificaciones)
  colors: { primary: "#0F2942", accent: "#10B981" },
  fontFamily: null,                   // p.ej. "Poppins". null -> fuente por defecto
  fontUrl: null,                      // URL de hoja de estilos de la fuente (Google Fonts…)
  legalFooter: "Asesoría financiera regulada. Los rendimientos pasados no garantizan resultados futuros.",
  voiceProfileId: "voice-main",
  integrationActive: true,
};

export const voices = [
  { id: "voice-main", label: "Voz del Asesor Principal (Entrenada)", status: "trained" },
  { id: "voice-neutral", label: "Voz neutra corporativa", status: "trained" },
];

export const users = {
  consultor: { id: "u-1", name: "Álex Martín", avatarUrl: null, role: "consultor", tenant: { id: "t-1", name: "CDTM Valencia Hacks 2026" } },
  admin: { id: "u-9", name: "Carlos Mendoza", avatarUrl: null, role: "admin", tenant: { id: "t-1", name: "CDTM Valencia Hacks 2026" } },
  cliente: { id: "u-20", name: "Melanie Weah", avatarUrl: null, role: "cliente", tenant: { id: "t-1", name: "CDTM Valencia Hacks 2026" }, family: { id: "f-1", name: "Familia Weah" } },
};

/* ---------------- CONSULTOR ---------------- */

export const consultantDashboard = { familiesMonitored: 150, activeAlerts: 14, avgReviewMinutes: 4, silentActions: 28 };

export const alertCategories = [
  { id: "law_change", label: "Cambio de Ley" },
  { id: "market_drop", label: "Caída de Mercado" },
  { id: "life_change", label: "Cambio de Vida" },
  { id: "big_decision", label: "Gran Decisión" },
  { id: "silent", label: "Acciones automáticas silenciosas (Sin impacto)" },
];

export const alerts = [
  { id: "a-1", family: { id: "f-1", name: "Timothy & Melanie Weah", avatarUrls: [] }, title: "Alto Impacto - Deuda de Tarjeta vs Efectivo", categories: ["life_change"], tags: ["Cambio de Vida", "Datos de Cliente"], impact: "high", channels: { email: true, call: true } },
  { id: "a-2", family: { id: "f-2", name: "Michael Carter", avatarUrls: [] }, title: "Planificación de Vivienda 2027 y Retiro", categories: ["big_decision"], tags: ["Gran Decisión"], impact: "medium", channels: { email: true, call: true } },
  { id: "a-3", family: { id: "f-3", name: "Daniel & Emily Johnson", avatarUrls: [] }, title: "Priorización: Universidad vs Hipoteca", categories: ["law_change"], tags: ["Cambio de Ley / Tasas"], impact: "medium", channels: { email: true, call: true } },
  { id: "a-4", family: { id: "f-4", name: "Samantha Lewis", avatarUrls: [] }, title: "Ajuste de Inversiones - Segunda Vivienda", categories: ["market_drop"], tags: ["Caída de Mercado", "Planificación"], impact: "medium", channels: { email: true, call: true } },
  { id: "a-5", family: { id: "f-5", name: "Lucía & Marco Ferri", avatarUrls: [] }, title: "Nacimiento: revisión de seguro de vida", categories: ["life_change"], tags: ["Cambio de Vida"], impact: "medium", channels: { email: true, call: false } },
];

export const alertDetail = {
  id: "a-3",
  family: { id: "f-3", name: "Daniel & Emily Johnson" },
  facts: ["Hipoteca: $560,000", "Tarjeta: $18,000 (24.9% TAE)", "Prioridad: Universidad Oliver/Sophia vs Retiro 62"],
  touchpoints: [
    { step: 1, label: "Alerta Inicial", status: "sent" },
    { step: 2, label: "Análisis de Impacto", status: "sent" },
    { step: 3, label: "Propuesta de Estrategia", status: "current" },
    { step: 4, label: "Acción y Cierre", status: "pending" },
  ],
  email: {
    to: "Daniel & Emily Johnson",
    subject: "Estrategia para priorizar la universidad de Oliver y Sophia sin descuidar su jubilación",
    tone: "Empático y Cercano",
    dataVerified: true,
    bodyHtml:
      "<p>Hola Daniel y Emily,</p>" +
      "<p>Espero que estén muy bien. He estado revisando su plan financiero a la luz de los recientes cambios y quería proponerles una estrategia clara.</p>" +
      "<p>Para asegurar los estudios de Oliver y Sophia en la universidad y, al mismo tiempo, mantener el rumbo de su jubilación a los 62 años, <strong>el primer paso clave es atacar esa tarjeta de $18,000 con un interés del 24.9% TAE. Al refinanciar o liquidar esa deuda</strong> de alta prioridad, liberaremos un flujo de caja mensual crucial que podremos destinar directamente a los fondos educativos, sin comprometer su hipoteca de $560,000 ni retrasar su retiro.</p>" +
      "<p>¿Les parece si lo revisamos en detalle en una breve llamada?</p>",
  },
  call: {
    enabled: true,
    audioUrl: null, // URL del audio TTS generado (mp3/wav). null -> reproductor deshabilitado
    durationSec: 45,
    voiceLabel: "Voz del Asesor (Clonada por IA) - Escucha previa",
    script:
      "“Hola Daniel, Emily, soy [Nombre]. Sé que están balanceando la universidad de los chicos con su meta de jubilación a los 62, y con la hipoteca puede parecer difícil saber qué va primero. He preparado una estrategia para eliminar esa tarjeta al 24.9% que nos liberará el flujo que necesitan para Oliver y Sophia sin tocar su retiro. Échenle un ojo al correo que les acabo de mandar y agendamos cinco minutos para verlo. ¡Un abrazo!”",
  },
};

export const familiesSummary = { total: 150, needsApproval: 14, autopilot: 136 };

export const families = [
  { id: "f-1", name: "Timothy & Melanie Weah", avatarUrls: [], risk: "Moderado", status: "needs_approval", facts: ["Patrimonio: Casa $350k", "Deuda: Tarjeta $18k (18%)", "Cash: $150k"], goal: "Optimizar deuda vs efectivo", planUrl: "#", psychProfileUrl: "#" },
  { id: "f-2", name: "Michael Carter", avatarUrls: [], risk: "Moderado-Alto", status: "needs_approval", facts: ["Salario: $180k (Renta)", "Objetivo: Casa $550k en 2027"], goal: "Jubilación a los 58 & compra de vivienda", planUrl: "#", psychProfileUrl: "#" },
  { id: "f-3", name: "Daniel & Emily Johnson", avatarUrls: [], risk: "Moderado", status: "needs_approval", riskProfile: "Moderado", facts: ["Hijos: Oliver y Sophia", "Hipoteca: $560k", "Deuda: Tarjeta $18k"], goal: "Universidad y Retiro a los 62", planUrl: "#", psychProfileUrl: "#" },
  { id: "f-4", name: "Samantha Lewis", avatarUrls: [], risk: "Alto", status: "autopilot", riskProfile: "Decidido", facts: ["Salario: $250k", "Libre de deudas", "Bien asegurada"], goal: "Universidad e Inversión Segunda Vivienda 2030", planUrl: "#", psychProfileUrl: "#" },
];

export const historySummary = { total: 142, silent: 128, approved: 14 };

export const history = [
  { id: "h-1", kind: "silent", title: "Sin impacto en plan: Reforma fiscal 2026", subtitle: "84 familias tranquilizadas automáticamente", tags: ["84 familias tranquilizadas automáticamente"], status: "silent", family: null, createdAt: "2026-11-20T09:12:00Z" },
  { id: "h-2", kind: "silent", title: "Toque 1 Calma enviado automáticamente - Caída Tech", subtitle: "Toque 1 Calma enviado automáticamente - Caída Tech -30%", tags: ["44 familias notificadas"], status: "silent", family: null, createdAt: "2026-11-19T16:40:00Z" },
  { id: "h-3", kind: "approved", title: "Correo 1-Clic aprobado", subtitle: "Timothy & Melanie Weah - Optimización de efectivo", tags: [], status: "approved", family: { id: "f-1", name: "Timothy & Melanie Weah", avatarUrls: [] }, createdAt: "2026-11-19T10:02:00Z" },
  { id: "h-4", kind: "approved", title: "Llamada Automatizada completada", subtitle: "Samantha Lewis - Segunda vivienda 2030", tags: [], status: "approved", family: { id: "f-4", name: "Samantha Lewis", avatarUrls: [] }, createdAt: "2026-11-18T12:30:00Z" },
];

export const templates = [
  { id: "t-1", name: "Toque 1 · Calma ante caída de mercado", channel: "email", updatedAt: "2026-11-10T10:00:00Z", usage: 44 },
  { id: "t-2", name: "Cambio legislativo sin impacto", channel: "email", updatedAt: "2026-11-02T10:00:00Z", usage: 84 },
  { id: "t-3", name: "Guion llamada · Propuesta de estrategia", channel: "call", updatedAt: "2026-10-28T10:00:00Z", usage: 12 },
];

export const autonomy = {
  sections: [
    {
      id: "autonomy",
      title: "Nivel de Autonomía",
      rules: [
        { id: "silent_zero_impact", label: "Envío automático silencioso cuando el impacto en el plan es 0%", example: "(Ej. Cambios fiscales sin efecto)", hint: "Notifica discretamente a las familias cuyos planes no se ven afectados por reformas menores.", enabled: true },
        { id: "human_over_threshold", label: "Requerir aprobación humana si el impacto supera $5,000 o implica deuda/vivienda", hint: "Retiene en el Feed de Alertas cualquier cambio que involucre hipotecas, deudas de tarjeta de crédito o grandes sumas.", enabled: true },
      ],
    },
    {
      id: "channels",
      title: "Alertas y Canales de Comunicación",
      rules: [
        { id: "one_click_channels", label: "Habilitar Correo 1-Clic y Llamada Automatizada IA en alertas críticas", hint: "Genera borradores listos para enviar en un clic y programa seguimientos automatizados de alta prioridad.", enabled: true },
      ],
    },
  ],
  integration: { name: "Conexión MCP de Datos de Clientes", status: "connected", description: "Acceso seguro y en tiempo real a los planes, ingresos y deudas de tus 150 familias." },
};

/* ---------------- ADMIN ---------------- */

export const adminSummary = { activeFamilies: 600, activeConsultants: 4, slaMinutes: 3.2, silenceRate: 0.88, unreadNotifications: 1 };

export const workload = [
  { id: "c-1", name: "Carlos Mendoza", title: "Senior Advisor", avatarUrl: null, familiesAssigned: 165, capacity: 150, slaMinutes: 2.8, slaTarget: 4, silenceRate: 0.85, status: "overloaded_urgent", active: true },
  { id: "c-2", name: "Laura Benítez", title: "Partner", avatarUrl: null, familiesAssigned: 120, capacity: 150, slaMinutes: 3.5, slaTarget: 4, silenceRate: 0.9, status: "optimal", active: true },
  { id: "c-3", name: "Sergio Torres", title: "Asesor Asociado", avatarUrl: null, familiesAssigned: 168, capacity: 150, slaMinutes: 4.1, slaTarget: 4, silenceRate: 0.82, status: "overloaded", active: true },
  { id: "c-4", name: "Paula Ruiz", title: "Advisor junior", avatarUrl: null, familiesAssigned: 147, capacity: 150, slaMinutes: 2.5, slaTarget: 4, silenceRate: 0.91, status: "near_limit", active: true },
];

export const onboardingSettings = { autoAccept: false };

export const onboardingQueue = [
  { id: "o-1", familyName: "Familia Ramírez-García (Nuevos)", avatarUrls: [], registeredAt: new Date(Date.now() - 2 * 3600e3).toISOString(), members: 4 },
];

export const team = [
  { id: "c-1", name: "Carlos Mendoza", avatarUrl: null, role: "admin", roleLabel: "Admin / Director", scopeLabel: "Acceso total", familiesAssigned: null },
  { id: "c-5", name: "Sofía Alcaraz", avatarUrl: null, role: "consultor", roleLabel: "Consultor Senior", scopeLabel: null, familiesAssigned: 75 },
  { id: "c-6", name: "Javier Torres", avatarUrl: null, role: "consultor", roleLabel: "Consultor", scopeLabel: null, familiesAssigned: 42 },
];

export const guardrails = [
  { id: "no_guaranteed_returns", label: "Bloquear promesas de rentabilidad garantizada", hint: "Evita que el motor de IA sugiera o garantice rendimientos en cualquier comunicación.", enabled: true },
  { id: "official_sources", label: "Exigir fuente oficial verificada en leyes/mercados", hint: "Obliga a la IA a citar fuentes de bases de datos oficiales ante cambios legislativos o financieros.", enabled: true },
  { id: "immutable_audit", label: "Registro inmutable de auditoría FINRA/SEC", hint: "Cada mensaje, llamada y regla aprobada se registra de forma permanente para auditorías regulatorias.", enabled: true },
];

export const integrations = [
  { id: "mcp", name: "Servidor MCP Maestro", status: "connected", statusLabel: "Conectado", canVerify: true, canConfigure: false },
  { id: "email_domain", name: "Dominio Correo DKIM/SPF", status: "verified", statusLabel: "Verificado", canVerify: false, canConfigure: true },
  { id: "voice", name: "Centralita Voz IA", status: "active", statusLabel: "Activa", canVerify: false, canConfigure: true },
];

export const billing = { seatsUsed: 4, seatsTotal: 5, renewalDate: "2026-12-01", planName: "Plan Corporativo" };

/* ---------------- CLIENTE (familia) ---------------- */

/**
 * El plan se describe como una lista de TARJETAS genéricas: el backend decide
 * qué tarjetas mostrar y en qué orden, el front solo sabe pintar cada tipo.
 *   type "list"  -> título + líneas { label, value? }
 *   type "goal"  -> meta con visualización:
 *       kind "trajectory": curva de avance (progress 0-1, series opcional)
 *       kind "progress"  : barra (progress 0-1, valueLabel)
 */
export const clientPlan = {
  cards: [
    { id: "assets", type: "list", title: "Mi Patrimonio", items: [
      { label: "Casa", value: 350000, format: "money" },
      { label: "Efectivo", value: 150000, format: "money" },
      { label: "Deuda Tarjeta", value: 18000, format: "money" },
    ] },
    { id: "goal-retire", type: "goal", kind: "trajectory", title: "Meta: Jubilación 58", caption: "Meta: Jubilación 58", progress: 0.72, series: [0, 0.08, 0.17, 0.27, 0.38, 0.5, 0.61, 0.72] },
    { id: "member-timothy", type: "list", title: "Timothy Weah", items: [
      { label: "Ahorros / Alquiler" },
      { label: "Objetivo Vivienda", value: 550000, format: "money_k" },
    ] },
    { id: "goal-card", type: "goal", kind: "progress", title: "Meta: Liquidar tarjeta 18%", caption: "Meta: Liquidar tarjeta 18%", progress: 0.18, valueLabel: "18%" },
  ],
};

export const clientUpdateFields = [
  { id: "income", label: "Mis Nuevos Ingresos", placeholder: "Mis Nuevos Ingresos", type: "text" },
  { id: "properties", label: "Mis Propiedades", placeholder: "Mis Propiedades", type: "text" },
  { id: "debts", label: "Mis Deudas", placeholder: "Mis Deudas", type: "text" },
];

export const clientAdvisor = { id: "c-1", name: "Carlos Mendoza", avatarUrl: null, title: "Senior Advisor" };

export const clientQuickTopics = [
  { id: "law_reform", label: "¿Cómo afecta la reforma?", icon: "help" },
  { id: "plan_proposal", label: "Solicitar propuesta de plan", icon: "pencil" },
];

export const clientMessages = [
  { id: "m-1", author: "advisor", text: "Hola Melanie, he analizado su caso y le propongo empezar por liquidar la tarjeta: es la deuda más cara.", createdAt: "2026-11-21T09:00:00Z" },
  { id: "m-2", author: "client", text: "Perfecto, ¿cuándo liquidamos la tarjeta?", createdAt: "2026-11-21T09:05:00Z" },
];

export const clientCallSlots = [
  { id: "s-1", label: "Hoy 16:00", start: "2026-11-21T16:00:00Z" },
  { id: "s-2", label: "Mañana 10:00", start: "2026-11-22T10:00:00Z" },
  { id: "s-3", label: "Mañana 17:30", start: "2026-11-22T17:30:00Z" },
];

export const clientPreferences = { sections: { updateData: true, askInfo: true, callRequest: true } };
