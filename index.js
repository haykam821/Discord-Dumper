const chalk = require("chalk");

const djs = require("discord.js");
const bot = (() => {
    try {
        process.stdout.write(chalk.yellow("Running dumper with the bypass...\n"));
        return require("./bypass.js")(new djs.Client());
    } catch {
        process.stdout.write(chalk.yellow("Running the dumper...\n"));
        return new djs.Client();
    }
})();

const fs = require("fs-extra");
const path = require("path");
fs.ensureDir(path.resolve("./dumps"));

const logDate = Date.now().toString();

bot.on("ready", async () => {
    const id = process.argv[2];

    if (id) {
        if (bot.guilds.get(id)) {
            process.stdout.write(chalk.blue(`Logging the "${bot.guilds.get(id).name}" guild.\n`));
            logHierarchy(bot.guilds.get(id));
            bot.guilds.get(id).channels.forEach(channel => {
                log(channel);
            });
        } else if (bot.channels.get(id)) {
            process.stdout.write(chalk.blue(`Logging the "${displayName(bot.channels.get(id))}" channel.\n`));
            log(bot.channels.get(id));
        } else if (bot.users.get(id).dmChannel) {
            process.stdout.write(chalk.blue(`Logging the "${bot.users.get(id).dmChannel}" channel.\n`));
            log(bot.users.get(id).dmChannel);
        } else {
            process.stdout.write(chalk.red("There was not a guild or channel with that ID that I could access.\n"));
            process.exit(1);
        }
    } else {
        process.stdout.write(chalk.red("Specify the ID of a guild or channel to log.\n"));
        process.exit(1);
    }
});

async function logHierarchy(guild) {
    const hierarchyPath = path.resolve(`./dumps/${guild.id}/${logDate}/member_hierarchy.txt`);
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
                hierarchyStream.write(` 👑`);
            }
            hierarchyStream.write(`\n`);
        });
    });

    hierarchyStream.end();
}
async function channelify(channel) {
    const guildName = channel.guild ? channel.guild.id : "guildless";
    const pathToChannel = path.resolve(`./dumps/${guildName}/${logDate}/${channel.id}.txt`);

    await fs.ensureFile(pathToChannel);

    return pathToChannel;
}
async function log(channel) {
    const logPath = await channelify(channel);
    const logStream = fs.createWriteStream(logPath);

    logStream.write([
        `ℹ️ Name: ${displayName(channel)} (${channel.type})`,
        `ℹ️ ID: ${channel.id}`,
        `ℹ️ Topic: ${channel.topic ? channel.topic : "(Cannot or does not have a topic.)"}`,
        `ℹ️ Creation Date: ${channel.createdAt.toLocaleString()}`
    ].join("\n"));

    if (channel.fetchMessages) {
        logStream.write("\n\n");

        let oldestLogged = null;

        const interval = setInterval(async () => {
            try {
                const fetches = await channel.fetchMessages({
                    limit: 100,
                    before: oldestLogged ? oldestLogged : null,
                });

                if (fetches.size < 1) {
                    process.stdout.write(chalk.green(`Finished logging the ${displayName(channel)} channel.\n`));
                    logStream.end();
                    clearInterval(interval);
                } else {
                    const msgs = fetches.array();
                    oldestLogged = fetches.last().id;

                    msgs.forEach(msg => {
                        logMessage(logStream, msg);
                    });
                }
            } catch (error) {
                if (error.code === 50001) {
                    logStream.write("⛔️ No permission to read this channel.");

                    process.stdout.write(chalk.green(`Finished logging the ${displayName(channel)} channel (no permission).\n`));
                    logStream.end();
                    clearInterval(interval);
                } else {
                    process.stdout.write(chalk.red(error + "\n"));
                }
            }
        }, 500);
    }
}
function logMessage(logStream, msg) {
    const logMsg = [
        ` ${msg.id.padStart(18)} `,
        `[${msg.createdAt.toLocaleString()}] `,
    ];
    
    switch (msg.type) {
        case "PINS_ADD":
            logMsg.unshift("📌");
            logMsg.push(`A message in this channel was pinned by ${msg.author.tag}.`);
            break;
        case "GUILD_MEMBER_JOIN":
            logMsg.unshift("👋🏼");
            logMsg.push(`${msg.author.tag} joined the server.`);
            break;
        case "DEFAULT":
            const reacts = msg.reactions.array();
            if (reacts.length > 0) {
                logMsg.push("{");
                reacts.forEach((reaction, index) => {
                    logMsg.push(`${emojiName(reaction)} x ${reaction.count}`);
                    if (index < reacts.length - 1) {
                        logMsg.push(", ");
                    }
                });
                logMsg.push("} ");
            }
            logMsg.push(`(${msg.author.tag}):`);
            if (msg.attachments.array().length > 0) {
                logMsg.unshift("📎");
                if (msg.content) {
                    logMsg.push(` ${msg.cleanContent.replace(/\n/g, "\\n")}`);
                }
                logMsg.push(` ${msg.attachments.array().map(atch => atch.url).join(" ")}`);
            } else {
                logMsg.unshift("💬");
                logMsg.push(` ${msg.cleanContent.replace(/\n/g, "\\n")}`);
            }
            break;
        default:
            logMsg.unshift("❓");
            logMsg.push(`(${msg.author.tag}): <unknown message of type ${msg.type}>`)
    }

    logStream.write(logMsg.join(""));
    logStream.write("\n");
}
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
function emojiName(reaction) {
    const emoji = reaction.emoji;
    switch (emoji.constructor.name) {
        case "Emoji":
            return `:${emoji.name}:`;
        default:
            return emoji.name;
    }
}

if (process.env.DUMPER_TOKEN) {
    bot.login(process.env.DUMPER_TOKEN);
} else {
    process.stdout.write(chalk.red("You need a token (set enviroment variable DUMPER_TOKEN) to use the dumper.\n"));
    process.exit(1);
}