# Plan de mejoras y features — Agentes Lead

Estado base: **8 fases completas** (cimientos → conocimiento → agente vivo →
panel → seguimiento → canales → mejora continua → multi-agente). Backend NestJS
multi-tenant, frontend React con panel completo, 59 tests unitarios.

Este documento prioriza lo que sigue. Notación: **Impacto** (alto/medio/bajo) ·
**Esfuerzo** (S ≤2 días, M ≤1 semana, L >1 semana). Los ⭐ son *quick wins*
(alto impacto / bajo esfuerzo): buen punto de partida.

---

## 0. Endurecer lo que ya existe (antes de crecer)

| # | Mejora | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 0.1 ⭐ | **Tests e2e del pipeline** (webhook → cola → turno → respuesta) con Anthropic mockeado | Alto | M | Hoy solo hay unit tests; falta cubrir el flujo completo y las derivaciones. |
| 0.2 ⭐ | **Rate limiting + protección** en webhooks públicos (`/webhooks/lead`, `/whatsapp/webhook`) | Alto | S | Evita abuso y ruido; `@nestjs/throttler`. |
| 0.3 | **Rotar `webhookSecret` desde el panel** (hoy solo se ve al registrar) | Medio | S | Con auditoría; hoy si se pierde no hay UI para rotarlo. |
| 0.4 ⭐ | **Observabilidad**: métricas de colas (jobs fallidos), traces y un `/health` enriquecido | Alto | M | BullMQ ya guarda *dead-letter*; falta verlo y alertar. |
| 0.5 | **Idempotencia de webhooks entrantes** (Meta/Vapi reintentan) con dedupe por id de evento | Medio | S | Previene respuestas duplicadas. |
| 0.6 | **Reintentos/backoff visibles** y reproceso manual de jobs muertos desde el panel | Medio | M | Operación sin tocar Redis a mano. |

---

## 1. Producto — captación y conversión

| # | Feature | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 1.1 ⭐ | **Tiempo real (SSE/WebSocket)** en la bandeja en vez de polling cada 4 s | Alto | M | Menos carga, UX instantánea. Ya hay `usePolling` como fallback. |
| 1.2 | **Embudo de conversión + gráficos** (tendencias, tasa de cierre, tiempo de respuesta) | Alto | M | Extiende `AgentMetric`; recharts o SVG propio. |
| 1.3 | **Export CSV/Excel** de leads e interacciones | Medio | S | Pedido típico de equipos comerciales. |
| 1.4 | **Campañas salientes** (envío proactivo a segmentos con plantillas aprobadas) | Alto | L | Reusa colas + plantillas; requiere consentimiento/opt-out. |
| 1.5 | **Webchat embebible** (widget para el sitio del cliente) como nuevo canal | Alto | M | Amplía captación más allá de WhatsApp. |
| 1.6 | **Más canales**: Instagram/Messenger, Telegram | Medio | M | El patrón de proveedor pluggable ya está. |

---

## 2. Agente e IA — calidad y control

| # | Feature | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 2.1 ⭐ | **Clasificador de enrutamiento por embeddings** (sin llamar al LLM en cada mensaje) | Alto | M | Más barato y rápido que el clasificador LLM actual; cae al LLM solo en empate. |
| 2.2 ✅ | **Evaluaciones automáticas** de calidad de respuesta | Alto | L | **Hecho**: banco en `src/evals` (`npm run eval`). Corre el turno real y lo califica un juez. Falta ampliarlo a voz, CRM y derivación. |
| 2.3 | **A/B testing de prompts** con métricas por variante | Alto | M | Hoy se activa una sola versión; medir cuál convierte más. |
| 2.4 ⭐ | **Guardrails ampliados**: PII y tono | Alto | S | La parte de cifras está hecha: todo resultado de herramienta y lo que dijo el cliente respaldan; la comparación es por fuente. Falta PII y tono. |
| 2.5 ✅ | **Memoria/resumen persistente por lead** | Medio | M | **Hecho**: `LeadMemory` + herramienta `guardarEnMemoria` + resumen en segundo plano, editable en el panel. |
| 2.6 | **Reglas de enrutamiento avanzadas**: por horario, por campaña, por idioma | Medio | M | Amplía `AgentRouterService`. |
| 2.7 | **Handoff bidireccional con SLA**: si el agente receptor no resuelve, devuelve con motivo | Medio | S | Cierra el ciclo del multi-agente. |

