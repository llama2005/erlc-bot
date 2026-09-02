import { EmbedBuilder } from "discord.js";
import { NODES, getPermGroups, upsertPermGroup, deletePermGroup } from "../../lib/permissions.js";
import { COLORS, okEmbed, err } from "../../lib/style.js";

const ALL_NODES = Object.keys(NODES);

function parseNodes(input) {
  const raw = input.trim().toLowerCase();
  if (raw === "all" || raw === "*") return ["*"];
  const wanted = raw.split(/[\s,]+/).filter(Boolean);
  const bad = wanted.filter((n) => n !== "*" && !ALL_NODES.includes(n));
  return { nodes: wanted, bad };
}

export default {
  name: "permgroup",
  description: "Fine-grained permission groups — map a role to specific bot capabilities.",
  module: "config",
  guildOnly: true,
  ephemeral: true,
  aliases: ["perms", "permissions"],
  permission: "config",
  subcommands: {
    list: {
      description: "Show permission groups and what each grants.",
      async execute(ctx) {
        const groups = await getPermGroups(ctx.guild.id);
        const cfg = ctx.config;
        const embed = new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("Permission groups")
          .setDescription(
            [
              cfg.erlcAdminRole ? `**Built-in admin:** <@&${cfg.erlcAdminRole}> — everything except \`config\`` : null,
              cfg.erlcStaffRole ? `**Built-in staff:** <@&${cfg.erlcStaffRole}> — the standard staff bundle` : null,
              "_Manage Server / server owner always have everything._",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        for (const g of groups) {
          embed.addFields({
            name: `${g.name} — <@&${g.role_id}>`,
            value: g.nodes.includes("*") ? "**all permissions**" : g.nodes.map((n) => `\`${n}\``).join(" ") || "_(none)_",
          });
        }
        if (!groups.length) embed.addFields({ name: "Custom groups", value: "none yet — add one with `/permgroup set`" });
        embed.setFooter({ text: `Nodes: ${ALL_NODES.join(", ")}` });
        await ctx.reply({ embeds: [embed], ephemeral: true });
      },
    },

    set: {
      description: "Create/replace a group: give a role a name and a set of permission nodes.",
      args: [
        { name: "role", type: "role", required: true, description: "The Discord role" },
        { name: "name", type: "string", required: true, description: "Label, e.g. 'Trial Mod'" },
        { name: "nodes", type: "text", required: true, description: "Space/comma-separated nodes, or 'all'. Run /permgroup list to see every node." },
      ],
      async execute(ctx) {
        const parsed = parseNodes(ctx.args.nodes);
        const nodes = Array.isArray(parsed) ? parsed : parsed.nodes;
        if (!Array.isArray(parsed) && parsed.bad.length)
          return ctx.reply({ content: err(`Unknown node(s): ${parsed.bad.join(", ")}\nValid: ${ALL_NODES.join(", ")}`), ephemeral: true });
        await upsertPermGroup(ctx.guild.id, ctx.args.role.id, ctx.args.name.slice(0, 40), nodes);
        await ctx.reply({
          embeds: [
            okEmbed(
              `<@&${ctx.args.role.id}> → ${nodes.includes("*") ? "**all permissions**" : nodes.map((n) => `\`${n}\``).join(" ")}`,
              `Permission group · ${ctx.args.name}`,
            ),
          ],
          ephemeral: true,
        });
      },
    },

    grant: {
      description: "Add one permission node to a role's group.",
      args: [
        { name: "role", type: "role", required: true, description: "The role" },
        { name: "node", type: "string", required: true, description: "Permission node", autocomplete: "permNodes" },
      ],
      async execute(ctx) {
        const node = ctx.args.node.toLowerCase();
        if (node !== "*" && !ALL_NODES.includes(node))
          return ctx.reply({ content: err(`Unknown node \`${node}\`.`), ephemeral: true });
        const g = (await getPermGroups(ctx.guild.id)).find((x) => x.role_id === ctx.args.role.id);
        const nodes = new Set(g?.nodes ?? []);
        nodes.add(node);
        await upsertPermGroup(ctx.guild.id, ctx.args.role.id, g?.name ?? ctx.args.role.name, [...nodes]);
        await ctx.reply({ embeds: [okEmbed(`<@&${ctx.args.role.id}> can now \`${node}\`.`)], ephemeral: true });
      },
    },

    revoke: {
      description: "Remove one permission node from a role's group.",
      args: [
        { name: "role", type: "role", required: true, description: "The role" },
        { name: "node", type: "string", required: true, description: "Permission node", autocomplete: "permNodes" },
      ],
      async execute(ctx) {
        const g = (await getPermGroups(ctx.guild.id)).find((x) => x.role_id === ctx.args.role.id);
        if (!g) return ctx.reply({ content: err("That role has no permission group."), ephemeral: true });
        const nodes = g.nodes.filter((n) => n !== ctx.args.node.toLowerCase());
        await upsertPermGroup(ctx.guild.id, ctx.args.role.id, g.name, nodes);
        await ctx.reply({ embeds: [okEmbed(`Removed \`${ctx.args.node}\` from <@&${ctx.args.role.id}>.`)], ephemeral: true });
      },
    },

    delete: {
      description: "Delete a role's permission group entirely.",
      args: [{ name: "role", type: "role", required: true, description: "The role" }],
      async execute(ctx) {
        await ctx.reply(
          (await deletePermGroup(ctx.guild.id, ctx.args.role.id))
            ? { embeds: [okEmbed(`Deleted the permission group for <@&${ctx.args.role.id}>.`)], ephemeral: true }
            : { content: err("That role has no permission group."), ephemeral: true },
        );
      },
    },
  },
};
