import ModuleInstance from './main.js'
import {
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionFeedbackButtonStyleResult,
	CompanionValueFeedbackDefinition,
	CompanionBooleanFeedbackDefinition,
} from '@companion-module/base'
import { SettingDef } from './types.js'
import type { LiveStatusDef } from './types.js'
import * as arcadia from './arcadia.js'

// ─── Action builder ───────────────────────────────────────────────────────────

type Choice = { id: string; label: string }

function buildValueChoices(settingDef: SettingDef): Choice[] {
	const vt = settingDef.valueType

	if (vt.kind === 'integer') {
		const choices: Choice[] = []
		for (let v = vt.max; v >= vt.min; v -= vt.step) {
			choices.push({ id: String(v), label: String(v) })
		}
		return choices
	}

	if (vt.kind === 'number-enum') {
		return [...vt.values].sort((a, b) => b - a).map((v) => ({ id: String(v), label: String(v) }))
	}

	if (vt.kind === 'string-enum') {
		return vt.values.map((v) => ({ id: v, label: v }))
	}

	// boolean
	return [
		{ id: 'true', label: 'Enabled' },
		{ id: 'false', label: 'Disabled' },
	]
}

function actionId(setting: SettingDef): string {
	return `keyset_${setting.deviceType.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${setting.key}`
}

export function buildKeysetActions(instance: ModuleInstance, settings: SettingDef[]): CompanionActionDefinitions {
	const actions: CompanionActionDefinitions = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	for (const setting of settings) {
		const choices = buildValueChoices(setting)
		const defaultValue = choices[0]?.id ?? ''

		const modeChoices: Choice[] = [{ id: 'absolute', label: 'Absolute' }]
		if (setting.supportsIncDec) {
			modeChoices.push({ id: 'increment', label: 'Increment' })
			modeChoices.push({ id: 'decrement', label: 'Decrement' })
		}

		actions[actionId(setting)] = {
			name: `[${setting.deviceType}] ${setting.label}`,
			options: [
				{
					type: 'multidropdown',
					id: 'roleIds',
					label: 'Beltpack',
					default: [],
					choices: roleChoices,
				},
				...(setting.supportsIncDec
					? [
							{
								type: 'dropdown' as const,
								id: 'mode',
								label: 'Mode',
								default: 'absolute',
								choices: modeChoices,
								disableAutoExpression: true,
							},
						]
					: []),
				{
					type: 'dropdown' as const,
					id: 'value',
					label: 'Value',
					default: defaultValue,
					choices,
					...(setting.supportsIncDec ? { isVisibleExpression: "$(options:mode) == 'absolute'" } : {}),
				},
			],
			callback: async (action: CompanionActionEvent) => {
				const roleIds = (action.options.roleIds as string[]).map(Number)
				const mode = action.options.mode as 'absolute' | 'increment' | 'decrement'
				const rawValue = action.options.value as string
				const value =
					setting.valueType.kind === 'boolean'
						? rawValue === 'true'
						: setting.valueType.kind === 'string-enum'
							? rawValue
							: Number(rawValue)
				await arcadia.setKeyset(instance, roleIds, setting.key, value, mode, setting)
			},
		}
	}

	return actions
}

// ─── Feedback helpers ─────────────────────────────────────────────────────────

export function getFeedbackIdsByTrigger(instance: ModuleInstance, trigger: 'endpoint' | 'keyset'): string[] {
	return [...instance.feedbackTriggers.entries()].filter(([, t]) => t === trigger).map(([id]) => id)
}

// ─── Keyset feedback builder ──────────────────────────────────────────────────

function feedbackId(setting: SettingDef): string {
	return `keyset_${setting.deviceType.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${setting.key}`
}

export function buildKeysetFeedbacks(
	instance: ModuleInstance,
	settings: SettingDef[],
): Record<
	string,
	CompanionBooleanFeedbackDefinition<{ roleId: string }> | CompanionValueFeedbackDefinition<{ roleId: string }>
> {
	const feedbacks: Record<
		string,
		CompanionBooleanFeedbackDefinition<{ roleId: string }> | CompanionValueFeedbackDefinition<{ roleId: string }>
	> = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const roleOption = {
		type: 'dropdown' as const,
		id: 'roleId' as const,
		label: 'Beltpack',
		default: roleChoices[0]?.id ?? '',
		choices: roleChoices,
	}

	for (const setting of settings) {
		const id = feedbackId(setting)

		if (setting.valueType.kind === 'boolean') {
			feedbacks[id] = {
				type: 'boolean',
				name: `[${setting.deviceType}] ${setting.label}`,
				defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 } satisfies Partial<CompanionFeedbackButtonStyleResult>,
				options: [roleOption],
				unsubscribe: (feedback) => {
					instance.feedbackTriggers.delete(feedback.feedbackId)
				},
				callback: (feedback) => {
					instance.feedbackTriggers.set(feedback.feedbackId, 'keyset')
					const roleId = Number(feedback.options.roleId)
					const roleset = instance.rolesets.get(roleId)
					if (!roleset) return false
					const session = roleset.sessions ? Object.values(roleset.sessions)[0] : undefined
					const keysetId = session?.data?.settings?.['defaultRole'] as number | undefined
					if (keysetId === undefined) return false
					const keyset = instance.keysets.get(keysetId)
					return keyset?.settings[setting.key] === true
				},
			}
		} else {
			feedbacks[id] = {
				type: 'value',
				name: `[${setting.deviceType}] ${setting.label}`,
				options: [roleOption],
				unsubscribe: (feedback) => {
					instance.feedbackTriggers.delete(feedback.feedbackId)
				},
				callback: (feedback) => {
					instance.feedbackTriggers.set(feedback.feedbackId, 'keyset')
					const roleId = Number(feedback.options.roleId)
					const roleset = instance.rolesets.get(roleId)
					if (!roleset) return null
					const session = roleset.sessions ? Object.values(roleset.sessions)[0] : undefined
					const keysetId = session?.data?.settings?.['defaultRole'] as number | undefined
					if (keysetId === undefined) return null
					const keyset = instance.keysets.get(keysetId)
					return (keyset?.settings[setting.key] ?? null) as import('@companion-module/base').JsonValue
				},
			}
		}
	}

	return feedbacks
}

