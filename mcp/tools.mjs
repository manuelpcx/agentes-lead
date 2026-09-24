/**
 * Catálogo de herramientas MCP de agentes-lead.
 *
 * Cada una es un endpoint de `/api/v1` más una capa de forma: la API devuelve
 * la ficha completa y acá se recorta a lo que el modelo necesita. Eso ahorra
 * contexto y, sobre todo, evita mandarle al cliente MCP datos que no pidió.
 *
 * Lo que NO hay, a propósito: nada que le mande un mensaje a una persona real
 * (responder al lead, iniciar una llamada). Al otro lado corre un modelo en el
 * computador de alguien; un WhatsApp a un cliente no se dispara desde ahí.
 */

const ESTADOS = [
  'NUEVO',
  'CONTACTADO',
  'EN_CONVERSACION',
  'AGENDADO',
  'CERRADO_GANADO',
  'CERRADO_PERDIDO',
  'ESCALADO_HUMANO',
];
const CALIFICACIONES = ['FRIO', 'TIBIO', 'CALIENTE'];

/** Fecha ISO obligatoria con zona, para no heredar la ambigüedad del servidor. */
const ISO_HINT = 'Fecha y hora ISO 8601 con zona horaria (ej. 2026-09-20T15:00:00-03:00).';

// ─────────────────────────── recortes ───────────────────────────

function lead(l) {
  return {
    id: l.id,
    nombre: l.name,
    telefono: l.phone,
    email: l.email,
    estado: l.status,
    calificacion: l.qualification,
    enControlHumano: l.isPausedForHuman,
    proximaAccion: l.nextActionAt,
    actualizado: l.updatedAt,
    ultimoMensaje: l.lastMessage
      ? {
          texto: l.lastMessage.content,
          canal: l.lastMessage.channel,
          direccion: l.lastMessage.direction === 'inbound' ? 'del lead' : 'nuestro',
          cuando: l.lastMessage.occurredAt,
        }
      : null,
  };
}

function interaccion(i) {
  return {
    canal: i.channel,
    direccion: i.direction === 'inbound' ? 'del lead' : 'nuestro',
    porAgente: Boolean(i.agentId),
    texto: i.content,
    cuando: i.occurredAt,
  };
}

function cita(a) {
  return {
    id: a.id,
    titulo: a.title,
    inicio: a.startAt,
    fin: a.endAt,
    lugar: a.location,
    estado: a.status,
    lead: a.lead ? { id: a.lead.id, nombre: a.lead.name, telefono: a.lead.phone } : null,
  };
}

// ─────────────────────────── herramientas ───────────────────────────

/**
 * `escritura: true` marca las que una llave de solo lectura no puede usar:
 * el servidor las esconde del catálogo cuando la llave no tiene permiso, para
 * que el modelo no intente algo que va a fallar igual.
 */
