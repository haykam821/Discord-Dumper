import debug from "debug";

export const log = {
	attachments: debug("discord-dumper:attachments"),
	dumper: debug("discord-dumper:dumper"),
	path: debug("discord-dumper:path"),
	prepare: debug("discord-dumper:prepare"),
};