// ─── Live status feedback builder ─────────────────────────────────────────────

const LIVE_STATUS_DEFS: LiveStatusDef[] = [
	{ key: 'status', label: 'Online', kind: 'boolean' },
	{ key: 'batteryLevel', label: 'Battery Level', kind: 'value' },
	{ key: 'batteryStatus', label: 'Battery Status', kind: 'value' },
	{ key: 'rssi', label: 'RSSI', kind: 'value' },
	{ key: 'linkQuality', label: 'Link Quality', kind: 'value' },
	{ key: 'frameErrorRate', label: 'Frame Error Rate', kind: 'value' },
	{ key: 'longevity.hours', label: 'Remaining Hours', kind: 'value' },
	{ key: 'longevity.minutes', label: 'Remaining Minutes', kind: 'value' },
]

function resolvePath(obj: unknown, path: string): unknown {
	return path.split('.').reduce((acc, key) => (acc as Record<string, unknown>)?.[key], obj)
}

function liveStatusFeedbackId(def: LiveStatusDef): string {
	return `live_${def.key.replace('.', '_')}`
}

export function buildLiveStatusFeedbacks(
	instance: ModuleInstance,
): Record<
	string,
	CompanionBooleanFeedbackDefinition<{ roleId: string }> | CompanionValueFeedbackDefinition<{ roleId: string }>
> {
	const feedbacks: Record<
		string,
		CompanionBooleanFeedbackDefinition<{ roleId: string }> | CompanionValueFeedbackDefinition<{ roleId: string }>
	> = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const roleOption = {
		type: 'dropdown' as const,
		id: 'roleId' as const,
		label: 'Beltpack',
		default: roleChoices[0]?.id ?? '',
		choices: roleChoices,
	}

	const getLiveStatus = (roleId: number) => {
		for (const [, status] of instance.beltpackStatus) {
			if (status.association?.dpId === roleId) return status
		}
		return null
	}

	for (const def of LIVE_STATUS_DEFS) {
		const id = liveStatusFeedbackId(def)

		if (def.kind === 'boolean') {
			feedbacks[id] = {
				type: 'boolean',
				name: `[Beltpack] ${def.label}`,
				defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 } satisfies Partial<CompanionFeedbackButtonStyleResult>,
				options: [roleOption],
				unsubscribe: (feedback) => {
					instance.feedbackTriggers.delete(feedback.feedbackId)
				},
				callback: (feedback) => {
					const roleId = Number(feedback.options.roleId)
					instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
					const status = getLiveStatus(roleId)
					return resolvePath(status, def.key) === 'online'
				},
			}
		} else {
			feedbacks[id] = {
				type: 'value',
				name: `[Beltpack] ${def.label}`,
				options: [roleOption],
				unsubscribe: (feedback) => {
					instance.feedbackTriggers.delete(feedback.feedbackId)
				},
				callback: (feedback) => {
					instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
					const status = getLiveStatus(Number(feedback.options.roleId))
					return (resolvePath(status, def.key) ?? null) as import('@companion-module/base').JsonValue
				},
			}
		}
	}

	return feedbacks
}

// ─── Key state feedback builder ───────────────────────────────────────────────

const KEY_COUNT = 5 // FSII-BP has 5 keys (0-4)

export function buildKeyStateFeedbacks(
	instance: ModuleInstance,
): Record<string, CompanionValueFeedbackDefinition<{ roleId: string; keyIndex: string }>> {
	const feedbacks: Record<string, CompanionValueFeedbackDefinition<{ roleId: string; keyIndex: string }>> = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const keyChoices = Array.from({ length: KEY_COUNT }, (_, i) => ({
		id: String(i),
		label: `Key ${i + 1}`,
	}))

	const baseOptions = [
		{
			type: 'dropdown' as const,
			id: 'roleId' as const,
			label: 'Beltpack',
			default: roleChoices[0]?.id ?? '',
			choices: roleChoices,
		},
		{
			type: 'dropdown' as const,
			id: 'keyIndex' as const,
			label: 'Key',
			default: '0',
			choices: keyChoices,
		},
	]

	const getKeyState = (roleId: number, keyIndex: string) => {
		for (const [, status] of instance.beltpackStatus) {
			if (status.association?.dpId === roleId) return status.keyState?.[keyIndex]
		}
		return null
	}

	feedbacks['key_state'] = {
		type: 'value',
		name: '[Key] State',
		options: baseOptions,
		unsubscribe: (feedback) => {
			instance.feedbackTriggers.delete(feedback.feedbackId)
		},
		callback: (feedback) => {
			instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
			const key = getKeyState(Number(feedback.options.roleId), feedback.options.keyIndex)
			return (key?.currentState ?? null) as import('@companion-module/base').JsonValue
		},
	}

	feedbacks['key_volume'] = {
		type: 'value',
		name: '[Key] Volume',
		options: baseOptions,
		unsubscribe: (feedback) => {
			instance.feedbackTriggers.delete(feedback.feedbackId)
		},
		callback: (feedback) => {
			instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
			const key = getKeyState(Number(feedback.options.roleId), feedback.options.keyIndex)
			return (key?.volume ?? null) as import('@companion-module/base').JsonValue
		},
	}

	return feedbacks
}
