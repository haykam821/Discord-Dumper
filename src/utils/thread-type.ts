import { ThreadChannel, ThreadChannelTypes } from "discord.js";

const types: Record<ThreadChannelTypes, string> = {
	GUILD_NEWS_THREAD: "news",
	GUILD_PRIVATE_THREAD: "private",
	GUILD_PUBLIC_THREAD: "public",
};

export function getThreadType(thread: ThreadChannel): string {
	return types[thread.type] || thread.type;
}
