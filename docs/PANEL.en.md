# Panel guide

A tour of the panel, menu by menu.

English version of [`PANEL.md`](PANEL.md). The Spanish file is the one the
in-app help assistant reads, so keep both in sync when you change either.

For installing, registering the company and connecting lead intake, see
[`GUIA_DE_USO.md`](GUIA_DE_USO.md).

---

## Assistant (home screen)

The first thing you see. It is a chat where you can:

- **Ask how to use the panel.** It knows this guide and the real state of your
  account, so it answers with your agents and your integrations rather than in
  the abstract.
- **Create, edit or delete an agent.** It asks for whatever is missing and puts
  together a proposal. **It never acts on its own**: the proposal shows up with
  a button and nothing happens until you confirm. Deleting cannot be undone and
  its button is red.
- **Improve an agent's prompt.** It starts from the current prompt and proposes
  a new version with the change you asked for. This also needs your
  confirmation.
- **Upload a document to the knowledge base.** Drag a `.txt`, `.md`, `.csv` or
  `.json` file onto the chat and it gets indexed.

On every other screen the assistant stays available as a **floating bubble** in
the bottom right corner.

The assistant does not manage your leads or talk to your customers. The Inbox
is for that.

---

## Inbox

The list of live conversations, with each lead's latest message. It refreshes
on its own.

- **Search** by name, phone or email.
- **Filter** by funnel status.
- **New lead**: manual entry. Needs at least a phone or an email. It behaves
  like one that came in through the webhook: an agent is assigned and first
  contact is scheduled.
- **Import**: brings your base over from another CRM (see below).

### Lead detail

Opening a lead shows you:

- **The full thread**, with every message marked by who wrote it: customer,
  agent, operator (someone on your team) or system. Attachments the agent
  cannot open show up as `[El cliente envió un audio]`.
- **Replying yourself**: to write you first need **Take control**, which pauses
  the agent on that lead. **Return to agent** brings it back. The agent sees
  your messages marked as the operator's and neither repeats nor contradicts
  them.
- **Lead memory**: what the agent knows about this person and carries across
  conversations, even months later: what they want, objections, preferred
  hours, who decides. The agent writes it on its own, and **you can correct
  it**: edit the summary, add a fact or delete one that is wrong.
- **Internal notes**: for your team. The agent gets them as context and never
  reads them out to the customer.
- **Appointments** for the lead and the agent's **action log**: which tool it
  used and what came back.
- **Qualification** (see below) and contact details, editable.

Replying, taking control and writing notes require the OWNER or OPERADOR role.

### Lead qualification

Different from the funnel status: it measures **real interest and urgency**.
The agent sets it when a concrete signal shows up, not on every message.

| Level | What it means |
|---|---|
| FRÍO (cold) | No sign of real interest, or a far-off purchase |
| TIBIO (warm) | Genuine interest, but no clear budget or deadline |
| CALIENTE (hot) | Budget, urgency and decision power confirmed |

Hot is when offering a call makes sense.

### Importing leads from another CRM

**Import** button in the Inbox.

1. In your CRM look for "Export" and pick CSV. If it is in Excel, use *Save as
   > CSV*.
2. Upload the file. Up to **5,000 contacts at a time**; split it if you have
   more.
3. Review the **column mapping**: the system proposes which column is the name,
   the phone, the email and so on. Fix whatever is off. You need at least a
   phone or an email, otherwise there is nobody to contact.
4. Choose what happens with contacts that already exist and whether the agent
   should **message them once the import finishes**.

That last switch matters: **off**, the contacts are saved and nobody gets a
message. **On**, the agent starts conversations one per minute, and never with
the ones you import as closed (won or lost).

Nothing is imported until you confirm the mapping. When it finishes you get the
list of rows that could not be brought over and why.

---

## Calendar

Month view of appointments: the ones the agent books and the ones you book.

- **New appointment**: title, lead, date, time, place. The lead is searched by
  name or phone.
- It warns you when the slot **overlaps** another appointment.
- Cancelling an appointment means the lead **will not get the reminder**.

