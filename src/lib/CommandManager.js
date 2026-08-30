import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PermissionFlagsBits, ApplicationCommandOptionType } from "discord.js";
import Anthropic from "@anthropic-ai/sdk";
import { Context } from "./Context.js";
import { getGuildConfig } from "./guildConfig.js";
import { checkRateLimit } from "./ratelimit.js";
import { buildSlashOptions, parsePrefixArgs, parseSlashArgs, usageString } from "./args.js";
import { tokenize } from "./util.js";
import { askClaude } from "./ai.js";
import { autocompleteProviders } from "./autocomplete.js";
import { dispatchComponent } from "./components.js";
import { ensureGuildConfig } from "./guildConfig.js";
import { requirePermission } from "./permissions.js";
import { DUTY_NODES, reportOffDuty } from "./dutyWatch.js";
import { logCommand } from "./modlog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(here, "..", "commands");

export class CommandManager {
  constructor(client) {
    this.client = client;
    this.commands = new Map();
    this.aliases = new Map();
  }

  async load() {
    this.commands.clear();
    this.aliases.clear();
    for (const file of walk(COMMANDS_DIR)) {
      const mod = await import(pathToFileURL(file).href);
      const command = mod.default;
      const hasLeaf = typeof command?.execute === "function";
      const hasSubs = command?.subcommands && Object.keys(command.subcommands).length > 0;
      if (!command?.name || (!hasLeaf && !hasSubs)) {
        console.warn(`Skipping ${path.relative(COMMANDS_DIR, file)} — needs name + execute() or subcommands`);
        continue;
      }
      command.module ??= "general";
      command.args ??= [];
      command.checks = [command.permission && requirePermission(command.permission), command.check].filter(Boolean);
      this.commands.set(command.name, command);
      for (const alias of command.aliases ?? []) this.aliases.set(alias, command.name);
    }
    console.log(`Loaded ${this.commands.size} commands.`);
    return this;
  }

  resolve(name) {
    return this.commands.get(name) ?? this.commands.get(this.aliases.get(name));
  }

