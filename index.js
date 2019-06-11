#!/usr/bin/env node

const djs = require("discord.js");
const fs = require("fs-extra");
const path = require("path");

const chalk = require("chalk");
const cli = require("caporal");

/**
 	* The timestamp used in part of the dump's path.
 */
const dumpDate = Date.now().toString();

/**
	* Logs a colorful message to console.
	* @param {string} [text=""] - The message to log.
	* @param {string} [type] - The type of message.
	* @param {number} [exitCode] - The exit code that the process exits with, if provided.
*/
function std(text = "", type, exitCode) {
	switch (type) {
		case "prepare":
			process.stdout.write(chalk.magenta(text + "\n"));
			break;
		case "error":
			process.stderr.write(chalk.red(text + "\n"));
			break;
		case "success":
			process.stdout.write(chalk.green(text + "\n"));
			break;
		case "warn":
			process.stdout.write(chalk.yellow(text + "\n"));
			break;
		default:
			process.stdout.write(chalk.blue(text + "\n"));
	}

	if (exitCode !== undefined) {
		process.exit(exitCode);
	}
}

// Set up logging with debug module
const debug = require("debug");
debug.enable("discord-dumper:*");
const log = {
	dumper: debug("discord-dumper:dumper"),
	prepare: debug("discord-dumper:prepare"),
};

/**
 * Logs a locale-provided message to console.
 * @param {*} stringID The ID from the locale file.
 * @param {*} exitCode The exit code that the process exits with, if provided.
 */
function logMessage(stringID, exitCode) {
	const localeMessage = messages[stringID];
	if (localeMessage) {
		return std(localeMessage[1], localeMessage[0], exitCode);
	}
}

const locale = require("os-locale").sync();
let messages = {};

try {
	messages = require(`./locales/${locale}.json`);
} catch (e1) {
	try {
		messages = require(`./locales/${locale.split("_")[0]}.json`);
	} catch (e2) {
		messages = require("./locales/en.json");
		logMessage("MISSING_LOCALE");
	}
}

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
	const emoji = reaction.emoji;
	switch (emoji.constructor.name) {
		case "Emoji":
			return `:${emoji.name}:`;
		default:
			return emoji.name;
	}
}

/**
 * Dumps a guild's hierarchy.
 * @param {djs.Guild} guild - The guild to dump the hierarchy of.
 */
async function dumpHierarchy(guild) {
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
				hierarchyStream.write(" 👑");
			}
			hierarchyStream.write("\n");
		});
	});

	hierarchyStream.end();
	logMessage("HIERARCHY_DUMPED");
}

/**
 * Writes a single message's information to a stream.
 * @param {WritableStream} dumpStream - The stream to write the message to.
 * @param {djs.Message} msg - The message itself.
 */
function dumpMessage(dumpStream, message) {
	const dumpMessage_ = [
		` ${message.id.padStart(18)} `,
		`[${message.createdAt.toLocaleString()}] `,
	];

	switch (message.type) {
		case "PINS_ADD": {
			dumpMessage_.unshift("📌");
			dumpMessage_.push(`A message in this channel was pinned by ${message.author.tag}.`);
			break;
		}
		case "GUILD_MEMBER_JOIN": {
			dumpMessage_.unshift("👋");
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
				dumpMessage_.unshift("📎");
				if (message.content) {
					dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
				}
				dumpMessage_.push(` ${message.attachments.array().map(atch => atch.url).join(" ")}`);
			} else {
				dumpMessage_.unshift(message.tts ? "🗣" : "💬");
				dumpMessage_.push(` ${message.cleanContent.replace(/\n/g, "\\n")}`);
			}
			break;
		}
		default: {
			dumpMessage_.unshift("❓");
			dumpMessage_.push(`(${message.author.tag}): <unknown message of type ${message.type}>`);
		}
	}

	dumpStream.write(dumpMessage_.join(""));
	dumpStream.write("\n");
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
		`ℹ️ Name: ${displayName(channel)} (${channel.type})`,
		`ℹ️ ID: ${channel.id}`,
		`ℹ️ Topic: ${channel.topic ? channel.topic : "(Cannot or does not have a topic.)"}`,
		`ℹ️ Creation Date: ${channel.createdAt.toLocaleString()}`,
	].join("\n"));

	if (channel.fetchMessages && shouldDumpMessages) {
		dumpStream.write("\n\n");

		let oldestDumped = null;

		const interval = setInterval(async () => {
			try {
				const fetches = await channel.fetchMessages({
					before: oldestDumped ? oldestDumped : null,
					limit: 100,
				});

				if (fetches.size < 1) {
					std(`Finished dumping the ${displayName(channel)} channel.`, "success");
					dumpStream.end();
					clearInterval(interval);
				} else {
					const msgs = fetches.array();
					oldestDumped = fetches.last().id;

					msgs.forEach(messageToDump => {
						dumpMessage(dumpStream, messageToDump);
					});
				}
			} catch (error) {
				if (error.code === 50001) {
					dumpStream.write("⛔️ No permission to read this channel.");

					std(`Finished dumping the ${displayName(channel)} channel (no permission).`, "success");
					dumpStream.end();
					clearInterval(interval);
				} else {
					std(error, "error");
				}
			}
		}, 500);
	}
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
		logMessage("RUNNING_BYPASS");
		return bypassed;
	} catch (error) {
		logMessage("RUNNING");
		return new djs.Client();
	}
}

const { version } = require("./package.json");
cli.version(version);

cli
	.command("path")
	.action(() => {
		console.log("The path is at " + path.resolve("./dumps"));
	});

cli
	.command("dump", messages.SHORT_DESCRIPTION)
	.option("--token [token]", messages.TOKEN_DESCRIPTION, cli.STRING)
	.option("--bypass [bypass]", messages.BYPASS_DESCRIPTION, cli.BOOLEAN, true)
	.option("--hierarchy [hierarchy]", messages.HIERARCHY_DESCRIPTION, cli.BOOLEAN, true)
	.option("--dumpMessages [dumpMessages]", messages.SHOULD_DUMP_MESSAGES_DESCRIPTION, cli.BOOLEAN, true)
	.option("--path <path>", messages.PATH_DESCRIPTION, cli.STRING, "./dumps")
	.argument("<id>", messages.ID_DESCRIPTION)
	.action(async (args, opts) => {
		const argv = Object.assign(args, opts);

		await fs.ensureDir(path.resolve(argv.path));

		const bot = getClient(!argv.bypass);

		bot.login(argv.token).catch(error => {
			log.prepare("Could not log in successfully for reason: %s", error.message);
			process.exit(1);
		});

		bot.on("ready", () => {
			const id = argv.id;

			if (id) {
				if (bot.guilds.get(id)) {
					log.dumper("Dumping the %s guild.", bot.guilds.get(id).name);
					if (argv.hierarchy) {
						dumpHierarchy(bot.guilds.get(id));
					}
					bot.guilds.get(id).channels.forEach(channel => {
						dump(channel, argv.dumpMessages);
					});
				} else if (bot.channels.get(id)) {
					log.dumper("Dumping the %s channel.", displayName(bot.channels.get(id)));
					dump(bot.channels.get(id), argv.dumpMessages);
				} else if (bot.users.get(id).dmChannel) {
					log.dumper("Dumping the %s channel.", bot.users.get(id).dmChannel);
					dump(bot.users.get(id).dmChannel, argv.dumpMessages);
				} else {
					logMessage("UNREACHABLE_ID", 1);
					process.exit(1);
				}
			} else {
				logMessage("UNSPECIFIED_ID", 1);
				process.exit(1);
			}
		});
	});

cli.parse(process.argv);