A lead's appointments also show on their record, and the agent sees them in its
context: it does not book one that already exists and confirms it if the
customer asks.

---

## Knowledge

What the agent is allowed to look up. It invents nothing beyond this: if it
cannot find the fact, it says so and offers to escalate.

Two kinds of content, and the difference matters:

- **Documents**: free text (services, FAQs, policies). They are split into
  chunks and indexed for meaning-based search. This is what answers open
  questions.
- **Facts**: key/value pairs for anything **exact and current**: prices, hours,
  policies. The value is JSON, for example `{"monto": 45000, "moneda": "CLP"}`.
  This is the only valid source for a figure.

Every figure the agent tells a customer has to come from here or from another
tool. If it cannot back it up, the message is blocked and the lead is escalated
to a person.

**Delete**: every document and every fact has its own button, with a
confirmation. Deleting stops the agent from using it right away, but the row
is kept for version history. **Show deleted** brings them back into view,
struck through.

**Ask the knowledge base**: test what the agent would retrieve for a question,
without spending a real conversation.

---

## Approval

Nothing reaches the knowledge base or the agent's behaviour without your
sign-off. Three queues:

- **Compliance**: moments where the agent broke one of its own rules in a real
  conversation, with the quote that shows it. Approving it files it as evidence
  for the next prompt proposal; on its own it changes nothing.
- **Knowledge gaps**: questions the agent could not answer, with how many times
  they were asked. You write the answer and approving it indexes it as an FAQ.
- **Examples**: good replies spotted in real conversations. Approving them lets
  the agent use them as a style reference in similar situations.

All of this is fed by an analysis that runs overnight on conversations that
have already ended.

---

## Prompts

Each agent's rules, in versions.

- You edit the prompt and **saving creates a new version and activates it right
  away**. There is no separate approval step: the edit is yours.
- **Reset to default prompt** goes back to the starting one for that agent
  type.
- The **weekly playbook** proposes new versions based on what you approved in
  Approval. They arrive **inactive**: you review and activate the one you want.

Careful when rewriting: the prompt carries safety rules (never invent figures,
use tools for prices, escalate when a fact is missing, debt-collection
compliance). Delete them and the agent stops following them.

---

## Metrics

Recent activity: leads, appointments, messages, escalations, and the day by day
breakdown.

**Recompute today** forces the calculation for the current day, which normally
happens overnight.

**Agents** also gives you metrics compared across agents.

---

## Agents

Who handles what, and how.

- **Type**: VENTAS (sales), COBRANZA (collections), SOPORTE (support),
  AGENDAMIENTO (scheduling) or CUSTOM. Sales and collections start with a
  specialised prompt; the rest with a generic base.
- **Description**: helps the classifier decide when to hand a lead over to it.
- **Routing**: which channels it handles and which funnel statuses. Empty means
  "any". The **default agent** gets whatever does not match another one.
- **Deactivating** is reversible: its leads are reassigned to the default
  agent. Deleting is not.
- **Compared metrics** and **handoffs** between agents, to see who hands over to
  whom.

### Per-agent follow-up

Optional. Anything you leave blank uses the company-wide setting. Useful so
collections and sales can have different cadences.

- **Channel ladder**: the order per attempt, comma separated. For example
  `email,whatsapp,whatsapp,email`.
- **Spacing between attempts**, in hours, and **first contact delay**, in
  minutes.
- **WhatsApp templates** by purpose: opening (first contact outside the 24-hour
  window), follow-up and reactivation (last attempt before closing).

**Collections agents: legal floor.** Under Chilean Law 19.496 (art. 37), the
system enforces limits that this configuration cannot override. You can be
stricter, never looser:

- By WhatsApp and email, at most 2 proactive contacts per calendar week, at
  least 48 hours apart.
- At most 1 proactive call per week.
- Only Monday to Saturday, excluding public holidays, from 8:00 to 20:00 in the
  lead's time, even if your business hours are wider. Collections calls always
  follow these hours, even when the debtor asks to be called at another time:
  the agent schedules the call for the first allowed moment.

