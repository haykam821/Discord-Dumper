import { Attachment, Collection, Snowflake } from "discord.js";

import { Writable } from "node:stream";
import { createWriteStream } from "fs-extra";
import { log } from "./log";
import { resolve as resolvePath } from "node:path";

const EXTENSION_PATTERN = /([^./]+)$/;

export class AttachmentStore {
	private readonly attachments = new Map<Snowflake, string>();
	private readonly basePath: string;

	constructor(basePath: string) {
		this.basePath = basePath;
	}

	private getExtension(url: URL): string {
		const match = url.pathname.match(EXTENSION_PATTERN);

		if (match === null) {
			log.attachments("Failed to find extension for attachment '%s'.", url);
			return "";
		}

		return "." + match[1];
	}

	async dump(shouldDumpAttachments: boolean): Promise<void> {
		if (!shouldDumpAttachments) {
			log.attachments("Not dumping %d attachments.", this.attachments.size);
			return;
		}

		log.attachments("Dumping %d attachments.", this.attachments.size);

		for (const [id, urlString] of this.attachments) {
			const url = new URL(urlString);

			const extension = this.getExtension(url);
			const path = resolvePath(this.basePath, `${id}${extension}`);

			const response = await fetch(url);

			if (response.body) {
				const fileStream = createWriteStream(path);
				response.body.pipeTo(Writable.toWeb(fileStream));
			}

			log.attachments("Dumped attachment '%s' to '%s'.", urlString, path);
		}

		return;
	}

	private add(id: Snowflake, attachment: Attachment): void {
		this.attachments.set(id, attachment.proxyURL);
	}

	addAll(attachments: Collection<Snowflake, Attachment>): void {
		for (const [id, attachment] of attachments) {
			this.add(id, attachment);
		}
	}
}