---

## 3. Agendamiento y postventa

| # | Feature | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 3.1 ⭐ | **Integración con calendarios reales** (Google/Outlook) | Alto | M | Hoy las citas son internas; sincronizar evita choques reales. |
| 3.2 | **Recordatorios multicanal configurables** (ventanas, plantillas) | Medio | S | Ya hay recordatorios; hacerlos configurables por empresa. |
| 3.3 | **Encuestas post-cita / NPS** automáticas | Bajo | S | Alimenta métricas de satisfacción. |

---

## 4. SaaS — operación y negocio

| # | Feature | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 4.1 | **Planes y facturación (Stripe)** + límites por plan (leads/mes, tokens) | Alto | L | Necesario para vender como servicio. |
| 4.2 | **Medición de uso de tokens/costos por empresa** | Alto | M | Control de márgenes; base para el cobro por uso. |
| 4.3 ⭐ | **Invitaciones de usuarios + gestión de miembros/roles** desde el panel | Alto | S | Hoy el alta de usuarios es limitada; falta invitar/operadores. |
| 4.4 | **Onboarding guiado** (checklist: conocimiento → agente → webhook → primera prueba) | Medio | M | Reduce fricción de activación. |
| 4.5 | **Página de estado / health público** por empresa | Bajo | S | Confianza operacional. |

---

## 5. Cumplimiento y datos

| # | Feature | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 5.1 | **Borrado/anonimización de datos de un lead** (derecho de supresión) | Alto | M | Ley 19.628 (Chile) / RGPD; hoy no hay flujo. |
| 5.2 | **Auditoría visible en el panel** (ya se registra `AuditLog`, falta la vista) | Medio | S | Transparencia de cambios sensibles. |
| 5.3 | **Retención y export de datos** por empresa | Medio | M | Políticas configurables. |
| 5.4 | **Consentimiento / opt-out** por canal (obligatorio para campañas salientes) | Alto | M | Bloquea contactar a quien pidió no ser contactado. |

---

## 6. Frontend / UX (continuación del rediseño)

| # | Mejora | Impacto | Esf. | Notas |
|---|---|---|---|---|
| 6.1 ⭐ | **Estados de carga (skeletons)** en todas las vistas | Medio | S | Hoy varias vistas saltan de vacío a datos. |
| 6.2 | **Modo oscuro** | Bajo | S | El sistema de tokens ya facilita re-tematizar. |
| 6.3 | **Accesibilidad** (focus visible, ARIA, contraste) y responsive fino | Medio | M | Base ya puesta con los primitivos. |
| 6.4 | **Toasts/confirmaciones** consistentes (reemplazar `alert`/`confirm` nativos) | Medio | S | Un `ToastProvider` reusable. |
| 6.5 | **i18n** del panel (es/en) | Bajo | M | Para expandir fuera de LATAM. |

---

## Secuencia sugerida (primer trimestre)

1. **Fundaciones de confianza**: 0.1, 0.2, 0.4, 2.4 (tests, rate limit, observabilidad, guardrails).
2. **UX de operación**: 1.1 (tiempo real), 6.1/6.4 (skeletons, toasts), 4.3 (invitar usuarios).
3. **Valor comercial visible**: 1.2 (embudo + gráficos), 1.3 (export), 3.1 (calendarios).
4. **Escala como SaaS**: 4.1/4.2 (facturación + costos), 2.1 (enrutamiento por embeddings), 5.1/5.4 (cumplimiento).

Cada ítem es independiente y encaja en el flujo SDD por fases del proyecto: una
feature = una spec aprobada → implementación → verificación (build + lint + tests).