Replying when the debtor writes is not a proactive contact, and neither is a
call the debtor asked for. If a follow-up would break a limit, it is postponed
automatically without using up an attempt.

---

## WhatsApp templates

WhatsApp only allows free text within **24 hours** of the customer's last
message. Outside that window you have to use a template approved by Meta.

- The **name** takes lowercase letters, numbers and underscores:
  `recordatorio_pago`.
- **Variables** are written `{{1}}`, `{{2}}`, … The system fills them with the
  lead's name and your company's name, in that order.
- Meta requires **examples** of each variable in order to review it.
- Approval is Meta's call, not ours: it usually takes from minutes to about 24
  hours. Use **Refresh** to check the status.

Only **approved** templates can be assigned to an agent.

---

## Integrations

Your own provider accounts. Secrets are stored encrypted and **never shown
back**.

- **WhatsApp**: Meta Cloud API directly, or YCloud as an intermediary.
- **Email**: for the agent's outbound mail.
- **Voice**: for calls.
- **CRM**: sends events to your CRM and lets the agent query it live.

**Webhook signing secret.** Every inbound channel needs one and it is
**mandatory**: without it, incoming messages are rejected. On Meta it is your
app's *App Secret*; on YCloud, the webhook endpoint secret, which is not the
API key; on Vapi, the *Server URL Secret*. If messages stopped arriving, check
this first.

**Test connection** verifies the credentials before you leave them in
production.

### MCP access

Create a key to talk to your account from Claude (Desktop or Code) in plain
language: look up leads and conversations, book appointments, leave notes,
check metrics. The key is shown **only once**. Step by step in the MCP guide,
in this same Help tab.

---

## Settings

The company's identity and operating rules.

- **Company ID**: the one that goes in the lead webhook, `X-Company-Id` header.
- **Time zone**: what the agent uses for dates, hours and follow-ups.
- **Business WhatsApp number** in E.164 format, for example `+56911111111`.
  YCloud uses it to route incoming messages to your company. The *Phone Number
  ID* field is only for Meta Cloud API directly: with YCloud, leave it empty.
- **Business hours**, as JSON. The agent does no follow-up outside them: it
  postpones until the next allowed time.
- **Agent voice**: a voice from the provider's catalogue, tone and language,
  and the greeting it opens calls with. The tone is written in plain language,
  for example "warm and direct, short sentences, no jargon".

---

## Help

This guide and the MCP one, with a section finder. The floating assistant
answers about the same things, but by asking.

It also has **Replay the tour**: the guided walkthrough that shows up the
first time you sign in, in case you want to go over it again or show it to
someone on your team.

---

## Platform

Only platform administrators see this, not customers. It lists the companies
using the app with what actually shows whether they activated: connected
channels, knowledge loaded, leads, messages in the last month, and how many
days since their last activity.

**Create demo** sets up an empty account with its default agent. It returns
the email, the password and the webhook secret **once**: copy them right
there. Leads and knowledge are loaded afterwards from that company's panel,
since they depend on who you are showing it to.

This screen **does not show conversations or lead data**: that is personal
information belonging to each company's own customers.

---

## My account

At the foot of the side menu, on your email address.

- **Change your password**. Changing it signs out every other open session for
  your user; the current one keeps going.
- If you forgot it, the sign-in screen has **Forgot your password?**: a link
  arrives by email and is valid for **one hour**.

---

## What the agent does on its own

So you know what to expect without having to watch the panel:

- **Replies** to incoming messages. It waits a few seconds before answering, on
  purpose: if the customer sends three messages in a row, it answers all of
  them at once instead of three times.
- **Follows up** on leads who do not reply, through that agent's channel
  ladder, respecting business hours, up to the attempt limit. After that it
  closes the lead as lost.
- **Books appointments** and sends reminders.
- **Escalates to a person** when it cannot resolve something, when the customer
  asks for it, or when it was about to state a figure it cannot back up. The
  lead stays paused until someone returns control.
- **Hands over to another agent** when the topic is their area, passing along a
  summary.
- **Respects what the customer asks**: if they say not to call, it cancels the
  scheduled call and does not offer it again.
