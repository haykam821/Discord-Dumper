#!/usr/bin/env node

import { CHILD_CHANNEL_EMOJI, GUILD_OWNER_EMOJI, INFO_HEADER_EMOJI, JOIN_MESSAGE_EMOJI, MESSAGE_EMOJI, MESSAGE_WITH_ATTACHMENT_EMOJI, NO_PERMISSION_EMOJI, PIN_MESSAGE_EMOJI, THREAD_MESSAGE_EMOJI, TTS_MESSAGE_EMOJI, UNKNOWN_MESSAGE_EMOJI } from "./emoji";
import djs, { AnyChannel, BaseGuildTextChannel, CategoryChannel, Channel, Client, ClientOptions, Collection, DMChannel, DiscordAPIError, Guild, GuildChannel, Message, MessageReaction, NewsChannel, Snowflake, TextChannel, ThreadChannel } from "discord.js";

import { WriteStream } from "node:fs";
import cli from "caporal";
import debug from "debug";
import fs from "fs-extra";
import { getThreadType } from "./utils/thread-type";
import open from "open";
import path from "node:path";
import readPkg from "read-pkg";

/**
 * The timestamp used in part of the dump's path.
 */
const dumpDate = Date.now().toString();

// Set up logging with debug module
const log = {
	dumper: debug("discord-dumper:dumper"),
	path: debug("discord-dumper:path"),
	prepare: debug("discord-dumper:prepare"),
};

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
		return `${vessel.recipient.tag} (${vessel.recipient.id})`;
	} else if (vessel instanceof GuildChannel || vessel instanceof ThreadChannel) {
		return vessel.isText() ? "#" + vessel.name : vessel.name;
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
		case "Emoji":
			return `:${rEmoji.name}:`;
		default:
			return rEmoji.name ?? "<Null>";
	}
}

/**
 * Dumps a guild's hierarchy.
 * @param guild The guild to dump the hierarchy of.
 */
