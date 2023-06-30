import { BaseChannel, ChannelType } from "discord.js";

const types: Record<ChannelType, string> = {
	[ChannelType.GuildText]: "text",
	[ChannelType.DM]: "DM",
	[ChannelType.GuildVoice]: "voice",
	[ChannelType.GroupDM]: "group DM",
	[ChannelType.GuildCategory]: "category",
	[ChannelType.GuildAnnouncement]: "announcement",
	[ChannelType.AnnouncementThread]: "announcement thread",
	[ChannelType.PublicThread]: "public thread",
	[ChannelType.PrivateThread]: "private thread",
	[ChannelType.GuildStageVoice]: "stage",
	[ChannelType.GuildDirectory]: "directory",
	[ChannelType.GuildForum]: "forum",
};

export function getChannelType(channel: BaseChannel): string {
	if (channel.type in types) {
		return types[channel.type];
	}

	return "unknown channel type " + channel.type.toString();
}
