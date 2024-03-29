#!/usr/bin/env node

import { CHILD_CHANNEL_EMOJI, GUILD_OWNER_EMOJI, INFO_HEADER_EMOJI, JOIN_MESSAGE_EMOJI, MESSAGE_EMOJI, MESSAGE_WITH_ATTACHMENT_EMOJI, NAME_CHANGE_MESSAGE_EMOJI, NO_PERMISSION_EMOJI, PIN_MESSAGE_EMOJI, REPLY_MESSAGE_EMOJI, THREAD_MESSAGE_EMOJI, TTS_MESSAGE_EMOJI, UNKNOWN_MESSAGE_EMOJI } from "./emoji";
import djs, { BaseChannel, BaseGuildTextChannel, CategoryChannel, Client, ClientOptions, Collection, DMChannel, DiscordAPIError, Guild, GuildChannel, Message, MessageReaction, MessageType, NewsChannel, Snowflake, TextChannel, ThreadChannel } from "discord.js";

import { AttachmentStore } from "./utils/attachment-store";
import { GuildPaths } from "./utils/guild-paths";
import { WriteStream } from "node:fs";
import cli from "caporal";
import debug from "debug";
import fs from "fs-extra";
import { getChannelType } from "./utils/channel-type";
import { log } from "./utils/log";
import open from "open";
import path from "node:path";
import readPkg from "read-pkg";

/**
 * Gets a string representing a vessel name.
 * @param vessel The vessel to get the display name of.
 */
function displayName(vessel: Vessel): string {
	if (vessel === null) {
		return "Null";
	} else if (Array.isArray(vessel)) {
		return vessel
			.map(item => displayName(item))
			.join(", ");
	} else if (vessel instanceof Guild) {
		return vessel.name;
	} else if (vessel instanceof DMChannel) {
		if (vessel.recipient) {
			return `${vessel.recipient.tag} (${vessel.recipient.id})`;
		} else {
			return `Unknown recipient ${vessel.recipientId}`;
		}
	} else if (vessel instanceof GuildChannel || vessel instanceof ThreadChannel) {
		return vessel.isTextBased() ? "#" + vessel.name : vessel.name;
	} else {
		return "(" + vessel.id + ")";
	}
}

/**
 * Gets a string representing an reaction's emoji.
 * @param reaction The reaction to get the name of.
 */
function emojiName(reaction: MessageReaction): string {
	const rEmoji = reaction.emoji;
	switch (rEmoji.constructor.name) {
		case "Emoji": {
			return `:${rEmoji.name}:`;
		}
		default: {
			return rEmoji.name ?? "<Null>";
		}
	}
}

/**
 * Dumps a guild's hierarchy.
 * @param guild The guild to dump the hierarchy of.
 */
async function dumpHierarchy(guild: Guild): Promise<void> {
	if (!(guild instanceof Guild)) return;

	const paths = new GuildPaths(null);
	const hierarchyPath = paths.getMemberHierarchy();

	await fs.ensureFile(hierarchyPath);
	const hierarchyStream = fs.createWriteStream(hierarchyPath);

	await guild.members.fetch();

	const roles = guild.roles.cache
		.clone()
		.sort((a, b) => a.comparePositionTo(b))
		.reverse();

	roles.forEach(role => {
		hierarchyStream.write(`${role.name} (${role.id})\n`);
		role.members.forEach(member => {
			hierarchyStream.write("\t");
			hierarchyStream.write(`${member.user.tag}`);
			if (member.nickname) {
				hierarchyStream.write(` (or ${member.nickname})`);
			}
			hierarchyStream.write(` [${member.id}]`);
			if (guild.ownerId === member.id) {
				hierarchyStream.write(" " + GUILD_OWNER_EMOJI);
			}
			hierarchyStream.write("\n");
		});
	});

	hierarchyStream.end();
	log.dumper("Dumped the hierarchy of the guild.");
}

/**
 * Writes a single message's information to a stream.
 * @param dumpStream The stream to write the message to.
 * @param attachments The attachment store to add attachments to.
 * @param message The message itself.
 */
