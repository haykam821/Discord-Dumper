# Discord Dumper

**WARNING:** Please do not share your token outside of your command line in order to invoke the dumper, and only get dumper code from this repository on GitHub. If you accidentally do either of those things, perform a token reset by changing your password.

A fully-featured channel dumper for Discord.

When running the dumper, specify the ID of the channel/guild/DM you would like to dump, like so:

    node index.js 222197033908436994

Since you must authenticate with the Discord API to read messages, you must specify a token. You can do this via the `DUMPER_TOKEN` environment variable.
