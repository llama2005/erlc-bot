// Builds the data the /guide page renders: the full command reference (pulled
// straight from the command files so it can't drift) plus the curated section
// copy. Loaded once, lazily, and cached — the web process never needs a client.
import { CommandManager } from "../src/lib/CommandManager.js";
import { NODES } from "../src/lib/permissions.js";

// Order + one-line blurb for each command module.
const MODULES = [
  ["general", "Everyday commands", "Anyone can run these. No setup required."],
  ["moderation", "ER:LC moderation", "Every punishment written to a permanent, numbered case keyed to the Roblox account. Moderate in-game as normal, then /log it — or use /warn /kick /ban /jail to have the bot carry the action out for you."],
  ["erlc", "ER:LC server control", "Talk to your ER:LC private server — status, players, logs, in-game messages, sessions and priority timers."],
  ["discord", "Discord moderation", "Moderate the Discord server itself. Bans/kicks/timeouts done here are logged as cases too."],
  ["shifts", "Shifts & accountability", "Staff clock in/out, leaderboards, weekly quotas and leave-of-absence requests."],
  ["connections", "Account linking", "Link a Roblox account to a Discord account. The link is global — it works in every server that has the bot."],
  ["roblox", "Roblox lookups", "Look up any Roblox user's profile or avatar."],
  ["staff", "Staff overview", "One command that shows your staff roles, who's on duty and who's in-game."],
  ["utility", "Utilities", "Announcements, embeds, polls, tickets and reaction-role panels."],
  ["config", "Setup & configuration", "Server owners and admins only. Everything here is also on the dashboard."],
];

// Friendly label for each permission node (matches src/lib/permissions.js NODES).
const PERM_LABELS = {
  "case.view": "Staff",
  "case.manage": "Admin",
  "mod.warn": "Staff",
  "mod.kick": "Staff",
  "mod.jail": "Staff",
  "mod.ban": "Ban permission",
  "mod.banreq": "Staff",
  "mod.banreq.approve": "Admin",
  "erlc.read": "Staff",
  "erlc.message": "Staff",
  "erlc.command": "Admin",
  session: "Staff",
  "shift.self": "Staff",
  "shift.admin": "Admin",
  config: "Manage Server",
};

function argSig(args = []) {
  return args
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(" ");
}

let cache = null;

export async function getGuideData() {
  if (cache) return cache;
  const mgr = new CommandManager(null);
  await mgr.load();
  const all = [...mgr.commands.values()];

  const sections = MODULES.map(([key, title, blurb]) => {
    const commands = all
      .filter((c) => (c.module || "general") === key)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        name: c.name,
        description: c.description || "",
        aliases: c.aliases || [],
        guildOnly: !!c.guildOnly,
        perm: c.permission ? PERM_LABELS[c.permission] || c.permission : null,
        sig: argSig(c.args),
        subs: c.subcommands
          ? Object.entries(c.subcommands).map(([name, s]) => ({
              name,
              description: s.description || "",
              perm: s.permission ? PERM_LABELS[s.permission] || s.permission : null,
              sig: argSig(s.args),
              isDefault: c.defaultSubcommand === name,
            }))
          : [],
      }));
    return { key, title, blurb, commands };
  }).filter((s) => s.commands.length);

  cache = {
    sections,
    total: all.length,
    nodes: Object.entries(NODES).map(([node, desc]) => ({ node, desc })),
  };
  return cache;
}
