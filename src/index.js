#!/usr/bin/env node

const djs = require("discord.js");
const fs = require("fs-extra");
const path = require("path");

const cli = require("caporal");

const open = require("open");

/**
 	* The timestamp used in part of the dump's path.
 */
const dumpDate = Date.now().toString();

// Set up logging with debug module
const debug = require("debug");
const log = {
	dumper: debug("discord-dumper:dumper"),
	path: debug("discord-dumper:path"),
	prepare: debug("discord-dumper:prepare"),
};

const emoji = require("./emoji.js");

/**
	* Gets a string representing a channel name.
	* @param {djs.Channel} channel - The channel to get the display name of.
	* @returns {string}
*/
function displayName(channel) {
	switch (channel.type) {
		case "dm":
			return `${channel.recipient.tag} (${channel.recipient.id})`;
		case "text":
			return "#" + channel.name;
		default:
			return channel.name;
	}
}

/**
	* Gets a string representing an reaction's emoji.
	* @param {(Emoji|*)} reaction The reaction to get the name of.
	* @returns {string}
*/
function emojiName(reaction) {
	const rEmoji = reaction.emoji;
	switch (rEmoji.constructor.name) {
		case "Emoji":
			return `:${rEmoji.name}:`;
		default:
			return rEmoji.name;
	}
}

/**
 * Dumps a guild's hierarchy.
 * @param {djs.Guild} guild - The guild to dump the hierarchy of.
 */
async function dumpHierarchy(guild) {
	if (!(guild instanceof djs.Guild)) return;

	const hierarchyPath = path.resolve(`./dumps/${guild.id}/${dumpDate}/member_hierarchy.txt`);
	await fs.ensureFile(hierarchyPath);
	const hierarchyStream = fs.createWriteStream(hierarchyPath);

	await guild.fetchMembers();

	const roles = guild.roles.array().sort((role1, role2) => {
		return role1.calculatedPosition - role2.calculatedPosition;
	}).reverse();

	roles.forEach(role => {
		hierarchyStream.write(`${role.name} (${role.id})\n`);
		role.members.forEach(member => {
			hierarchyStream.write("\t");
			hierarchyStream.write(`${member.user.tag}`);
			if (member.nickname) {
				hierarchyStream.write(` (or ${member.nickname})`);
			}
			hierarchyStream.write(` [${member.id}]`);
			if (guild.owner.id === member.id) {
				hierarchyStream.write(" " + emoji.guildOwner);
			}
			hierarchyStream.write("\n");
		});
	});

	hierarchyStream.end();
	log.dumper("Dumped the hierarchy of the guild.");
}

/**
 * Writes a single message's information to a stream.
 * @param {WritableStream} dumpStream - The stream to write the message to.
 * @param {djs.Message} message - The message itself.
 */
function dumpMessage(dumpStream, message) {
	const dumpMessage_ = [
		` ${message.id.padStart(18)} `,
		`[${message.createdAt.toLocaleString()}] `,
	];

	switch (message.type) {
		case "PINS_ADD": {
			dumpMessage_.unshift(emoji.pinMessage);
			dumpMessage_.push(`A message in this channel was pinned by ${message.author.tag}.`);
			break;
		}
		case "GUILD_MEMBER_JOIN": {
			dumpMessage_.unshift(emoji.joinMessage);
			dumpMessage_.push(`${message.author.tag} joined the server.`);
			break;
		}
		case "DEFAULT": {
			const reacts = message.reactions.array();
			if (reacts.length > 0) {
				dumpMessage_.push("{");
				reacts.forEach((reaction, index) => {
					dumpMessage_.push(`${emojiName(reaction)} x ${reaction.count}`);
					if (index < reacts.length - 1) {
						dumpMessage_.push(", ");
					}
				});
				dumpMessage_.push("} ");
			}
			dumpMessage_.push(`(${message.author.tag}):`);
			if (message.attachments.array().length > 0) {
				dumpMessage_.unshift(emoji.messageWithAttachment);
				if (message.content) {
					dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
				}
				dumpMessage_.push(` ${message.attachments.array().map(atch => atch.url).join(" ")}`);
			} else {
				dumpMessage_.unshift(message.tts ? emoji.ttsMessage : emoji.message);
				dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
			}
			break;
		}
		default: {
			dumpMessage_.unshift(emoji.unknownMessage);
			dumpMessage_.push(`(${message.author.tag}): <unknown message of type ${message.type}>`);
		}
	}

	dumpStream.write(dumpMessage_.join("") + "\n");
}

