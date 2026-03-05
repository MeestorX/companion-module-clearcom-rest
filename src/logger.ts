import { createModuleLogger } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ModuleLogger {
	debug(msg: string): void
	info(msg: string): void
	warn(msg: string): void
	error(msg: string): void
}

export function makeLogger(prefix: string, getConfig: () => ModuleConfig | undefined): ModuleLogger {
	const log = createModuleLogger(prefix)

	function shouldLog(level: LogLevel): boolean {
		const cfg = getConfig()?.logLevel ?? 'info'
		if (cfg === 'none') return false
		if (cfg === 'info' && level === 'debug') return false
		return true
	}

	return {
		debug: (msg) => {
			if (shouldLog('debug')) log.debug(msg)
		},
		info: (msg) => {
			if (shouldLog('info')) log.info(msg)
		},
		warn: (msg) => {
			if (shouldLog('warn')) log.warn(msg)
		},
		error: (msg) => {
			if (shouldLog('error')) log.error(msg)
		},
	}
}
