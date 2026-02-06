import fs from "node:fs";
import path from "node:path";

export function isCommandInstalled(command: string): boolean {
	if (!command) return false;

	const pathValue = process.env.PATH || "";
	const dirs = pathValue.split(path.delimiter).filter(Boolean);

	if (dirs.length === 0) return false;

	if (process.platform === "win32") {
		const pathext = process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM";
		const exts = pathext
			.split(";")
			.map((e) => e.trim())
			.filter(Boolean);

		for (const dir of dirs) {
			for (const ext of ["", ...exts]) {
				const fullPath = path.join(dir, command + ext);
				try {
					fs.accessSync(fullPath, fs.constants.F_OK);
					return true;
				} catch {
					// ignore
				}
			}
		}

		return false;
	}

	for (const dir of dirs) {
		const fullPath = path.join(dir, command);
		try {
			fs.accessSync(fullPath, fs.constants.X_OK);
			return true;
		} catch {
			// ignore
		}
	}

	return false;
}
