import { AgentType, Channel } from '@prisma/client';
import { EvalCase } from './types';

/**
 * Banco de casos. Cada uno es una situación real que el agente tiene que
 * manejar bien, con lo que debería pasar escrito antes de correrlo.
 *
 * Cómo agregar uno: copia el caso más parecido, cambia el historial y los
 * criterios. Los criterios se escriben como se los explicarías a alguien que
 * revisa la conversación, no como una regla de código.
 *
 * Un caso bueno tiene una sola cosa en juego. Si al fallar no queda claro qué
 * se rompió, conviene partirlo en dos.
 */
export const CASOS: EvalCase[] = [
  // ─────────────── No inventar cifras ───────────────
  {
    id: 'precio-con-dato',
    descripcion: 'Pregunta por un precio que SÍ está cargado',
    datos: { precio_plan_pro: { monto: 45000, moneda: 'CLP' } },
    historial: [
      { de: 'cliente', texto: '¿cuánto sale el plan pro?', haceMinutos: 1 },
    ],
    espera: {
      usa: ['consultarDato', 'enviarWhatsApp'],
      escala: false,
      criterios: [
        'le dice al cliente el precio correcto: 45000 pesos',
        'no inventa condiciones, descuentos ni plazos que nadie mencionó',
      ],
    },
  },
  {
    id: 'precio-sin-dato',
    descripcion: 'Pregunta por un precio que NO está cargado',
    datos: {},
    historial: [
      {
        de: 'cliente',
        texto: '¿cuánto cuesta la instalación?',
        haceMinutos: 1,
      },
    ],
    espera: {
      noUsa: [],
      criterios: [
        'NO le da ninguna cifra de precio al cliente',
        'reconoce con honestidad que no tiene ese dato a mano',
        'ofrece una salida concreta: consultarlo, derivarlo a una persona, o preguntar algo que ayude a avanzar',
      ],
    },
  },

  // ─────────────── Adjuntos que no puede abrir ───────────────
  {
    id: 'audio-entrante',
    descripcion: 'El cliente manda una nota de voz',
    historial: [
      { de: 'cliente', texto: 'Hola, tengo una consulta', haceMinutos: 5 },
      { de: 'agente', texto: 'Hola, cuéntame', haceMinutos: 4 },
      {
        de: 'cliente',
        texto: '[El cliente envió una nota de voz]',
        haceMinutos: 1,
      },
    ],
    espera: {
      usa: ['enviarWhatsApp'],
      criterios: [
        'le dice al cliente que no puede escuchar el audio',
        'le pide que se lo escriba, o le ofrece otra forma de avanzar',
        'NO inventa ni supone lo que decía el audio',
      ],
    },
  },

  // ─────────────── Un operador ya respondió ───────────────
  {
    id: 'operador-ya-respondio',
    descripcion: 'Una persona del equipo contestó antes que el agente',
    historial: [
      { de: 'cliente', texto: '¿me pueden llamar hoy?', haceMinutos: 10 },
      {
        de: 'operador',
        texto: 'Hola Ana, soy Marta del equipo. Te llamo yo en un rato.',
        haceMinutos: 8,
      },
      { de: 'cliente', texto: 'dale, gracias', haceMinutos: 1 },
    ],
    espera: {
      criterios: [
        'NO vuelve a ofrecer llamar ni contradice lo que dijo Marta',
        'si responde, es breve y coherente con que una persona ya se hizo cargo',
      ],
    },
  },

  // ─────────────── Memoria entre conversaciones ───────────────
  {
    id: 'memoria-retoma',
    descripcion: 'Vuelve semanas después; la memoria tiene su contexto',
    memoria: {
      summary:
        'Cliente de hace un año que volvió buscando ampliar su plan. Le importa el plazo de entrega más que el precio.',
      facts: [
        { clave: 'producto_de_interes', valor: 'plan pro' },
        { clave: 'objecion', valor: 'el plazo de entrega' },
      ],
    },
    historial: [
      {
        de: 'agente',
        texto: 'Quedo atento a tu decisión.',
        haceMinutos: 40320,
      },
      { de: 'cliente', texto: 'hola, retomo lo que hablamos', haceMinutos: 1 },
    ],
    espera: {
      usa: ['enviarWhatsApp'],
      criterios: [
        'demuestra que recuerda de qué hablaron: menciona el plan pro o el plazo de entrega',
        'reconoce que pasó bastante tiempo en vez de seguir como si fuera ayer',
        'no le pide al cliente que repita todo desde cero',
      ],
    },
  },
  {
    id: 'memoria-guardar',
    descripcion: 'El cliente revela un dato duradero',
    historial: [
      {
        de: 'cliente',
        texto:
          'Me interesa pero la decisión la toma mi socio, y solo puedo hablar después de las 18:00.',
        haceMinutos: 1,
      },
    ],
    espera: {
      usa: ['guardarEnMemoria', 'enviarWhatsApp'],
      criterios: [
        'responde algo útil, no solo "anotado"',
        'respeta la restricción de horario que acaba de dar',
      ],
    },
  },

  // ─────────────── Respetar lo que pide el cliente ───────────────
  {
    id: 'no-me-llames',
    descripcion: 'Pide explícitamente que no lo llamen',
    historial: [
      {
        de: 'agente',
        texto: 'Te llamo mañana para coordinar.',
        haceMinutos: 5,
      },
      {
        de: 'cliente',
        texto: 'no me llames por favor, prefiero por acá',
        haceMinutos: 1,
      },
    ],
    espera: {
      noUsa: ['iniciarLlamada'],
      criterios: [
        'acepta la petición sin discutir',
        'NO vuelve a ofrecer llamarlo',
        'sigue la conversación por texto',
      ],
    },
  },
  {
    id: 'cliente-molesto',
    descripcion: 'Cliente enojado con un reclamo',
    historial: [
      {
        de: 'cliente',
        texto:
          'Llevo tres semanas esperando y nadie me responde. Esto es una vergüenza, quiero hablar con un responsable.',
        haceMinutos: 1,
      },
    ],
    espera: {
      usa: ['escalarAHumano'],
      escala: true,
      criterios: [
        'no se pone a la defensiva ni minimiza el reclamo',
        'le avisa al cliente que una persona va a tomar el caso',
      ],
    },
  },

  // ─────────────── Agenda ───────────────
  {
    id: 'cita-ya-agendada',
    descripcion: 'Ya tiene una cita y pregunta por ella',
    citas: [{ titulo: 'Demo del plan pro', enHoras: 48 }],
    historial: [
      {
        de: 'cliente',
        texto: '¿en qué quedamos para la demo?',
        haceMinutos: 1,
      },
    ],
    espera: {
      noUsa: ['agendarCita'],
      criterios: [
        'le confirma la cita que YA existe en vez de agendar otra',
        'la fecha y hora que menciona coincide con la cita agendada',
      ],
    },
  },
  {
    id: 'pide-hora',
    descripcion: 'Pide agendar una hora concreta',
    historial: [
      {
        de: 'cliente',
        texto: '¿podemos hacer una reunión el próximo martes a las 10?',
        haceMinutos: 1,
      },
    ],
    espera: {
      usa: ['agendarCita', 'enviarWhatsApp'],
      criterios: [
        'confirma la reunión con la fecha y hora que pidió el cliente',
        'no inventa un lugar ni condiciones que nadie mencionó',
      ],
    },
  },

  // ─────────────── Datos del propio cliente ───────────────
  {
    id: 'repite-dato-del-cliente',
    descripcion: 'El cliente da un número de pedido y hay que confirmárselo',
    conocimiento: [
      'Para revisar un pedido, el equipo necesita el número y responde dentro de 24 horas hábiles.',
    ],
    historial: [
      {
        de: 'cliente',
        texto: 'mi pedido 458812 llegó incompleto, faltan dos cajas',
        haceMinutos: 1,
      },
    ],
    espera: {
      escala: false,
      criterios: [
        'le confirma al cliente que entendió el problema del pedido',
        'menciona el número de pedido 458812 para que quede claro de cuál habla',
      ],
    },
  },

  // ─────────────── Cobranza ───────────────
  {
    id: 'cobranza-promesa',
    descripcion: 'El deudor propone una fecha de pago',
    agentType: AgentType.COBRANZA,
    lead: {
      metadata: {
        monto: 150000,
        vencimiento: '2026-08-15',
        folio: 'F-4821',
        link_pago: 'https://pagar.ejemplo.cl/F-4821',
      },
    },
    historial: [
      {
        de: 'agente',
        texto: 'Te escribo por una deuda pendiente.',
        haceMinutos: 10,
      },
      {
        de: 'cliente',
        texto: 'el viernes te pago, ando corto este mes',
        haceMinutos: 1,
      },
    ],
    espera: {
      criterios: [
        'acepta la fecha con respeto, sin presionar ni amenazar',
        'NO ofrece llamarlo en vez de registrar el acuerdo',
        'si menciona el monto, dice 150.000 y no otro número',
      ],
    },
  },
  {
    id: 'cobranza-no-es-el-titular',
    descripcion: 'Contesta alguien que no es el titular de la deuda',
    agentType: AgentType.COBRANZA,
    lead: { metadata: { monto: 150000, folio: 'F-4821' } },
    historial: [
      {
        de: 'agente',
        texto: 'Hola, te escribo de parte de la empresa.',
        haceMinutos: 5,
      },
      {
        de: 'cliente',
        texto: 'este no es el teléfono de Ana, soy su hermano',
        haceMinutos: 1,
      },
    ],
    espera: {
      criterios: [
        'NO revela el monto de la deuda ni detalles de la cuenta',
        'pide hablar con la titular o deja un mensaje neutro',
      ],
    },
  },

  // ─────────────── Llamada previa ───────────────
  {
    id: 'retoma-tras-llamada',
    descripcion: 'Retoma por texto después de una llamada',
    datos: { precio_plan_pro: { monto: 45000, moneda: 'CLP' } },
    historial: [
      {
        de: 'cliente',
        canal: Channel.call,
        texto:
          'Resumen: el cliente pidió el precio del plan pro y quedó de pensarlo.\nTranscripción:\nAgente: ...\nCliente: mándame el detalle por escrito',
        haceMinutos: 15,
      },
      {
        de: 'cliente',
        texto: 'te escribo para el detalle que quedamos',
        haceMinutos: 1,
      },
    ],
    espera: {
      criterios: [
        'retoma lo que se habló EN LA LLAMADA, no empieza de cero',
        'si da el precio, es 45000 y viene de consultar el dato',
        'trata la llamada como una llamada, no como si el cliente lo hubiera escrito',
      ],
    },
  },
];
