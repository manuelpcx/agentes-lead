# Connect your account to Claude

MCP ([Model Context Protocol](https://modelcontextprotocol.io)) is the standard an assistant like Claude uses to connect to external systems. With it, Claude can **query and operate your account in plain language**, from the same window where you already work:

> — *Which hot leads haven't I contacted yet?* — *Show me the conversation with Ana Pérez.* — *Book the visit with Bruno on Friday at 11.* — *How did the week go?*

It does not replace the panel: it is another door into the same thing, useful when you are asking and deciding rather than clicking.

**You need** Node 18 or newer on your computer and to be an **OWNER** of the company. Nothing else: the server has no dependencies to install.

---

## 1. Create the key

Go to **Integrations → MCP access → Create key**.

Give it a name that tells you *what* is using it (`Claude desktop`, `Claude laptop`) and pick the permissions:

| Permission | Can |
|---|---|
| **Read only** (recommended to start) | Query leads, conversations, calendar, agents and metrics. |
| **Read and write** | All of the above + create leads, edit records, leave internal notes and book or cancel appointments. |

> ⚠️ The key is shown **only once**. We store just its fingerprint, so it cannot be looked up again. Copy it right away; if you lose it, revoke it and create another. Having several is fine.

When you create it, the panel shows the config block **ready to paste**, with the key and URL already filled in. Open it with *"Show the config, ready to paste"* and continue with that copied.

---

## 2. Configure your client

### Claude Desktop

Edit the `claude_desktop_config.json` file:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentes-lead": {
      "command": "node",
      "args": ["C:\\path\\to\\agentes-lead\\mcp\\server.mjs"],
      "env": {
        "AGENTES_LEAD_URL": "https://your-api.up.railway.app",
        "AGENTES_LEAD_API_KEY": "ale_the_key_you_copied"
      }
    }
  }
}
```

On Windows, paths need **double backslashes** or forward slashes: a single backslash breaks the JSON. Save and **restart Claude Desktop** — the config is only read at startup.

### Claude Code

The same block in an `.mcp.json` at the project root, or as one line:

```bash
claude mcp add agentes-lead --env AGENTES_LEAD_URL=https://your-api.up.railway.app --env AGENTES_LEAD_API_KEY=ale_... -- node /path/to/agentes-lead/mcp/server.mjs
```

### Variables

| Variable | What it is | Default |
|---|---|---|
| `AGENTES_LEAD_API_KEY` | The key from step 1. **Required.** | — |
| `AGENTES_LEAD_URL` | API base. The one shown in the config block. | `http://localhost:3000` |

---

## 3. Check that it worked

Ask it: **"use estadoConexion"**. It should answer with your company name, your time zone and the key's permissions. If that works, everything else works.

---

## 4. What you can ask for

**Review the pipeline**

- *How many leads do I have at each stage?*
- *Show me the hot leads that are in conversation.*
- *Find Ana Pérez's lead and tell me what they talked about.*
- *Is anyone waiting for a human to reply?*

**Operate** (needs a read-and-write key)

- *Create a lead: Carla Soto, +56933333333, came from Instagram.*
- *Mark Bruno's lead as closed won.*
- *Leave a note on Ana's lead: asked for an invoice under the company name.*
- *Book a demo with Diego on Thursday 3 to 4 pm over Meet.*
- *Cancel tomorrow's appointment with Carla.*

**Understand how the business is doing**

- *How did the last 30 days go?*
- *Which agents do I have configured and which one answers by default?*
- *What do I have booked this week?*

The metrics it returns are **the numbers already computed and stored**, not estimates. If you ask for something it cannot work out from those, it will say so instead of making it up.

---

## 5. Available tools

| Tool | What it does | Needs write |
|---|---|---|
| `estadoConexion` | Connected company, time zone and key permissions | — |
| `listarLeads` | Lists leads with their last message; filters by status and searches by text | — |
| `verLead` | Full record: data, conversation, appointments and internal notes | — |
| `listarAgentes` | Configured agents, channels they handle and which is the default | — |
| `verAgenda` | Appointments between two dates | — |
| `verMetricas` | Daily metrics for the last N days (1 to 90, 7 by default) | — |
| `crearLead` | Manual creation. Needs a phone or an email | yes |
| `actualizarLead` | Edits contact data, pipeline status or qualification | yes |
| `agregarNota` | Internal note on the lead (the team sees it, the lead does not) | yes |
| `agendarCita` | Books an appointment. Fails if it overlaps another | yes |
| `cancelarCita` | Cancels a booked appointment | yes |

With a **read-only** key, the write tools do not even appear in the catalog: Claude cannot see them, so it does not try to use them.

**Dates**: if something lands at an unexpected time, check that your company time zone is right under **Settings**.

---

## 6. What it cannot do

**It cannot send a message to a person.** It does not reply on WhatsApp, does not send email, does not start calls. That is deliberate, not a missing feature: at the other end there is a language model running on your computer, and malicious text planted in a lead's record must not end up as a message to one of your customers. Those actions happen in the panel, where a person is looking before hitting send.

It also does not expose sensitive configuration (webhook secrets, WhatsApp or voice credentials), user administration, or anything belonging to other companies.

---

## 7. Security

- **Only the fingerprint is stored.** Not even we can read your key after it is created; the panel shows only the prefix so you can recognize it.
- **One key per client.** If you use Claude on two computers, create two keys: that way you can revoke one without cutting off the other.
- **Read only by default.** Raise the permissions when you actually need them.
- **Revoking is immediate.** Whatever client is using it loses access on its next request. The key is not deleted: the record of it having existed, and when it stopped working, stays.
- **"Last used"** gives away a forgotten key that is still getting in.
- Everything the key does is recorded in the **audit log under whoever issued it**.
- The key sits **in plain text in your client's config file**. Treat that file like a password: don't commit it to a repository or send it over chat.

---

## 8. Common problems

| Symptom | Cause / fix |
|---|---|
| The server does not show up in the client | Malformed JSON (a trailing comma, an unescaped backslash on Windows) or you did not restart the client after editing it. |
| *"Falta AGENTES_LEAD_API_KEY"* | The `env` block never reached the process: check that it is **inside** the server object, not outside. |
| *"La llave de API no es válida…"* | The key was copied wrong (a stray space?), was revoked, or points at a different installation than the one that issued it. |
| *"Esa llave no tiene permiso…"* | It is read-only and you asked it to write. Create a read-and-write key. |
| Only query tools appear | Same as above: the key is read-only. That is the expected behaviour. |
| *"No se pudo conectar con …"* | The URL points at `localhost` but your API is elsewhere (or the service is down). |
| *"La API no respondió en 15s"* | Server asleep or overloaded. Retry; if it keeps happening, let us know. |
| Appointments land at the wrong time | Check the company time zone under **Settings**. |
