import { spawn, execFileSync } from "node:child_process"
import * as fs from "node:fs"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { SessionManager } from "@mariozechner/pi-coding-agent"

const TERMINAL_FLAG = "terminal"

function getTerminalFlag(pi: ExtensionAPI): string | undefined {
	const value = pi.getFlag(`--${TERMINAL_FLAG}`)
	if (typeof value !== "string") return undefined
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

function renderTerminalCommand(template: string, cwd: string, sessionFile: string): string {
	let command = template
	command = command.split("{cwd}").join(cwd)

	if (command.includes("{command}")) {
		const piCommand = `pi --session ${shellQuote(sessionFile)}`
		command = command.split("{command}").join(piCommand)
	}

	if (command.includes("{session}")) {
		command = command.split("{session}").join(sessionFile)
	}

	if (template.includes("{command}") || template.includes("{session}")) {
		return command
	}

	return `${command} ${sessionFile}`
}

function spawnDetached(command: string, args: string[], onError?: (error: Error) => void): void {
	const child = spawn(command, args, { detached: true, stdio: "ignore" })
	child.unref()
	if (onError) child.on("error", onError)
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''"
	return `'${value.replace(/'/g, "'\\''")}'`
}

function ghosttyAvailable(): boolean {
	if (process.platform === "darwin") {
		return (
			fs.existsSync("/Applications/Ghostty.app") ||
			fs.existsSync(`${process.env.HOME}/Applications/Ghostty.app`)
		)
	}
	try {
		execFileSync("which", ["ghostty"], { stdio: "ignore" })
		return true
	} catch {
		return false
	}
}

function spawnGhostty(sessionFile: string, cwd: string, onError?: (error: Error) => void): void {
	const piCommand = `exec pi --session ${shellQuote(sessionFile)}`

	if (process.platform === "darwin") {
		const envPath = process.env.PATH
		const args: string[] = ["-n", "-a", "Ghostty"]

		if (envPath) {
			args.push("--env", `PATH=${envPath}`)
		}

		args.push(
			"--args",
			"-e",
			"bash",
			"-lc",
			`cd "$1" && ${piCommand}`,
			"--",
			cwd,
		)

		spawnDetached("open", args, onError)
		return
	}

	spawnDetached(
		"ghostty",
		["-e", "bash", "-lc", `cd "$1" && ${piCommand}`, "--", cwd],
		onError,
	)
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag(TERMINAL_FLAG, {
		description:
			"Command to open a new terminal. Use {cwd} for working directory and optional {command} for the pi command.",
		type: "string",
	})

	pi.registerCommand("branch", {
		description: "Fork current session into a new terminal",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle()

			const sessionFile = ctx.sessionManager.getSessionFile()
			if (!sessionFile) {
				if (ctx.hasUI) ctx.ui.notify("Session is not persisted. Restart without --no-session.", "error")
				return
			}

			const leafId = ctx.sessionManager.getLeafId()
			if (!leafId) {
				if (ctx.hasUI) ctx.ui.notify("No messages yet. Nothing to branch.", "error")
				return
			}

			const forkManager = SessionManager.open(sessionFile)
			const forkFile = forkManager.createBranchedSession(leafId)
			if (!forkFile) {
				throw new Error("Failed to create branched session")
			}

			const manualHint = `pi --session ${forkFile}`

			const terminalFlag = getTerminalFlag(pi)
			if (terminalFlag) {
				const command = renderTerminalCommand(terminalFlag, ctx.cwd, forkFile)
				spawnDetached("bash", ["-lc", command], (error) => {
					if (ctx.hasUI) ctx.ui.notify(`Terminal command failed: ${error.message}`, "error")
				})
				if (ctx.hasUI) ctx.ui.notify("Opened fork in new terminal", "info")
				return
			}

			if (process.env.TMUX) {
				const result = await pi.exec("tmux", [
					"new-window",
					"-c",
					ctx.cwd,
					"-n",
					"branch",
					"pi",
					"--session",
					forkFile,
				])
				if (result.code !== 0) {
					throw new Error(result.stderr || result.stdout || "tmux new-window failed")
				}
				if (ctx.hasUI) ctx.ui.notify("Opened fork in new tmux window", "info")
				return
			}

			if (ghosttyAvailable()) {
				spawnGhostty(forkFile, ctx.cwd, (error) => {
					if (ctx.hasUI) {
						ctx.ui.notify(`Ghostty failed to open: ${error.message}`, "warning")
						ctx.ui.notify(`Run: ${manualHint}`, "info")
					}
				})
				if (ctx.hasUI) ctx.ui.notify("Opened fork in new Ghostty window", "info")
				return
			}

			if (ctx.hasUI) ctx.ui.notify(`Run: ${manualHint}`, "info")
		},
	})
}
