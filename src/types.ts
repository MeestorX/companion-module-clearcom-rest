export type KeyState = Record<string, { keysetIndex: number; currentState: string; volume: number }>

export type EndpointLiveStatus = {
	status: string
	internalStatus: string
	batteryLevel: number
	batteryType: string
	batteryStatus: number
	rssi: number
	linkQuality: number
	frameErrorRate: number
	antennaIndex: number
	antennaSlot: number
	longevity: { hours: number; minutes: number }
	gid: string
	session: string
	sessionRes: string
	association: { dpId: number; dpType: string; dpGid: string }
	keyState: KeyState
	device_id: number
}

export type Endpoint = {
	id: number
	gid: string
	label: string
	type: string
	device_id: number
	isGateway?: boolean
	liveStatus: EndpointLiveStatus | Record<string, never>
}

export type RolesetSession = {
	gid: string
	res: string
	live: Record<string, unknown>
	data: {
		id: number
		type: string
		label?: string
		auth?: unknown[]
		profile?: Record<string, unknown>
		settings?: Record<string, unknown>
	}
}

export type Roleset = {
	id: number
	name: string
	label?: string
	sessions?: Record<string, RolesetSession>
}

export type EndpointUpdatedLiveStatus = {
	endpointId: number
	path: 'liveStatus'
	value: EndpointLiveStatus | Record<string, never>
}

export type EndpointUpdatedKeyState = {
	endpointId: number
	path: 'liveStatus.keyState'
	value: KeyState
}

export type EndpointUpdatedEvent = EndpointUpdatedLiveStatus | EndpointUpdatedKeyState

export type KeysetEntity = {
	res: string
	gid?: string
	type: number
}

export type KeySlot = {
	keysetIndex: number
	entities: KeysetEntity[]
	activationState: string
	isCallKey: boolean
	isReplyKey?: boolean
	talkBtnMode: string
}

export type Keyset = {
	id: number
	type: string
	settings: {
		keysets?: KeySlot[]
		portInputGain?: number
		[key: string]: unknown
	}
}

// ─── Schema-derived setting definitions ──────────────────────────────────────

export type SettingValueType =
	| { kind: 'integer'; min: number; max: number; step: number }
	| { kind: 'number-enum'; values: number[] }
	| { kind: 'string-enum'; values: string[] }
	| { kind: 'boolean' }

export type SettingDef = {
	key: string
	label: string
	deviceType: string
	valueType: SettingValueType
	supportsIncDec: boolean
}

// ─── Feedback schema types ────────────────────────────────────────────────────

export type BooleanFeedbackSchema = {
	type: 'boolean'
	options: {
		roleId: string
	}
}

export type ValueFeedbackSchema = {
	type: 'value'
	options: {
		roleId: string
	}
}

export type FeedbacksSchema = Record<string, BooleanFeedbackSchema | ValueFeedbackSchema>

// ─── Live status field definitions ───────────────────────────────────────────

export type LiveStatusDef = {
	key: string // dot-notation path into EndpointLiveStatus
	label: string
	kind: 'boolean' | 'value'
}

export type Connection = {
	id: number
	label: string
	res: string
	type: 'partyline' | 'group' | 'direct'
}

export type Port = {
	port_id: number
	port_label: string
	res: string
	port_settings?: { port_splitLabel?: boolean }
}

export type KeyAssignCapabilities = {
	keyCount: number
	activationStates: string[] | null
	talkBtnModes: string[]
}
