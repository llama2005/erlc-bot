import { EmbedBuilder } from "discord.js";
import { FLAGS, setFlag, clearFlag, listFlagRows, isEnabled } from "../../lib/flags.js";
import { COLORS, ok, err } from "../../lib/style.js";

const ownerOnly = (ctx) => (ctx.isOwner ? true : "This command is restricted to the bot operators.");
const SCOPES = ["global", "guild", "user"];

export default {
  name: "flags",
  description: "Feature flags (bot operators only).",
  module: "config",
  aliases: ["flag", "featureflags"],
  check: ownerOnly,
  defaultSubcommand: "list",
  subcommands: {
    list: {
      description: "Show every flag and its current state.",
      check: ownerOnly,
      defer: true,
      async execute(ctx) {
        const rows = listFlagRows();
        const lines = Object.entries(FLAGS).map(([name, meta]) => {
          const overrides = rows
            .filter((r) => r.name === name)
            .map((r) => `${r.scope}${r.target ? `:${r.target}` : ""}=${r.enabled == null ? `${r.rollout_pct}%` : r.enabled ? "on" : "off"}`);
          return `**${name}** — ${meta.description}\n> default: ${meta.default ? "on" : "off"}${overrides.length ? ` · ${overrides.join(", ")}` : ""}`;
        });
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Feature flags").setDescription(lines.join("\n\n"))] });
      },
    },
    set: {
      description: "Force a flag on or off for a scope.",
      check: ownerOnly,
      defer: true,
      args: [
        { name: "name", type: "string", required: true, description: "Flag name" },
        { name: "scope", type: "string", required: true, description: "global | guild | user", choices: SCOPES },
        { name: "state", type: "string", required: true, description: "on | off", choices: ["on", "off"] },
        { name: "target", type: "string", required: false, description: "guild/user id (omit for global)" },
      ],
      async execute(ctx) {
        const { name, scope, state } = ctx.args;
        if (!FLAGS[name]) return ctx.reply({ content: err(`Unknown flag \`${name}\`. See \`/flags list\`.`), ephemeral: true });
        if (scope !== "global" && !ctx.args.target) return ctx.reply({ content: err("A target id is required for guild/user scope."), ephemeral: true });
        await setFlag(name, scope, ctx.args.target || "", { enabled: state === "on" });
        await ctx.reply(ok(`\`${name}\` is now **${state}** for ${scope}${ctx.args.target ? ` \`${ctx.args.target}\`` : ""}.`));
      },
    },
    rollout: {
      description: "Set a global percentage rollout for a flag (0 = off, 100 = everyone).",
      check: ownerOnly,
      defer: true,
      args: [
        { name: "name", type: "string", required: true, description: "Flag name" },
        { name: "percent", type: "int", required: true, description: "0-100" },
      ],
      async execute(ctx) {
        const { name, percent } = ctx.args;
        if (!FLAGS[name]) return ctx.reply({ content: err(`Unknown flag \`${name}\`.`), ephemeral: true });
        const pct = Math.max(0, Math.min(100, percent));
        await setFlag(name, "global", "", { enabled: null, rolloutPct: pct });
        await ctx.reply(ok(`\`${name}\` global rollout set to **${pct}%**.`));
      },
    },
    clear: {
      description: "Remove a flag override (back to its default).",
      check: ownerOnly,
      defer: true,
      args: [
        { name: "name", type: "string", required: true, description: "Flag name" },
        { name: "scope", type: "string", required: true, description: "global | guild | user", choices: SCOPES },
        { name: "target", type: "string", required: false, description: "guild/user id" },
      ],
      async execute(ctx) {
        await clearFlag(ctx.args.name, ctx.args.scope, ctx.args.target || "");
        await ctx.reply(ok(`Cleared \`${ctx.args.name}\` override for ${ctx.args.scope}.`));
      },
    },
    check: {
      description: "What is a flag's state for a guild/user right now?",
      check: ownerOnly,
      defer: true,
      args: [
        { name: "name", type: "string", required: true, description: "Flag name" },
        { name: "guild", type: "string", required: false, description: "guild id" },
        { name: "user", type: "string", required: false, description: "user id" },
      ],
      async execute(ctx) {
        const on = isEnabled(ctx.args.name, { guildId: ctx.args.guild, userId: ctx.args.user });
        await ctx.reply(`\`${ctx.args.name}\` → **${on ? "enabled" : "disabled"}**`);
      },
    },
  },
};
