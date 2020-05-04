# Discord Dumper

**WARNING:** Please do not share your token outside of your command line in order to invoke the dumper, and only get dumper code from this repository on GitHub. If you accidentally do either of those things, perform a token reset by changing your password.

A fully-featured channel dumper for Discord.

## Installation

Install this module globally:

```sh
npm i -g haykam821/Discord-Dumper
```

## Usage

You can use `dcd` or `discord-dumper` on the command-line to invoke the dumper. You can add the `--help` (`-h`) option to see more information about the options and arguments that the command accepts.

### Dumping

When running the dumper, specify the ID of the channel/guild/DM you would like to dump, like so:

```sh
dcd dump 222197033908436994
```

By default, the dumper guesses what the ID represents, but you can provide context for the ID by providing it as an argument:

```sh
dcd dump 222197033908436994 guild
```

Since you must authenticate with the Discord API to read messages, you must specify a token. You can do this via the `DUMPER_TOKEN` environment variable.

### Accessing Dumps

You can open up the folder that dumps are stored in by running:

```sh
dcd path
```

If you do not want the folder to be opened, instead disable the `--open` option.

```sh
dcd path --open false
```

### Completion

You can set up completion by placing the following command in your config file (`~/.bashrc`, `~/.zshrc`, `~/.config/fish/config.fish`):

```sh
source <(myapp completion sh)
source <(myapp completion zsh)
source <(myapp completion fish)
```
