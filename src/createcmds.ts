import ModuleInstance from './main.js'
import {
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionFeedbackButtonStyleResult,
	CompanionValueFeedbackDefinition,
	CompanionBooleanFeedbackDefinition,
} from '@companion-module/base'
import { SettingDef, KeySlot } from './types.js'
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

	const selectedTypes = instance.config.endpointTypes ?? []
	const filteredSettings =
		selectedTypes.length > 0 ? settings.filter((s) => selectedTypes.includes(s.deviceType)) : settings

	for (const setting of filteredSettings) {
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
					isVisibleExpression: "$(options:mode) == 'absolute'",
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

// ─── Key assign action builder ───────────────────────────────────────────────

// Format schema enum value into human-readable label
// e.g. 'talkforcelisten' → 'Talk Force Listen', 'non-latching' → 'Non Latching'
function formatEnumLabel(value: string): string {
	const tokens = ['forcetalk', 'force', 'dual', 'talk', 'listen', 'latching', 'non-latching', 'disabled', 'permanent']
	let remaining = value
	const parts: string[] = []
	while (remaining.length > 0) {
		const match = tokens.find((t) => remaining.startsWith(t))
		if (match) {
			parts.push(match.charAt(0).toUpperCase() + match.slice(1))
			remaining = remaining.slice(match.length)
		} else {
			parts.push(remaining.charAt(0).toUpperCase() + remaining.slice(1))
			break
		}
	}
	return parts.join(' ')
}

export function buildKeyAssignActions(instance: ModuleInstance): CompanionActionDefinitions {
	const actions: CompanionActionDefinitions = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const assignToChoices = [
		{ id: '', label: '(empty)' },
		{ id: 'special:call', label: 'Special: Call' },
		...[...instance.connections.values()].map((c) => ({ id: `conn:${c.id}`, label: `Channel: ${c.label}` })),
		...[...instance.rolesets.values()].map((r) => ({ id: `role:${r.id}`, label: `Role: ${r.name}` })),
		...[...instance.ports.values()]
			.filter((p) => !p.port_settings?.port_splitLabel)
			.map((p) => ({ id: `port:${p.port_id}`, label: `Port: ${p.port_label}` })),
		...[...instance.ports.values()]
			.filter((p) => p.port_settings?.port_splitLabel)
			.map((p) => ({ id: `port:${p.port_id}`, label: `Split: ${p.port_label}` })),
	]

	const selectedTypes = instance.config.endpointTypes ?? []
	const filteredCaps = Object.entries(instance.keyAssignCapabilities).filter(
		([dt]) => selectedTypes.length === 0 || selectedTypes.includes(dt),
	)

	for (const [deviceType, caps] of filteredCaps) {
		const keyChoices = Array.from({ length: caps.keyCount }, (_, i) => ({ id: String(i), label: `Key ${i + 1}` }))
		const talkLatchChoices = caps.talkBtnModes.map((m: string) => ({ id: m, label: formatEnumLabel(m) }))

		const options: import('@companion-module/base').SomeCompanionActionInputField[] = [
			{ type: 'multidropdown', id: 'roleIds', label: 'Beltpack', default: [], choices: roleChoices },
			{ type: 'dropdown', id: 'keyIndex', label: 'Key Slot', default: '0', choices: keyChoices },
			{ type: 'dropdown', id: 'assignTo', label: 'Assign To', default: '', choices: assignToChoices },
		]

		if (caps.activationStates) {
			options.push({
				type: 'dropdown',
				id: 'activationState',
				label: 'Key Mode',
				default: caps.activationStates[0] ?? '',
				choices: caps.activationStates.map((s: string) => ({ id: s, label: formatEnumLabel(s) })),
			})
		}

		options.push({
			type: 'dropdown',
			id: 'talkBtnMode',
			label: 'Talk Button Mode',
			default: talkLatchChoices[0]?.id ?? '',
			choices: talkLatchChoices,
		})

		actions[`assign_key_channel_${deviceType.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`] = {
			name: `[${deviceType}] Assign Key`,
			options,
			learn: (action) => {
				const roleId = (action.options.roleIds as string[])[0]
				if (!roleId) return undefined
				const roleset = instance.rolesets.get(Number(roleId))
				if (!roleset) return undefined
				const session = roleset.sessions ? Object.values(roleset.sessions)[0] : undefined
				const keysetId = session?.data?.settings?.['defaultRole'] as number | undefined
				if (keysetId === undefined) return undefined
				const keyset = instance.keysets.get(keysetId)
				if (!keyset) return undefined
				const slots = keyset.settings.keysets ?? []
				const slot = slots.find((s) => s.keysetIndex === Number(action.options.keyIndex))
				if (!slot) return undefined
				const entity = slot.entities[0]
				let assignTo = ''
				if (entity) {
					if (entity.res === '/api/1/special/call') assignTo = 'special:call'
					else if (entity.type === 3) assignTo = `role:${entity.res.split('/').pop()}`
					else if (entity.type === 0) assignTo = `conn:${entity.res.split('/').pop()}`
					else if (entity.type === 1) assignTo = `port:${entity.res.split('/').pop()}`
				}
				return {
					assignTo,
					...(caps.activationStates ? { activationState: slot.activationState } : {}),
					talkBtnMode: slot.talkBtnMode,
				}
			},
			callback: async (action: CompanionActionEvent) => {
				const roleIds = (action.options.roleIds as string[]).map(Number)
				const keyIndex = Number(action.options.keyIndex)
				const assignTo = action.options.assignTo as string
				const activationState = (action.options.activationState ?? 'listen') as KeySlot['activationState']
				const talkBtnMode = action.options.talkBtnMode as KeySlot['talkBtnMode']
				await arcadia.assignKeyChannel(instance, roleIds, keyIndex, assignTo, activationState, talkBtnMode)
			},
		}
	}

	return actions
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

	const selectedTypes = instance.config.endpointTypes ?? []
	const filteredSettings =
		selectedTypes.length > 0 ? settings.filter((s) => selectedTypes.includes(s.deviceType)) : settings

	for (const setting of filteredSettings) {
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
		for (const [, status] of instance.endpointStatus) {
			if (status.association?.dpId === roleId) return status
		}
		return null
	}

	for (const def of instance.liveStatusDefs) {
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

	// Role-derived feedbacks — looked up via endpointStatus.association.dpId
	const roleFeedbacks: Array<{
		id: string
		label: string
		getValue: (roleId: number) => import('@companion-module/base').JsonValue
	}> = [
		{
			id: 'role_name',
			label: 'Role Name',
			getValue: (roleId) => instance.rolesets.get(roleId)?.name ?? null,
		},
		{
			id: 'role_label',
			label: 'Role Label',
			getValue: (roleId) => instance.rolesets.get(roleId)?.label ?? null,
		},
	]

	for (const rf of roleFeedbacks) {
		feedbacks[rf.id] = {
			type: 'value',
			name: `[Beltpack] ${rf.label}`,
			options: [roleOption],
			unsubscribe: (feedback) => {
				instance.feedbackTriggers.delete(feedback.feedbackId)
			},
			callback: (feedback) => {
				instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
				return rf.getValue(Number(feedback.options.roleId))
			},
		}
	}

	return feedbacks
}

// ─── Key state feedback builder ───────────────────────────────────────────────

export function buildKeyStateFeedbacks(
	instance: ModuleInstance,
): Record<string, CompanionValueFeedbackDefinition<{ roleId: string; keyIndex: string }>> {
	const feedbacks: Record<string, CompanionValueFeedbackDefinition<{ roleId: string; keyIndex: string }>> = {}

	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const selectedTypes = instance.config.endpointTypes ?? []
	const filteredCaps = Object.values(instance.keyAssignCapabilities).filter(
		(_, i) => selectedTypes.length === 0 || selectedTypes.includes(Object.keys(instance.keyAssignCapabilities)[i]),
	)
	const maxKeys = Math.max(1, ...filteredCaps.map((c) => c.keyCount))
	const keyChoices = Array.from({ length: maxKeys }, (_, i) => ({
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
		for (const [, status] of instance.endpointStatus) {
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

	const getKeyAssign = (roleId: number, keyIndex: number): string | null => {
		const roleset = instance.rolesets.get(roleId)
		if (!roleset) return null
		const session = roleset.sessions ? Object.values(roleset.sessions)[0] : undefined
		const keysetId = session?.data?.settings?.['defaultRole'] as number | undefined
		if (keysetId === undefined) return null
		const keyset = instance.keysets.get(keysetId)
		if (!keyset) return null
		const slots = keyset.settings.keysets ?? []
		const slot = slots.find((s) => s.keysetIndex === keyIndex)
		if (!slot) return null
		const entity = slot.entities[0]
		if (!entity) return '(empty)'
		if (entity.res === '/api/1/special/call') return 'Special: Call'
		if (entity.type === 3) {
			const id = Number(entity.res.split('/').pop())
			return instance.rolesets.get(id)?.name ?? entity.res
		}
		if (entity.type === 0) {
			const id = Number(entity.res.split('/').pop())
			return instance.connections.get(id)?.label ?? entity.res
		}
		if (entity.type === 1) {
			const id = Number(entity.res.split('/').pop())
			return instance.ports.get(id)?.port_label ?? entity.res
		}
		return entity.res
	}

	feedbacks['key_assign'] = {
		type: 'value',
		name: '[Key] Assignment',
		options: baseOptions,
		unsubscribe: (feedback) => {
			instance.feedbackTriggers.delete(feedback.feedbackId)
		},
		callback: (feedback) => {
			instance.feedbackTriggers.set(feedback.feedbackId, 'keyset')
			return getKeyAssign(Number(feedback.options.roleId), Number(feedback.options.keyIndex))
		},
	}

	return feedbacks
}

// ─── Gateway (antenna) feedback builder ──────────────────────────────────────

export function buildGatewayFeedbacks(
	instance: ModuleInstance,
): Record<
	string,
	CompanionBooleanFeedbackDefinition<{ endpointId: string }> | CompanionValueFeedbackDefinition<{ endpointId: string }>
> {
	const feedbacks: Record<
		string,
		| CompanionBooleanFeedbackDefinition<{ endpointId: string }>
		| CompanionValueFeedbackDefinition<{ endpointId: string }>
	> = {}

	const gatewayChoices = [...instance.gateways.values()].map((ep) => ({
		id: String(ep.id),
		label: ep.label,
	}))

	const gatewayOption = {
		type: 'dropdown' as const,
		id: 'endpointId' as const,
		label: 'Antenna',
		default: gatewayChoices[0]?.id ?? '',
		choices: gatewayChoices,
	}

	const getStatus = (endpointId: number) => instance.endpointStatus.get(endpointId) ?? null

	feedbacks['gateway_online'] = {
		type: 'boolean',
		name: '[Antenna] Online',
		defaultStyle: { bgcolor: 0x00ff00, color: 0x000000 } satisfies Partial<CompanionFeedbackButtonStyleResult>,
		options: [gatewayOption],
		unsubscribe: (feedback) => {
			instance.feedbackTriggers.delete(feedback.feedbackId)
		},
		callback: (feedback) => {
			instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
			return getStatus(Number(feedback.options.endpointId))?.status === 'online'
		},
	}

	feedbacks['gateway_status'] = {
		type: 'value',
		name: '[Antenna] Status',
		options: [gatewayOption],
		unsubscribe: (feedback) => {
			instance.feedbackTriggers.delete(feedback.feedbackId)
		},
		callback: (feedback) => {
			instance.feedbackTriggers.set(feedback.feedbackId, 'endpoint')
			return (getStatus(Number(feedback.options.endpointId))?.status ??
				null) as import('@companion-module/base').JsonValue
		},
	}

	return feedbacks
}
