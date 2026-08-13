# Panel · Agentes Lead (frontend)

SPA del panel mínimo (Fase 7A): React + Vite + TailwindCSS, auth JWT contra el
backend NestJS, con roles por empresa (`OWNER`, `OPERADOR`, `SOLO_LECTURA`).

Proyecto **independiente** del backend (su propio `pnpm-workspace.yaml`).

## Qué incluye

- **Login** y selector de empresa (cuentas con acceso a varias).
- **Bandeja de conversaciones**: leads con estado, canal y último mensaje;
  filtro por estado; polling corto (4s).
- **Detalle del lead**: hilo cronológico marcando quién habló (cliente / agente
  / operador / sistema), datos de contacto y embudo.
- **Intervención humana**: tomar/devolver el control (pausa/reactiva al agente)
  y responder manualmente desde el panel.
- **Registro de acciones del agente**: qué herramienta usó, con qué parámetros
  y qué devolvió.

## Puesta en marcha

Requiere el backend corriendo en `http://localhost:3000`.

```bash
cd frontend
pnpm install
cp .env.example .env   # VITE_API_URL vacío usa el proxy de Vite (dev)
pnpm dev               # http://localhost:5173
```

En dev, Vite proxya `/auth` y `/panel` al backend (mismo origen, sin CORS). El
backend además habilita CORS para desplegar el panel en otro origen en prod.

### Crear el primer usuario

El panel no tiene registro autoservicio (eso es Fase 7B). El primer usuario se
crea con el secreto HMAC de la empresa (`webhookSecret` que devuelve
`POST /companies`), firmando el body:

```bash
BODY='{"email":"tu@correo.cl","password":"secreto123","name":"Tu Nombre","role":"OWNER"}'
SIG=$(node -e "console.log(require('crypto').createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$SECRET" "$BODY")
curl -X POST http://localhost:3000/auth/users \
  -H 'Content-Type: application/json' \
  -H "X-Company-Id: $COMPANY_ID" -H "X-Signature: $SIG" -d "$BODY"
```

Luego entra al panel con ese email/contraseña.

## Comandos

```bash
pnpm dev       # desarrollo
pnpm build     # tsc + vite build → dist/
pnpm preview   # servir el build
```