function dumpMessage(dumpStream: WriteStream, attachments: AttachmentStore, message: Message): void {
	const dumpMessage_ = [
		` ${message.id.padStart(18)} `,
		`[${message.createdAt.toLocaleString()}] `,
	];

	const reacts = message.reactions.cache;
	if (reacts.size > 0) {
		dumpMessage_.push("{");

		let index = 0;
		for (const reaction of reacts.values()) {
			dumpMessage_.push(`${emojiName(reaction)} x ${reaction.count}`);
			if (index < reacts.size - 1) {
				dumpMessage_.push(", ");
			}

			index += 1;
		}

		dumpMessage_.push("} ");
	}

	switch (message.type) {
		case MessageType.ChannelPinnedMessage: {
			dumpMessage_.unshift(PIN_MESSAGE_EMOJI);
			dumpMessage_.push(`A message in this channel was pinned by ${message.author.tag}.`);
			break;
		}
		case MessageType.ThreadCreated: {
			dumpMessage_.unshift(THREAD_MESSAGE_EMOJI);
			if (message.hasThread && message.thread !== null) {
				const type = getChannelType(message.thread);
				dumpMessage_.push(`${message.author.tag} created a ${type} named '${message.thread.name}'.`);
				// ${JSON.stringify(message.thread)}
			} else {
				dumpMessage_.push(`${message.author.tag} created a thread that no longer exists.`);
			}
			break;
		}
		case MessageType.ChannelNameChange: {
			dumpMessage_.unshift(NAME_CHANGE_MESSAGE_EMOJI);
			dumpMessage_.push(`${message.author.tag} renamed the channel to '${message.content}'.`);
			break;
		}
		case MessageType.UserJoin: {
			dumpMessage_.unshift(JOIN_MESSAGE_EMOJI);
			dumpMessage_.push(`${message.author.tag} joined the server.`);
			break;
		}
		case MessageType.Default:
		case MessageType.Reply: {
			if (message.type === MessageType.Reply) {
				dumpMessage_.push(`re: ${message.reference?.messageId} `);
			}

			dumpMessage_.push(`(${message.author.tag}):`);
			if (message.attachments.size > 0) {
				dumpMessage_.unshift(MESSAGE_WITH_ATTACHMENT_EMOJI);
				if (message.content) {
					dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
				}
				dumpMessage_.push(` ${message.attachments.map(attachment => attachment.url)
					.join(" ")}`);

				attachments.addAll(message.attachments);
			} else {
				let emoji;

				if (message.type === MessageType.Reply) {
					emoji = REPLY_MESSAGE_EMOJI;
				} else if (message.tts) {
					emoji = TTS_MESSAGE_EMOJI;
				} else {
					emoji = MESSAGE_EMOJI;
				}

				dumpMessage_.unshift(emoji);
				dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
			}
			break;
		}
		default: {
			dumpMessage_.unshift(UNKNOWN_MESSAGE_EMOJI);
			dumpMessage_.push(`(${message.author.tag}): <unknown message of type ${message.type}>`);
		}
	}

	dumpStream.write(dumpMessage_.join("") + "\n");
}

/**
 * Dumps a channel with its basic information and its messages.
 * @param channel The channel to dump.
 * @param [shouldDumpMessages=true] Whether to dump messages or not.
 * @param [shouldDumpAttachments=true] Whether to dump attachments or not.
 */