async function dumpHierarchy(guild: Guild): Promise<void> {
	if (!(guild instanceof Guild)) return;

	const hierarchyPath = path.resolve(`./dumps/${guild.id}/${dumpDate}/member_hierarchy.txt`);
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
 * @param message The message itself.
 */
function dumpMessage(dumpStream: WriteStream, message: Message): void {
	const dumpMessage_ = [
		` ${message.id.padStart(18)} `,
		`[${message.createdAt.toLocaleString()}] `,
	];

	switch (message.type) {
		case "CHANNEL_PINNED_MESSAGE": {
			dumpMessage_.unshift(PIN_MESSAGE_EMOJI);
			dumpMessage_.push(`A message in this channel was pinned by ${message.author.tag}.`);
			break;
		}
		case "THREAD_CREATED": {
			dumpMessage_.unshift(THREAD_MESSAGE_EMOJI);
			if (message.hasThread && message.thread !== null) {
				const type = getThreadType(message.thread);
				dumpMessage_.push(`${message.author.tag} created a ${type} thread named '${message.thread.name}'.`);
				// ${JSON.stringify(message.thread)}
			} else {
				dumpMessage_.push(`${message.author.tag} created a thread that no longer exists.`);
			}
			break;
		}
		case "GUILD_MEMBER_JOIN": {
			dumpMessage_.unshift(JOIN_MESSAGE_EMOJI);
			dumpMessage_.push(`${message.author.tag} joined the server.`);
			break;
		}
		case "DEFAULT": {
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
			dumpMessage_.push(`(${message.author.tag}):`);
			if (message.attachments.size > 0) {
				dumpMessage_.unshift(MESSAGE_WITH_ATTACHMENT_EMOJI);
				if (message.content) {
					dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
				}
				dumpMessage_.push(` ${message.attachments.map(attachment => attachment.url)
					.join(" ")}`);
			} else {
				dumpMessage_.unshift(message.tts ? TTS_MESSAGE_EMOJI : MESSAGE_EMOJI);
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
 * Ensures and gets the path to where dumps should be stored for a channel at the given dump time.
 * @param channel The channel to get the relevant dump path for.
 * @returns - The path where the dumps should be stored for a channel at the given dump time.
 */
async function channelify(channel: Channel): Promise<string> {
	const guildName = channel instanceof GuildChannel || channel instanceof ThreadChannel ? channel.guild.id : "guildless";
	const pathToChannel = path.resolve(`./dumps/${guildName}/${dumpDate}/channels/${channel.id}.txt`);

	await fs.ensureFile(pathToChannel);

	return pathToChannel;
}

/**
 * Dumps a channel with its basic information and its messages.
 * @param channel The channel to dump.
 * @param [shouldDumpMessages=true] Whether to dump messages or not.
 */
async function dump(channel: Channel, shouldDumpMessages = true) {
	const dumpPath = await channelify(channel);
	const dumpStream = fs.createWriteStream(dumpPath);

	dumpStream.write([
		INFO_HEADER_EMOJI + ` Name: ${displayName(channel)} (${channel.type})`,
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
		dumpStream.write("\n\n" + channel.children.map(child => {
			return CHILD_CHANNEL_EMOJI + `${child.id} ${displayName(child)} (${child.type})`;
		}).join("\n"));
	}

	if (channel instanceof BaseGuildTextChannel) {
		const threads = [...channel.threads.cache.values()];

		dumpStream.write("\n\n" + threads.map(thread => {
			return THREAD_MESSAGE_EMOJI + `${thread.id} ${displayName(thread)} (${getThreadType(thread)})`;
		}).join("\n"));
	}

	if (channel.isText() && channel.messages.fetch && shouldDumpMessages) {
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
						await dumpMessage(dumpStream, messageToDump);
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
			djs.Intents.FLAGS.GUILDS,
			djs.Intents.FLAGS.GUILD_MESSAGES,
			djs.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
			djs.Intents.FLAGS.GUILD_MEMBERS,
			djs.Intents.FLAGS.DIRECT_MESSAGES,
			djs.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
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

type Vessel = Guild | AnyChannel | Channel | Vessel[] | null;
type Context = (id: Snowflake, bot: Client) => Vessel | Promise<Vessel>;

const contexts: Record<string, Context> = {
	category: (id, bot) => {
		const category = bot.channels.cache.get(id);
		if (category instanceof CategoryChannel) {
			return [
				category,
				...category.children.values(),
			];
		} else {
			return null;
		}
	},
	channel: async (id, bot) => {
		const channel = bot.channels.cache.get(id);
		if (channel instanceof BaseGuildTextChannel) {
			await channel.threads.fetchActive();
			await channel.threads.fetchArchived();

			return [
				channel,
				...channel.threads.cache.values(),
			];
		} else {
			return channel || null;
		}
	},
	dm: (id, bot) => {
		const user = bot.users.cache.get(id);
		return user ? user.dmChannel : null;
	},
	guild: (id, bot) => bot.guilds.cache.get(id) || null,
};

const contextKeys = Object.keys(contexts);
contexts.infer = (id, bot) => {
	for (const key of contextKeys) {
		const potentialVessel = contexts[key](id, bot);
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
			await dump(channel[1], argv.dumpMessages as boolean);
		}
	} else if (vessel instanceof djs.Channel) {
		await dump(vessel, argv.dumpMessages as boolean);
	}
}

cli
	.command("dump", "Runs the dumper.")
	.option(...debugOpt)
	.option("--token [token]", "The Discord token to authenticate with.", cli.STRING)
	.option("--bypass [bypass]", "Uses the bypass, if it exists.", cli.BOOLEAN, true)
	.option("--hierarchy [hierarchy]", "Dumps the role/member hierarchy of a guild.", cli.BOOLEAN, true)
	.option("--dumpMessages [dumpMessages]", "Dumps the message history of channels.", cli.BOOLEAN, true)
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
