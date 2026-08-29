# erlc-bot

A public multi-server ER:LC + Discord moderation bot: modular slash/prefix commands
with typed args and rate limiting, a unified numbered case system, staff shifts,
Roblox↔Discord account linking, ban requests, automatic in-game logging, a
Claude-powered `ai` command, and a **web dashboard**. Data lives in **Postgres**.

## Setup

```bash
npm install
cp .env.example .env      # DISCORD_TOKEN, ANTHROPIC_API_KEY, DATABASE_URL
npm start                 # the bot
npm run web               # the dashboard (needs DISCORD_CLIENT_ID/SECRET, SESSION_SECRET)
```

`DATABASE_URL` is a Postgres connection string — get a free one at
[neon.tech](https://neon.tech). Tables are created automatically on first run.

Enable the **Message Content Intent** in the Discord Developer Portal → your app →
Bot. Invite with the `bot` + `applications.commands` scopes and permissions for
the moderation actions you want (Kick, Ban, Moderate Members, Manage Messages).

Deploying (Render + Neon, or a VPS): see [deploy/README.md](deploy/README.md).

On startup the bot registers slash commands. If `DEV_GUILD_ID` is set (or the bot
is in exactly one server) they register to that guild instantly; otherwise they
register globally (~1h to propagate).

## Commands

| Module | Commands |
|---|---|
| general | `ping`, `help`, `about`, `support`, `prefix`, `ai` (aliases `ask`, `chat`) |
| moderation | **ER:LC in-game actions** — `warn` `kick` `ban` `unban` `jail` `unjail` `note` `bolo`/`banreq`, generic `log <player> <type> <reason>`, `history`, `case <view\|reason\|type\|void>` |
| discord | **Discord-server actions** — `discord <kick\|ban\|unban\|timeout\|unmute\|softban\|warn\|history\|purge>` |
| erlc | `erlc <status\|players\|player\|staff\|queue\|joinlogs\|killlogs\|commandlogs\|modcalls\|bans\|vehicles\|pm\|hint\|message\|command\|ip>` |
| roblox | `roblox <lookup\|avatar>` |
| connections | `connections` (panel), `verify`, `unverify`, `whois` — link Discord ↔ Roblox |
| shifts | `shift <manage\|start\|end\|active\|time\|leaderboard\|activity\|admin>` (alias `duty`), `shifttype` |
| staff | `staff` — roles, on-duty, staff in-game |
| config | `config` (menu), `modtype` |

All moderation actions — Discord and ER:LC — create a **numbered case** in one shared
per-guild sequence. `/case view <n>` works regardless of platform. `warn`/`kick`/etc.
are shortcuts for `/log <player> <type>`; add your own types with `/modtype add`.

### Case storage

Every case is written to Postgres **before** the in-game/Discord action runs, keyed
by Roblox ID / Discord ID — so a case is never lost to a failed action or a name
change. `/history <player>` and `/discord history <member>` show the **full**
paginated record (Prev/Next buttons); `/case view <n>` opens any single case, and
the dashboard has a searchable case browser. Neon handles backups / point-in-time
recovery. The bot and dashboard share one database and stay in sync via Postgres
`LISTEN/NOTIFY`.

- **@mention** the bot or **DM** it with no command → routed to the AI.
- `ai reset` clears the channel's AI conversation history.
- Commands with subcommands work as `/erlc players` (slash) or `!erlc players` (prefix).
- Mod commands accept an in-game name, a Roblox username/ID, **or a linked `@discord-user`**.

### Automatic ER:LC logging

A background poller (default every 60s) watches the ER:LC API and posts new events
to whichever channels you set:

| `/config` setting | Posts |
|---|---|
| `join-log` | player joins / leaves |
| `kill-log` | kill logs |
| `ingame-log` | staff `:commands` run in the game |
| `modcall-log` | `!mod` calls (pings the staff role) |

First poll for a guild just sets a baseline — it won't backfill history. Tune with
`ERLC_POLL_SECONDS` in `.env`. These join the existing `modlog` (cases),
`cmdlog` (bot commands), and `banreq` channels — all cross-server capable.

### Sessions

`/session startup [message]` (alias `/ssu`) and `/session shutdown` (`/ssd`) post an
announcement to the `session-channel`, ping the `session-role`, and send a matching
`:h` hint in-game. Staff-gated.

### config (Manage Server)

Run **`/config`** with no options for an interactive menu — Discord role/channel
pickers and toggles for every setting except `prefix` and `erlc-key` (text-only, for
safety). Or set anything directly:

`config view` · `config prefix <p>` · `config ai on|off` ·
`config modlog #ch` · `config cmdlog #ch` · `config banreq #ch` ·
`config erlc-key <key>` · `config erlc-role @role` · `config erlc-admin-role @role` ·
`config shift-role @role` · `config disable <cmd>` · `config disable module:<name>` · `config enable …`

- **modlog** — each moderation case is posted here as an embed.
- **cmdlog** — every command run is logged here (who, what, where; `config` values redacted).
- **banreq** — pending ban requests with Approve/Deny buttons land here.
- Any channel may live in **another server the bot is in** (e.g. a dedicated logs server) — pass the channel ID.
- **erlc-role** = staff (all ER:LC/mod/shift commands). **erlc-admin-role** = senior
  (approve ban requests, `shift admin`, void others' cases). Manage Server bypasses both.

### Autocomplete

`/warn`, `/kick`, `/ban`, `/jail`, … and `/erlc pm` autocomplete the **player** field
from the live in-server player list (5 s cache). You can still type a name/ID that
isn't listed (e.g. to `ban` someone who already left).

### ER:LC integration

Each server links its own **private-server API key** (ER:LC settings → API):

```
!config erlc-key YOUR_KEY      ← run in a channel; the bot deletes your message
!config erlc-role @Staff       ← who may use erlc commands (Manage Server always can)
```

`erlc command` (raw in-game command passthrough) requires **Manage Server**. Without a
guild key set, the bot falls back to `ERLC_KEY` from `.env` if present. API base is
`https://api.erlc.gg/v1`; the command endpoint is rate-limited to 1 request / 5 s.

**IP allowlist:** read endpoints (`status`, `players`, logs…) work with just the
Server-Key, but **running in-game commands** (`:pm`, `:kick`, `:ban`, …) needs the
machine's public IP allowlisted by the ER:LC server owner at
<https://api.erlc.gg/server-owners>. Until then those actions fail with code `4000`
(the bot logs the case anyway with an "in-game command failed" note).

The bot prints its public IP on startup and `/erlc ip` shows it on demand. On a home
internet connection the IP changes periodically — for a stable setup, host the bot on
a VPS/cloud with a fixed IP, or apply to PRC for a global API key (`ERLC_GLOBAL_KEY`).

### Connections & staff

- `/verify <roblox-username>` → put the phrase in your Roblox profile "About" →
  `/verify` again to confirm. `/whois @user` or `/whois <roblox-name>` shows the link.
- Once linked, `/warn @discorduser reason` etc. resolve the Roblox account automatically.
- **Shifts**: `/shift start` / `/shift end`, `/shift active`, `/shift time [@user] [30d]`,
  `/shift leaderboard [30d]`, `/shift admin add|remove|wipe @user [1h30m]` (senior).
  Set `config shift-role @role` to auto-assign an on-duty role.
- **Ban requests**: `/banreq <player> <reason>` posts an embed with Approve/Deny buttons
  to the `banreq` channel; a senior staffer approving runs the `:ban` and opens the case.

Roblox lookups (`roblox lookup <username|id>`) use the public Roblox web APIs — no key.

### ER:LC moderation & the case system

`warn` / `kick` / `ban` / `unban` / `jail` / `unjail` operate on the **game server**,
not Discord. Each one:

1. Resolves the player — the live in-server player list first, then a Roblox
   username/ID lookup (so you can `ban` someone who has left).
2. Writes a **case** (`roblox_moderations` table) keyed by Roblox user ID:
   type, reason, moderator, timestamp, executed-flag, void-flag.
3. PMs the player in-game (`[SERVER] You were warned by … Reason: … (Case #12)`) — skipped if offline.
4. Runs the enforcement command (`:kick` / `:ban` / `:jail` …), spaced to respect the
   1-command / 5 s API limit.

`kick`, `jail`, `unjail` require the player to be **in the server**; `warn`, `ban`,
`unban`, `note` work offline (a warn on an offline player is still logged, just not delivered).

- `history <player>` — full case list + totals by type, so mods can gauge escalation.
- `note <player> <text>` — record-only, no in-game action.
- `case view <#|last|slast>` — inspect a case (`last` = your last, `slast` = server's last).
- `case reason` / `case type` / `case void` — edit; the issuing mod or Manage Server.
  Voided cases stay in `history` (struck through) but don't count toward totals.

## Architecture

```
src/
  index.js              bot entry — schema init, config warm, event wiring
  config.js             env parsing + requireConfig()
  lib/
    pg.js               Postgres pool, schema, LISTEN/NOTIFY helpers
    CommandManager.js   loads commands/, registers slash cmds, dispatches both paths
    Context.js          unified reply/args/permissions/config for message & interaction
    args.js             typed arg parser + slash-option builder + usage strings
    ratelimit.js        fixed-window buckets (user / guild / global)
    guildConfig.js      per-guild settings — sync cache + async writes, NOTIFY sync
    botGuilds.js        bot_guilds table (which servers the bot is in — for the dashboard)
    modlog.js           posts mod actions / command log to configured channels
    ai.js               Anthropic client + per-channel history
    erlc.js             ER:LC API client (api.erlc.gg/v1) + serialized command queue
    erlcModeration.js   player resolution (name / Roblox / linked @user) + notify
    erlcPoller.js       background loop → auto-posts join/kill/command/modcall logs
    roblox.js           public Roblox web API client (lookup, groups, avatar)
    cases.js            unified mod_cases store (create/void/edit/stats)
    modTypes.js         custom per-guild moderation types
    links.js            Roblox↔Discord links + pending verifications
    shifts.js           shift types + clock/leaderboard/adjust store
    banRequests.js      ban-request store
    components.js       button/select/modal interaction handler registry
    settingsMenu.js     interactive /config menu (role/channel pickers, toggles)
    historyView.js      paginated case-history view (shared by /history + /discord history)
    autocomplete.js     slash autocomplete providers (players, mod types, shift types)
    publicIp.js         cached public-IP lookup (for the ER:LC allowlist)
web/
  server.js             Express dashboard — Discord OAuth, config/cases/shifts/banreqs
  discord.js            Discord API helpers (OAuth, guild channels/roles)
  auth.js               JWT cookie sessions
  views/  public/       EJS templates + CSS
    checks.js           reusable command gates (erlcStaff, erlcAdmin, manageGuild)
    util.js             duration parsing, chunking, tokenizing
  commands/<module>/<name>.js       (_shared.js files are not loaded as commands)
```

### Subcommands

A command file exports either `execute` (leaf) or a `subcommands` map:

```js
export default {
  name: "erlc", module: "erlc", guildOnly: true,
  check: erlcStaff,                       // parent gate, runs for every subcommand
  subcommands: {
    players: { description: "...", defer: true, execute: async (ctx) => { ... } },
    command: { description: "...", check: manageGuild, args: [...], execute: ... },
  },
};
```

Parent `module` / `guildOnly` / `check` apply to all subcommands; a subcommand may
add its own `check`, `args`, `ratelimit`, `defer`, `ephemeral`.

### Adding a command

Drop a file in `src/commands/<module>/`:

```js
export default {
  name: "slap",
  description: "Slap someone.",
  module: "fun",
  guildOnly: true,
  aliases: ["hit"],
  userPermissions: ["SendMessages"],   // PermissionFlagsBits keys
  botPermissions: [],
  ratelimit: { scope: "user", uses: 3, per: 10_000 },
  args: [
    { name: "target", type: "member", required: true, description: "Who" },
    { name: "with", type: "text", required: false, default: "a trout" },
  ],
  async execute(ctx) {
    await ctx.reply(`${ctx.author} slaps ${ctx.args.target} with ${ctx.args.with}.`);
  },
};
```

Arg types: `string`, `text` (rest-of-line), `int`, `number`, `bool`, `user`,
`member`, `role`, `channel`, `duration` (`10m`, `2h30m`). Restart to pick up new
commands (slash re-registers automatically).