async function dump(channel: BaseChannel, shouldDumpMessages = true, shouldDumpAttachments = true) {
	const paths = new GuildPaths(channel);

	const channelPath = paths.getChannel();
	const attachmentsPath = paths.getAttachments();

	await fs.ensureFile(channelPath);
	const dumpStream = fs.createWriteStream(channelPath);

	if (shouldDumpAttachments) {
		await fs.ensureDir(attachmentsPath);
	}

	const attachments = new AttachmentStore(attachmentsPath);

	dumpStream.write([
		INFO_HEADER_EMOJI + ` Name: ${displayName(channel)} (${getChannelType(channel)})`,
		INFO_HEADER_EMOJI + ` ID: ${channel.id}` + (channel instanceof GuildChannel || channel instanceof ThreadChannel ? " (parent: " + channel.parentId + ")" : ""),
		INFO_HEADER_EMOJI + ` Topic: ${channel instanceof TextChannel || channel instanceof NewsChannel ? channel.topic : "(Cannot or does not have a topic.)"}`,
		INFO_HEADER_EMOJI + ` Creation Date: ${channel.createdAt ? channel.createdAt.toLocaleString() : "(Unknown)"}`,
	].join("\n"));

	if (channel.isThread()) {
		const owner = await channel.fetchOwner();
		dumpStream.write(`\n${INFO_HEADER_EMOJI} Owner: ${owner === null || owner.user === null ? "None" : owner.user.tag}`);

		const archivedDate = channel.archivedAt ? channel.archivedAt.toLocaleString() : "(Unknown)";
		dumpStream.write(`\n${INFO_HEADER_EMOJI} Archived: ${channel.archived ? archivedDate : "No"}`);
		dumpStream.write(`\n${INFO_HEADER_EMOJI} Locked: ${channel.locked ? "Yes" : "No"}`);
	}

	if (channel instanceof djs.CategoryChannel) {
		dumpStream.write("\n\n" + channel.children.cache.map(child => {
			return CHILD_CHANNEL_EMOJI + `${child.id} ${displayName(child)} (${getChannelType(child)})`;
		}).join("\n"));
	}

	if (channel instanceof BaseGuildTextChannel) {
		const threads = [...channel.threads.cache.values()];

		dumpStream.write("\n\n" + threads.map(thread => {
			return THREAD_MESSAGE_EMOJI + `${thread.id} ${displayName(thread)} (${getChannelType(thread)})`;
		}).join("\n"));
	}

	if (channel.isTextBased() && shouldDumpMessages) {
		dumpStream.write("\n\n");

		let oldestDumped = null;

		/* eslint-disable-next-line no-constant-condition */
		while (true) {
			try {
				const fetches: Collection<string, Message> = await channel.messages.fetch({
					before: oldestDumped ?? undefined,
					limit: 100,
				});

				if (fetches.size === 0) {
					log.dumper("Finished dumping the %s channel.", displayName(channel));
					break;
				} else {
					oldestDumped = fetches.last()?.id;
					for (const messageToDump of fetches.values()) {
						await dumpMessage(dumpStream, attachments, messageToDump);
					}
				}
			} catch (error) {
				if (error instanceof DiscordAPIError && error.code === 50001) {
					await dumpStream.write(NO_PERMISSION_EMOJI + " No permission to read this channel.");
					log.dumper("Finished dumping the %s channel (no permission).", displayName(channel));
				} else {
					log.dumper("An error occured while trying to dump %s: %o", displayName(channel), error);
				}
				break;
			}
		}
	}

	await attachments.dump(shouldDumpAttachments);

	return dumpStream.end();
}

/**
 * Gets a Discord.js client, with a bypass if it can be found.
 * @param ignoreBypass Whether to ignore the bypass no matter what.
 * @returns - A client that may or may not be patched with a bypass.
 */
function getClient(ignoreBypass = false): Client {
	const opts: ClientOptions = {
		intents: [
			djs.IntentsBitField.Flags.Guilds,
			djs.IntentsBitField.Flags.GuildMessages,
			djs.IntentsBitField.Flags.GuildMessageReactions,
			djs.IntentsBitField.Flags.GuildMembers,
			djs.IntentsBitField.Flags.DirectMessages,
			djs.IntentsBitField.Flags.DirectMessageReactions,
		],
	};

	try {
		if (ignoreBypass) throw 0;

		/* eslint-disable-next-line @typescript-eslint/no-var-requires */
		const bypassed = require("./bypass.js")(new Client(opts));
		log.prepare("Running dumper with the bypass...");
		return bypassed;
	} catch (error) {
		log.prepare("Running the dumper...");
		return new Client(opts);
	}
}

const version = readPkg.sync().version;
cli.version(version);

const debugOpt: [string, string, number, string] = ["--debug [debug]", "Debuggers to enable.", cli.STRING, "discord-dumper:*"];

cli
	.command("path", "Displays the path of the dumps folder.")
	.option(...debugOpt)
	.option("--open <open>", "If true, opens the dumps folder.", cli.BOOLEAN, true)
	.action((arguments_, options) => {
		const argv = Object.assign(arguments_, options);
		debug.enable(argv.debug);

		const dumpPath = path.resolve("./dumps");

		log.path("The dumps folder is at '%s'.", dumpPath);
		if (argv.open) {
			open(dumpPath).then(() => {
				log.path("The dumps folder has been opened in your file manager.");
			});
		}
	});