  /** Merge a parent command with one of its subcommands into a flat, runnable command. */
  #invocation(command, subName) {
    if (!command.subcommands) return command;
    let key = subName;
    let sub = subName ? command.subcommands[subName] : null;
    if (!sub && subName) {
      key = Object.keys(command.subcommands).find((k) => command.subcommands[k].aliases?.includes(subName));
      sub = key ? command.subcommands[key] : null;
    }
    if (!sub) return null;
    return {
      ...command,
      ...sub,
      name: `${command.name} ${key}`,
      module: command.module,
      guildOnly: command.guildOnly || sub.guildOnly,
      userPermissions: sub.userPermissions ?? command.userPermissions,
      botPermissions: sub.botPermissions ?? command.botPermissions,
      ratelimit: sub.ratelimit ?? command.ratelimit,
      args: sub.args ?? [],
      checks: [
        command.permission && requirePermission(command.permission),
        command.check,
        sub.permission && requirePermission(sub.permission),
        sub.check,
      ].filter(Boolean),
    };
  }

  toSlashJSON(command) {
    const json = {
      name: command.name,
      description: (command.description || command.name).slice(0, 100),
      dm_permission: !command.guildOnly,
    };
    if (command.subcommands) {
      json.options = Object.entries(command.subcommands).map(([name, sub]) => ({
        type: ApplicationCommandOptionType.Subcommand,
        name,
        description: (sub.description || name).slice(0, 100),
        options: buildSlashOptions(sub.args ?? []),
      }));
    } else {
      json.options = buildSlashOptions(command.args);
    }
    if (command.userPermissions?.length) {
      json.default_member_permissions = command.userPermissions
        .reduce((acc, k) => acc | PermissionFlagsBits[k], 0n)
        .toString();
    }
    return json;
  }

  async registerSlashCommands(devGuildId) {
    const payload = [...this.commands.values()].map((c) => this.toSlashJSON(c));
    if (devGuildId) {
      const guild = await this.client.guilds.fetch(devGuildId).catch(() => null);
      if (!guild) {
        console.warn(`DEV_GUILD_ID ${devGuildId} not found — skipping slash registration.`);
        return;
      }
      await guild.commands.set(payload);
      console.log(`Registered ${payload.length} slash commands to guild ${guild.name}.`);
    } else {
      await this.client.application.commands.set(payload);
      console.log(`Registered ${payload.length} global slash commands (~1h to appear).`);
      // If a dev-guild registration was ever done, clear its now-duplicate guild-scoped set.
      const stale = process.env.DEV_GUILD_ID;
      if (stale) {
        const guild = await this.client.guilds.fetch(stale).catch(() => null);
        if (guild) {
          await guild.commands.set([]).catch(() => {});
          console.log(`Cleared stale guild-scoped commands in ${guild.name}.`);
        }
      }
    }
  }

  // ---- dispatch ----

  async handleAutocomplete(interaction) {
    await ensureGuildConfig(interaction.guildId).catch(() => {});
    const parent = this.resolve(interaction.commandName);
    if (!parent) return interaction.respond([]).catch(() => {});
    const subName = parent.subcommands ? interaction.options.getSubcommand(false) : null;
    const command = this.#invocation(parent, subName) ?? parent;

    const focused = interaction.options.getFocused(true);
    const spec = (command.args ?? []).find((a) => a.name === focused.name);
    const provider = spec?.autocomplete && autocompleteProviders[spec.autocomplete];
    if (!provider) return interaction.respond([]).catch(() => {});

    try {
      const choices = await provider(interaction, focused.value ?? "");
      await interaction.respond(choices.slice(0, 25));
    } catch (err) {
      console.error("Autocomplete error:", err);
      await interaction.respond([]).catch(() => {});
    }
  }

  async handleComponent(interaction) {
    await ensureGuildConfig(interaction.guildId).catch(() => {});
    const kind = interaction.isButton()
      ? "button"
      : interaction.isModalSubmit()
        ? "modal"
        : interaction.componentType != null
          ? `select(${interaction.componentType})`
          : "?";
    try {
      const handled = await dispatchComponent(interaction, { client: this.client });
      console.log(`component ${kind} '${interaction.customId}' → ${handled ? "handled" : "no handler"}`);
      if (!handled && !interaction.replied && !interaction.deferred)
        await interaction.reply({ content: "This control is no longer active.", flags: 1 << 6 }).catch(() => {});
    } catch (err) {
      console.error(`Component handler error [${kind} ${interaction.customId}]:`, err);
      const msg = { content: "Something went wrong handling that.", flags: 1 << 6 };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch {
        /* interaction already gone */
      }
    }
  }

  async handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
    await ensureGuildConfig(interaction.guildId).catch(() => {});
    const parent = this.resolve(interaction.commandName);
    if (!parent) return;

    const subName = parent.subcommands ? interaction.options.getSubcommand(false) : null;
    const command = this.#invocation(parent, subName);
    if (!command) return;

    await interaction
      .deferReply(command.ephemeral ? { flags: 1 << 6 } : {})
      .catch((e) => console.error(`deferReply failed for /${command.name}:`, e.message));
    const ctx = new Context({ command, client: this.client, source: interaction });
    await this.#run(command, ctx, { interaction });
  }

  async handleMessage(message) {
    if (message.author.bot || message.webhookId) return;

    if (message.guild) await ensureGuildConfig(message.guild.id).catch(() => {});
    const cfg = getGuildConfig(message.guild?.id);
    const mentionRe = new RegExp(`^<@!?${this.client.user.id}>\\s*`);
    let content = message.content;
    let via = null;

    if (content.startsWith(cfg.prefix)) {
      content = content.slice(cfg.prefix.length);
      via = "prefix";
    } else if (mentionRe.test(content)) {
      content = content.replace(mentionRe, "");
      via = "mention";
    } else if (!message.guild) {
      via = "dm";
    } else {
      return;
    }

    const tokens = tokenize(content.trim());
    const name = (tokens.shift() || "").toLowerCase();
    const parent = name ? this.resolve(name) : null;

    if (parent) {
      let command = parent;
      if (parent.subcommands) {
        const subName = (tokens.shift() || "").toLowerCase() || parent.defaultSubcommand || "";
        command = this.#invocation(parent, subName);
        if (!command) {
          const list = Object.keys(parent.subcommands).join(", ");
          await new Context({ command: parent, client: this.client, source: message }).reply({
            content: `Usage: \`${cfg.prefix}${parent.name} <${list}>\``,
            ephemeral: true,
          });
          return;
        }
      }
      const ctx = new Context({ command, client: this.client, source: message });
      await this.#run(command, ctx, { tokens });
      return;
    }

    if (via === "mention" || via === "dm") {
      await this.#aiFallback(message, [name, ...tokens].join(" ").trim());
    }
  }

  async #aiFallback(message, prompt) {
    const cfg = getGuildConfig(message.guild?.id);
    if (!cfg.aiEnabled || !prompt) return;
    try {
      await message.channel.sendTyping();
      const answer = await askClaude(message.channelId, prompt);
      await new Context({ client: this.client, source: message }).reply(answer);
    } catch (err) {
      console.error("AI fallback failed:", err);
      await message
        .reply({ content: "The AI request failed — check the logs.", allowedMentions: { repliedUser: false } })
        .catch(() => {});
    }
  }

  async #run(command, ctx, { tokens, interaction }) {
    const cfg = ctx.config;
    const deny = (content) => ctx.reply({ content, ephemeral: true });

    if (command.guildOnly && !ctx.guild) return deny("That command only works in a server.");
    if (command.ownerOnly && !ctx.isOwner) return deny("This command is owner-only.");

    if (ctx.guild && command.module !== "config") {
      if (cfg.disabledModules.includes(command.module))
        return deny(`The \`${command.module}\` module is disabled on this server.`);
      const baseName = command.name.split(" ")[0];
      if (cfg.disabledCommands.includes(baseName) || cfg.disabledCommands.includes(command.name))
        return deny(`\`${command.name}\` is disabled on this server.`);
    }

    if (ctx.guild && command.userPermissions?.length && !ctx.isOwner) {
      const missing = command.userPermissions.filter((p) => !ctx.permissions.has(PermissionFlagsBits[p]));
      if (missing.length) return deny(`You're missing permission: **${missing.join(", ")}**`);
    }
    if (ctx.guild && command.botPermissions?.length) {
      const me = ctx.guild.members.me;
      const missing = command.botPermissions.filter((p) => !me?.permissions.has(PermissionFlagsBits[p]));
      if (missing.length) return deny(`I'm missing permission: **${missing.join(", ")}**`);
    }

    for (const check of command.checks ?? []) {
      const res = await check(ctx);
      if (res !== true) return deny(typeof res === "string" ? res : "You can't use this command.");
    }

    const rl = checkRateLimit(command.ratelimit, {
      commandName: command.name,
      userId: ctx.author.id,
      guildId: ctx.guild?.id,
    });
    if (rl.limited) return deny(`Slow down — try again in ${Math.ceil(rl.retryAfter / 1000)}s.`);

    const parsed = interaction
      ? await parseSlashArgs(command.args, interaction)
      : await parsePrefixArgs(command.args, tokens, { guild: ctx.guild, client: ctx.client });
    if (!parsed.ok) {
      const usage = usageString(command.args);
      return deny(`${parsed.error}${usage ? `\nUsage: \`${command.name} ${usage}\`` : ""}`);
    }
    ctx.args = parsed.args;

    try {
      if (!interaction && command.defer) await ctx.defer();
      await command.execute(ctx);
      if (ctx.guild) {
        const argsText = renderArgs(command, ctx.args);
        logCommand(this.client, {
          guildId: ctx.guild.id,
          user: ctx.author,
          commandName: command.name,
          argsText,
          channel: ctx.channel,
        }).catch(() => {});
        if (DUTY_NODES.has(command.permission)) {
          reportOffDuty(this.client, {
            guild: ctx.guild,
            userId: ctx.author.id,
            userTag: ctx.author.tag ?? ctx.author.username,
            action: `/${command.name}`,
            detail: argsText || undefined,
            invokedIn: ctx.channel?.id,
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Command '${command.name}' failed:`, err);
      const msg =
        err?.name === "ErlcError"
          ? err.message
          : err instanceof Anthropic.RateLimitError
            ? "Rate limited by the API — try again shortly."
            : err instanceof Anthropic.APIError
              ? `API error (${err.status}). Check the logs.`
              : "Something went wrong running that command.";
      await ctx.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}

function renderArgs(command, args) {
  const redact = new Set(command.redactArgs ?? []);
  return Object.entries(args ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      if (redact.has(k)) return `${k}:‹redacted›`;
      let s;
      if (typeof v === "object") s = v.tag ?? v.name ?? v.user?.tag ?? v.id ?? "[obj]";
      else s = String(v);
      if (s.length > 120) s = s.slice(0, 117) + "…";
      return `${k}:${s}`;
    })
    .join(" ");
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("_")) yield full;
  }
}