export const TOOLS = [
  {
    name: 'estadoConexion',
    escritura: false,
    description:
      'Verifica la conexión y dice a qué empresa está conectada la llave y con qué permisos. Úsala primero si algo falla.',
    inputSchema: { type: 'object', properties: {} },
    run: async (api) => {
      const me = await api.get('/me');
      return {
        empresa: me.companyName,
        empresaId: me.companyId,
        zonaHoraria: me.timezone,
        permisos: me.role,
        puedeEscribir: me.canWrite,
      };
    },
  },
  {
    name: 'listarLeads',
    escritura: false,
    description:
      'Lista los leads de la empresa, con su último mensaje. Se puede filtrar por estado del embudo y buscar por nombre, teléfono o email.',
    inputSchema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          enum: ESTADOS,
          description: 'Filtra por estado del embudo.',
        },
        busqueda: {
          type: 'string',
          description: 'Texto a buscar en nombre, teléfono, email u origen.',
        },
      },
    },
    run: async (api, args) => {
      const leads = await api.get('/leads', {
        status: args.estado,
        q: args.busqueda,
      });
      return { total: leads.length, leads: leads.map(lead) };
    },
  },
  {
    name: 'verLead',
    escritura: false,
    description:
      'Ficha completa de un lead: sus datos, la conversación con el agente, sus citas y las notas internas.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'Id del lead (uuid).' },
      },
      required: ['leadId'],
    },
    run: async (api, args) => {
      const d = await api.get(`/leads/${args.leadId}`);
      return {
        lead: {
          ...lead(d.lead),
          origen: d.lead.source,
          campana: d.lead.campaign,
          motivoCalificacion: d.lead.qualificationReason,
          intentosDeContacto: d.lead.contactAttempts,
        },
        conversacion: d.interactions.map(interaccion),
        citas: d.appointments.map(cita),
        notas: d.notes.map((n) => ({
          id: n.id,
          texto: n.body,
          autor: n.authorName,
          cuando: n.createdAt,
        })),
      };
    },
  },
  {
    name: 'crearLead',
    escritura: true,
    description:
      'Crea un lead manualmente. Necesita al menos teléfono o email. El teléfono va en formato internacional (+56912345678).',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        telefono: {
          type: 'string',
          description: 'Formato E.164, con el + y el código de país.',
        },
        email: { type: 'string' },
        origen: { type: 'string', description: 'De dónde salió el lead.' },
        campana: { type: 'string' },
      },
    },
    run: async (api, args) => {
      const creado = await api.post('/leads', {
        name: args.nombre,
        phone: args.telefono,
        email: args.email,
        source: args.origen,
        campaign: args.campana,
      });
      return { creado: lead(creado) };
    },
  },
  {
    name: 'actualizarLead',
    escritura: true,
    description:
      'Edita la ficha de un lead: datos de contacto, estado del embudo o calificación. Solo manda los campos que quieras cambiar.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        nombre: { type: 'string' },
        telefono: { type: 'string' },
        email: { type: 'string' },
        estado: { type: 'string', enum: ESTADOS },
        calificacion: { type: 'string', enum: CALIFICACIONES },
        motivoCalificacion: {
          type: 'string',
          description: 'Por qué esa calificación. Queda registrado.',
        },
      },
      required: ['leadId'],
    },
    run: async (api, args) => {
      const actualizado = await api.patch(`/leads/${args.leadId}`, {
        name: args.nombre,
        phone: args.telefono,
        email: args.email,
        status: args.estado,
        qualification: args.calificacion,
        qualificationReason: args.motivoCalificacion,
      });
      return { actualizado: lead(actualizado) };
    },
  },
  {
    name: 'agregarNota',
    escritura: true,
    description:
      'Deja una nota interna en el lead. La ve el equipo en el panel; el lead no.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        nota: { type: 'string' },
      },
      required: ['leadId', 'nota'],
    },
    run: async (api, args) => {
      const nota = await api.post(`/leads/${args.leadId}/notes`, {
        body: args.nota,
      });
      return { nota: { id: nota.id, texto: nota.body, cuando: nota.createdAt } };
    },
  },
  {
    name: 'verAgenda',
    escritura: false,
    description: 'Citas agendadas en un rango de fechas.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: ISO_HINT },
        hasta: { type: 'string', description: ISO_HINT },
      },
      required: ['desde', 'hasta'],
    },
    run: async (api, args) => {
      const citas = await api.get('/appointments', {
        from: args.desde,
        to: args.hasta,
      });
      return { total: citas.length, citas: citas.map(cita) };
    },
  },
  {
    name: 'agendarCita',
    escritura: true,
    description:
      'Agenda una cita con un lead. Falla si se choca con otra cita del mismo horario.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        titulo: { type: 'string' },
        inicio: { type: 'string', description: ISO_HINT },
        fin: { type: 'string', description: ISO_HINT },
        lugar: { type: 'string' },
        notas: { type: 'string' },
      },
      required: ['leadId', 'titulo', 'inicio', 'fin'],
    },
    run: async (api, args) => {
      const creada = await api.post('/appointments', {
        leadId: args.leadId,
        title: args.titulo,
        startAt: args.inicio,
        endAt: args.fin,
        location: args.lugar,
        notes: args.notas,
      });
      return { cita: cita(creada) };
    },
  },
  {
    name: 'cancelarCita',
    escritura: true,
    description: 'Cancela una cita ya agendada.',
    inputSchema: {
      type: 'object',
      properties: { citaId: { type: 'string' } },
      required: ['citaId'],
    },
    run: async (api, args) => {
      const cancelada = await api.post(`/appointments/${args.citaId}/cancel`);
      return { cita: cita(cancelada) };
    },
  },
  {
    name: 'listarAgentes',
    escritura: false,
    description:
      'Agentes configurados en la empresa: tipo, canales que atienden y cuál es el predeterminado.',
    inputSchema: { type: 'object', properties: {} },
    run: async (api) => {
      const agentes = await api.get('/agents');
      return {
        agentes: agentes.map((a) => ({
          id: a.id,
          nombre: a.name,
          tipo: a.type,
          descripcion: a.description,
          canales: a.channels,
          estadosQueAtiende: a.leadStates,
          esPredeterminado: a.isDefault,
          activo: a.isActive,
        })),
      };
    },
  },
  {
    name: 'verMetricas',
    escritura: false,
    description:
      'Métricas diarias ya calculadas de los últimos N días. Son los números reales guardados; no estimaciones.',
    inputSchema: {
      type: 'object',
      properties: {
        dias: {
          type: 'number',
          description: 'Cuántos días hacia atrás (1 a 90). Por defecto 7.',
        },
      },
    },
    run: async (api, args) => {
      const metricas = await api.get('/metrics', { days: args.dias });
      return {
        total: metricas.length,
        metricas: metricas.map((m) => ({
          fecha: m.date,
          agenteId: m.agentId,
          tipo: m.metricType,
          valor: m.value,
        })),
      };
    },
  },
];

/** Herramientas visibles según los permisos de la llave. */
export function toolsFor({ puedeEscribir }) {
  return TOOLS.filter((t) => puedeEscribir || !t.escritura);
}

/** Lo que va en `tools/list`: sin `run` ni campos internos. */
export function toolDescriptor(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}