type Vessel = Guild | BaseChannel | Vessel[] | null;
type Context = (id: Snowflake, bot: Client) => Vessel | Promise<Vessel>;

const contexts: Record<string, Context> = {
	category: async (id, bot) => {
		try {
			const category = await bot.channels.fetch(id);
			if (category instanceof CategoryChannel) {
				return [
					category,
					...category.children.cache.values(),
				];
			} else {
				return null;
			}
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === 10003) {
				return null;
			}

			throw error;
		}
	},
	channel: async (id, bot) => {
		try {
			const channel = await bot.channels.fetch(id);
			if (channel instanceof BaseGuildTextChannel) {
				await channel.threads.fetchActive();
				await channel.threads.fetchArchived();

				return [
					channel,
					...channel.threads.cache.values(),
				];
			} else if (!channel?.partial) {
				return channel;
			} else {
				return null;
			}
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === 10003) {
				return null;
			}

			throw error;
		}
	},
	dm: async (id, bot) => {
		try {
			const user = await bot.users.fetch(id);
			return user ? user.dmChannel : null;
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === 10013) {
				return null;
			}

			throw error;
		}
	},
	guild: async (id, bot) => {
		try {
			return await bot.guilds.fetch(id);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.code === 10004) {
				return null;
			}

			throw error;
		}
	},
};

const contextKeys = Object.keys(contexts);
contexts.infer = async (id, bot) => {
	for (const key of contextKeys) {
		const potentialVessel = await contexts[key](id, bot);
		if (potentialVessel !== null) return potentialVessel;
	}
	return null;
};

/**
 * Like, actually dumps.
 * @param vessel The vessel to dump.
 * @param argv Options.
 */
async function likeActuallyDump(vessel: Vessel, argv: Record<string, unknown>) {
	if (Array.isArray(vessel)) {
		for (const subVessel of vessel) {
			await likeActuallyDump(subVessel, argv);
		}
	} else if (vessel instanceof djs.Guild) {
		if (argv.hierarchy) {
			await dumpHierarchy(vessel);
		}
		for (const channel of vessel.channels.cache) {
			await dump(channel[1], argv.dumpMessages as boolean, argv.dumpAttachments as boolean);
		}
	} else if (vessel instanceof djs.BaseChannel) {
		await dump(vessel, argv.dumpMessages as boolean, argv.dumpAttachments as boolean);
	}
}

cli
	.command("dump", "Runs the dumper.")
	.option(...debugOpt)
	.option("--token [token]", "The Discord token to authenticate with.", cli.STRING)
	.option("--bypass [bypass]", "Uses the bypass, if it exists.", cli.BOOLEAN, true)
	.option("--hierarchy [hierarchy]", "Dumps the role/member hierarchy of a guild.", cli.BOOLEAN, true)
	.option("--dumpMessages [dumpMessages]", "Dumps the message history of channels.", cli.BOOLEAN, true)
	.option("--dumpAttachments [dumpAttachments]", "Dumps attachments to local files.", cli.BOOLEAN, true)
	.option("--path <path>", "The directory to store dumps in.", cli.STRING, "./dumps")
	.argument("<id>", "The ID of the guild/channel/category/DM channel to dump.")
	.argument("[context]", "The context of the ID.", Object.keys(contexts), "infer")
	.action(async (arguments_, options) => {
		const argv = Object.assign(arguments_, options);
		debug.enable(argv.debug);

		await fs.ensureDir(path.resolve(argv.path));

		const bot = getClient(!argv.bypass);

		bot.login(argv.token).catch(error => {
			log.prepare("Could not log in successfully for reason: %s", error.message);
			process.exit(1);
		});

		bot.on("ready", async () => {
			if (bot.user === null) {
				log.prepare("Authenticated as unknown Discord client user");
			} else {
				log.prepare("Authenticated as Discord client user %s (%s)", bot.user.tag, bot.user.id);
			}

			const vessel = await contexts[argv.context](argv.id, bot);
			if (vessel) {
				log.dumper("Dumping the %s vessel.", displayName(vessel));
				await likeActuallyDump(vessel, argv);

				log.dumper("All dumps have finished.");
				return process.exit(0);
			} else {
				log.prepare("Could not find a vessel using the %s context.", argv.context);
				return process.exit(1);
			}
		});
	});

cli.parse(process.argv);