/**
 * Ensures and gets the path to where dumps should be stored for a channel at the given dump time.
 * @param {djs.Channel} channel - The channel to get the relevant dump path for.
 * @returns {string} - The path where the dumps should be stored for a channel at the given dump time.
 */
async function channelify(channel) {
	const guildName = channel.guild ? channel.guild.id : "guildless";
	const pathToChannel = path.resolve(`./dumps/${guildName}/${dumpDate}/${channel.id}.txt`);

	await fs.ensureFile(pathToChannel);

	return pathToChannel;
}

/**
 * Dumps a channel with its basic information and its messages.
 * @param {djs.Channel} channel - The channel to dump.
 * @param {boolean} [shouldDumpMessages=true] - Whether to dump messages or not.
 */
async function dump(channel, shouldDumpMessages = true) {
	const dumpPath = await channelify(channel);
	const dumpStream = fs.createWriteStream(dumpPath);

	dumpStream.write([
		emoji.infoHeader + ` Name: ${displayName(channel)} (${channel.type})`,
		emoji.infoHeader + ` ID: ${channel.id}` + (channel.parentID ? " (parent: " + channel.parentID + ")" : ""),
		emoji.infoHeader + ` Topic: ${channel.topic ? channel.topic : "(Cannot or does not have a topic.)"}`,
		emoji.infoHeader + ` Creation Date: ${channel.createdAt ? channel.createdAt.toLocaleString() : "(Unknown)"}`,
	].join("\n"));

	if (channel instanceof djs.CategoryChannel) {
		dumpStream.write("\n\n" + channel.children.map(child => {
			return emoji.childChannel + `${child.id} ${displayName(child)} (${child.type})`;
		}).join("\n"));
	}

	if (channel.fetchMessages && shouldDumpMessages) {
		dumpStream.write("\n\n");

		let oldestDumped = null;

		/* eslint-disable-next-line no-constant-condition */
		while (true) {
			try {
				const fetches = await channel.fetchMessages({
					before: oldestDumped ? oldestDumped : null,
					limit: 100,
				});

				if (fetches.size < 1) {
					log.dumper("Finished dumping the %s channel.", displayName(channel));
					break;
				} else {
					const msgs = fetches.array();
					oldestDumped = fetches.last().id;

					for (const messageToDump of msgs) {
						await dumpMessage(dumpStream, messageToDump);
					}
				}
			} catch (error) {
				if (error.code === 50001) {
					await dumpStream.write(emoji.noPermission + " No permission to read this channel.");
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
 * @param {boolean} ignoreBypass - Whether to ignore the bypass no matter what.
 * @returns {djs.Client} - A client that may or may not be patched with a bypass.
 */
function getClient(ignoreBypass = false) {
	try {
		if (ignoreBypass) throw 0;

		const bypassed = require("./bypass.js")(new djs.Client());
		log.prepare("Running dumper with the bypass...");
		return bypassed;
	} catch (error) {
		log.prepare("Running the dumper...");
		return new djs.Client();
	}
}

const { version } = require("../package.json");
cli.version(version);

const debugOpt = ["--debug [debug]", "Debuggers to enable.", cli.STRING, "discord-dumper:*"];

cli
	.command("path")
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

const contexts = {
	category: (id, bot) => {
		const category = bot.channels.get(id);
		return [
			category,
			...category.children,
		];
	},
	channel: (id, bot) => bot.channels.get(id) || null,
	dm: (id, bot) => {
		const user = bot.users.get(id);
		return user ? user.dmChannel : null;
	},
	guild: (id, bot) => bot.guilds.get(id) || null,
};

const contextKeys = Object.keys(contexts);
contexts.infer = (id, bot) => {
	for (const key of contextKeys) {
		const potentialVessel = contexts[key](id, bot);
		if (potentialVessel !== null) return potentialVessel;
	}
};

/**
 * Like, actually dumps.
 * @param {*} vessel The vessel to dump.
 * @param {Object} argv Options.
 */
async function likeActuallyDump(vessel, argv) {
	if (Array.isArray(vessel)) {
		for (const subVessel of vessel) {
			await likeActuallyDump(subVessel, argv);
		}
	} else if (vessel instanceof djs.Guild) {
		if (argv.hierarchy) {
			await dumpHierarchy(vessel);
		}
		for (const channel of vessel.channels) {
			await dump(channel[1], argv.dumpMessages);
		}
	} else if (vessel instanceof djs.Channel) {
		await dump(vessel, argv.dumpMessages);
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
			const vessel = contexts[argv.context](argv.id, bot);
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
