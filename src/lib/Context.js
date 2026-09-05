import { PermissionsBitField, MessageFlags } from "discord.js";
import { getGuildConfig } from "./guildConfig.js";
import { chunkMessage } from "./util.js";

/** Unified command context — same surface for slash interactions and prefix messages. */
export class Context {
  constructor({ command, client, source, args = {} }) {
    this.command = command;
    this.client = client;
    this.source = source;
    this.args = args;
    this.isInteraction = typeof source.isChatInputCommand === "function";
    this._replied = false;
  }

  get guild() {
    return this.source.guild ?? null;
  }

  get channel() {
    return this.source.channel;
  }

  get author() {
    return this.isInteraction ? this.source.user : this.source.author;
  }

  get member() {
    return this.source.member ?? null;
  }

  /** @returns {PermissionsBitField} invoker permissions in this channel */
  get permissions() {
    if (this.isInteraction) return this.source.memberPermissions ?? new PermissionsBitField();
    return this.member?.permissions ?? new PermissionsBitField();
  }

  get config() {
    return getGuildConfig(this.guild?.id);
  }

  get isOwner() {
    return this.client.ownerIds?.includes(this.author.id);
  }

  async defer() {
    if (this.isInteraction) {
      if (!this.source.deferred && !this.source.replied) {
        await this.source.deferReply(this.command?.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      }
    }
    // Prefix commands acknowledge instantly with a reaction (see CommandManager#handleMessage),
    // not a typing indicator — that felt sluggish next to bots that just react and reply.
  }

  /** Reply with a string or a payload object ({ content, embeds, files, ephemeral }). */
  async reply(payload) {
    const opts = typeof payload === "string" ? { content: payload } : { ...payload };
    const ephemeral = !!opts.ephemeral;
    delete opts.ephemeral;

    const chunks = opts.content ? chunkMessage(opts.content) : [null];

    for (let i = 0; i < chunks.length; i++) {
      const base = i === 0 ? { ...opts } : {};
      base.content = chunks[i] ?? undefined;

      if (this.isInteraction) {
        if (!this._replied) {
          if (this.source.deferred || this.source.replied) {
            await this.source.editReply(base);
          } else {
            await this.source.reply({ ...base, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
          }
        } else {
          await this.source.followUp({ ...base, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        }
      } else if (!this._replied) {
        await this.source.reply({ ...base, allowedMentions: { repliedUser: false } });
      } else {
        await this.channel.send(base);
      }
      this._replied = true;
    }
  }
}
