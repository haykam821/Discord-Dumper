import { BaseChannel, GuildChannel, ThreadChannel } from "discord.js";

import { resolve } from "node:path";

/**
 * The timestamp used in part of the dump's path.
 */
const dumpDate = Date.now().toString();

function getGuildIdPart(channel: BaseChannel | null): string {
	if (channel instanceof GuildChannel || channel instanceof ThreadChannel) {
		return channel.guild.id;
	}

	return "guildless";
}

export class GuildPaths {
	private readonly channel: BaseChannel | null;
	private readonly base: string;

	constructor(channel: BaseChannel | null) {
		this.channel = channel;
		this.base = resolve(`./dumps/${getGuildIdPart(channel)}/${dumpDate}`);
	}

	private resolve(...segments: string[]) {
		return resolve(this.base, ...segments);
	}

	getAttachments(): string {
		return this.resolve("./attachments");
	}

	getChannel(): string {
		if (this.channel === null) {
			throw new Error("Cannot get channel path in non-channel context");
		}

		return this.resolve(`./channels/${this.channel.id}.txt`);
	}

	getMemberHierarchy(): string {
		return this.resolve("./member_hierarchy.txt");
	}
}
