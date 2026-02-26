import ModuleInstance from './main.js'
import { getRequest } from './rest.js'
import { OpenAPIV3 } from 'openapi-types'
import { promises as fs } from 'fs'
import path from 'path'
import { SettingDef, SettingValueType, LiveStatusDef } from './types.js'

// ─── Schema loading (with version-aware caching) ──────────────────────────────

export type LoadedSchemas = {
	mainSchema: OpenAPIV3.Document
	refSchemas: Record<string, OpenAPIV3.SchemaObject>
}

const SCHEMA_CACHE_DIR = './schemas'
const MAIN_SCHEMA_PATH = path.join(SCHEMA_CACHE_DIR, 'clearcom_api.json')

export async function loadSchemasAndRefs(self: ModuleInstance, deviceHost: string): Promise<LoadedSchemas> {
	await fs.mkdir(SCHEMA_CACHE_DIR, { recursive: true })

	const apiUrl = `${deviceHost}/api/1/schemas/clearcom_api.json`
	let mainSchema: OpenAPIV3.Document | null = null
	let downloadedNewMainSchema = false
	let cachedSchema: OpenAPIV3.Document | null = null

	try {
		const raw = await fs.readFile(MAIN_SCHEMA_PATH, 'utf8')
		cachedSchema = JSON.parse(raw) as OpenAPIV3.Document
		self.log('info', `Loaded cached schema version ${cachedSchema.info.version}`)
	} catch (_err) {
		self.log('info', 'No cached schema found')
	}

	try {
		const res = await getRequest(apiUrl, self)
		if (res) {
			const liveSchema = res as OpenAPIV3.Document
			if (!cachedSchema || liveSchema.info.version !== cachedSchema.info.version) {
				mainSchema = liveSchema
				downloadedNewMainSchema = true
				await fs.writeFile(MAIN_SCHEMA_PATH, JSON.stringify(liveSchema, null, 2))
				self.log('info', `Downloaded schema version ${liveSchema.info.version}`)
			} else {
				mainSchema = cachedSchema
				self.log('info', 'Schema versions match, using cached')
			}
		} else {
			mainSchema = cachedSchema
			self.log('warn', 'Failed to download schema, using cached version')
		}
	} catch (err) {
		mainSchema = cachedSchema
		self.log('warn', `Error downloading schema: ${err}, using cached version`)
	}

	if (!mainSchema) {
		throw new Error('No schema available — neither live nor cached. Cannot start module.')
	}

	const refSchemas: Record<string, OpenAPIV3.SchemaObject> = {}
	const refs: Set<string> = new Set()

	const findRefs = (obj: unknown) => {
		if (typeof obj !== 'object' || obj === null) return
		for (const key in obj as Record<string, unknown>) {
			if (key === '$ref' && typeof (obj as Record<string, unknown>)[key] === 'string') {
				refs.add((obj as Record<string, unknown>)[key] as string)
			} else {
				findRefs((obj as Record<string, unknown>)[key])
			}
		}
	}

	findRefs(mainSchema)

	for (const ref of refs) {
		if (ref.startsWith('#')) continue
		const filePath = path.join(SCHEMA_CACHE_DIR, ref)
		let shouldDownload = false

		try {
			await fs.access(filePath)
			if (downloadedNewMainSchema) shouldDownload = true
		} catch {
			shouldDownload = true
		}

		if (shouldDownload) {
			const refUrl = `${deviceHost}/api/1/schemas/${ref}`
			try {
				const res = await fetch(refUrl, {
					headers: { Authorization: `Bearer ${self.bearerToken}` },
				})
				if (!res.ok) {
					self.log('warn', `Skipping $ref ${ref}: ${res.status}`)
					continue
				}
				const body = await res.text()
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, body)
				refSchemas[ref.replace(/^\.\//, '')] = JSON.parse(body)
			} catch {
				continue
			}
		} else {
			try {
				const contents = await fs.readFile(filePath, 'utf8')
				refSchemas[ref.replace(/^\.\//, '')] = JSON.parse(contents) as OpenAPIV3.SchemaObject
			} catch {
				continue
			}
		}
	}

	return { mainSchema, refSchemas }
}

export function supportsEndpoint(schema: OpenAPIV3.Document, path: string, method: string = 'post'): boolean {
	const pathItem = schema.paths?.[path]
	if (!pathItem) return false
	return method.toLowerCase() in pathItem
}

export function getSchemaVersion(schema: OpenAPIV3.Document): string {
	return schema.info?.version || 'unknown'
}

export function getEndpointInfo(
	schema: OpenAPIV3.Document,
	path: string,
	method: string = 'post',
): { summary?: string; description?: string } | null {
	const pathItem = schema.paths?.[path]
	if (!pathItem) return null
	const operation = pathItem[method.toLowerCase() as keyof typeof pathItem] as OpenAPIV3.OperationObject | undefined
	if (!operation) return null
	return { summary: operation.summary, description: operation.description }
}

// ─── Keyset settings parser ───────────────────────────────────────────────────

export type { SettingDef, SettingValueType }

const DEFINITION_TO_DEVICE: Record<string, string> = {
	HMS4XSettings: 'HMS-4X',
	HRM4XSettings: 'HRM-4X',
	HKB2XSettings: 'HKB-2X',
	HBP2XSettings: 'HBP-2X',
	FSIIBPSettings: 'FSII-BP',
	EDGEBPSettings: 'E-BP',
	NEPSettings: 'NEP',
	VSeriesPanelSettingsBase: 'V-Series',
	VSeriesPanel12KeySettings: 'V-Series-12',
	VSeriesPanel24KeySettings: 'V-Series-24',
	VSeriesPanel32KeySettings: 'V-Series-32',
}

const SKIP_KEYS = new Set([
	'keysets',
	'groups',
	'gpios',
	'pgmAssignments',
	'saConnectionAssignments',
	'logicInput1ActionDestination',
	'logicInput2ActionDestination',
])

function toLabel(key: string): string {
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (c) => c.toUpperCase())
		.trim()
}

function parseProperty(prop: Record<string, unknown>): SettingValueType | null {
	const type = prop.type as string
	const enumVals = prop.enum as unknown[] | undefined

	if (type === 'boolean') return { kind: 'boolean' }

	if (type === 'string') {
		if (enumVals) return { kind: 'string-enum', values: enumVals as string[] }
		return null
	}

	if (type === 'integer' || type === 'number') {
		if (enumVals) {
			const nums = (enumVals as (number | null)[]).filter((v): v is number => v !== null)
			return { kind: 'number-enum', values: nums }
		}
		if ('minimum' in prop && 'maximum' in prop) {
			return {
				kind: 'integer',
				min: prop.minimum as number,
				max: prop.maximum as number,
				step: (prop.multipleOf as number) ?? 1,
			}
		}
	}

	return null
}

export function parseKeysetSettings(schema: Record<string, unknown>): SettingDef[] {
	const definitions = schema.definitions as Record<string, Record<string, unknown>>
	const results: SettingDef[] = []

	for (const [defName, deviceType] of Object.entries(DEFINITION_TO_DEVICE)) {
		const def = definitions[defName]
		if (!def) continue
		const properties = def.properties as Record<string, Record<string, unknown>> | undefined
		if (!properties) continue

		for (const [key, prop] of Object.entries(properties)) {
			if (SKIP_KEYS.has(key)) continue
			const valueType = parseProperty(prop)
			if (!valueType) continue

			results.push({
				key,
				label: toLabel(key),
				deviceType,
				valueType,
				supportsIncDec: valueType.kind === 'integer' || valueType.kind === 'number-enum',
			})
		}
	}

	return results
}

export async function loadAndLogKeysetSettings(
	instance: ModuleInstance,
	refSchemas: Record<string, OpenAPIV3.SchemaObject>,
): Promise<SettingDef[]> {
	const schemaKey = 'request_schemas/keysets_put_update_2.schema.json'
	const schema = refSchemas[schemaKey] as Record<string, unknown> | undefined

	if (!schema) {
		instance.log('warn', 'Keyset schema not available — skipping settings parse')
		return []
	}

	const settings = parseKeysetSettings(schema)

	const byDevice: Record<string, number> = {}
	for (const s of settings) byDevice[s.deviceType] = (byDevice[s.deviceType] ?? 0) + 1
	const summary = Object.entries(byDevice)
		.map(([dt, n]) => `${dt}:${n}`)
		.join(', ')
	instance.log('info', `Keyset settings loaded: ${settings.length} total (${summary})`)

	return settings
}

// ─── Key assign capabilities parser ──────────────────────────────────────────

// V-Series variants only define key count — capabilities inherited from base
const V_SERIES_BASE = 'VSeriesPanelSettingsBase'
const V_SERIES_VARIANTS = new Set([
	'VSeriesPanel12KeySettings',
	'VSeriesPanel24KeySettings',
	'VSeriesPanel32KeySettings',
])

export function parseKeyAssignCapabilities(
	schema: Record<string, unknown>,
): Record<string, import('./types.js').KeyAssignCapabilities> {
	const definitions = schema.definitions as Record<string, Record<string, unknown>> | undefined
	if (!definitions) return {}

	const getKeysetsItemProps = (defName: string): Record<string, unknown> => {
		const source = V_SERIES_VARIANTS.has(defName) ? V_SERIES_BASE : defName
		const def = definitions[source]
		if (!def) return {}
		const keysets = (def.properties as Record<string, Record<string, unknown>> | undefined)?.keysets
		return (keysets?.items as Record<string, Record<string, unknown>> | undefined)?.properties ?? {}
	}

	const result: Record<string, import('./types.js').KeyAssignCapabilities> = {}

	for (const [defName, deviceType] of Object.entries(DEFINITION_TO_DEVICE)) {
		const def = definitions[defName]
		if (!def) continue

		// Key count: from this definition or base
		const keysets = (def.properties as Record<string, Record<string, unknown>> | undefined)?.keysets
		const keyCount = keysets?.maxItems as number | undefined
		if (keyCount === undefined) continue

		const itemProps = getKeysetsItemProps(defName)
		const activationStates =
			((itemProps.activationState as Record<string, unknown> | undefined)?.enum as string[] | null) ?? null
		const talkBtnModes = (itemProps.talkBtnMode as Record<string, unknown> | undefined)?.enum as string[] | undefined

		if (!talkBtnModes) continue

		result[deviceType] = { keyCount, activationStates, talkBtnModes }
	}

	return result
}

// ─── Live status defs parser ──────────────────────────────────────────────────

// Keys to skip — internal/structural fields not useful as feedbacks
const SKIP_LIVE_STATUS_KEYS = new Set([
	'role',
	'session',
	'syncState',
	'antennaIndex',
	'antennaSlot',
	'frequencyType',
	'wirelessStatus',
])

// Override labels for specific keys
const LIVE_STATUS_LABEL_OVERRIDES: Record<string, string> = {
	'longevity.hours': 'Time Remaining Hours',
	'longevity.minutes': 'Time Remaining Minutes',
}

function toLiveLabel(key: string): string {
	if (LIVE_STATUS_LABEL_OVERRIDES[key]) return LIVE_STATUS_LABEL_OVERRIDES[key]
	return key
		.replace(/([A-Z])/g, ' $1')
		.replace(/^./, (c) => c.toUpperCase())
		.trim()
}

export function parseLiveStatusDefs(schema: Record<string, unknown>): LiveStatusDef[] {
	const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {}
	const results: LiveStatusDef[] = []

	for (const [key, prop] of Object.entries(props)) {
		if (SKIP_LIVE_STATUS_KEYS.has(key)) continue

		if (key === 'status') {
			results.push({ key: 'status', label: 'Online', kind: 'boolean' })
			continue
		}

		if (prop.type === 'object' && prop.properties) {
			for (const subkey of Object.keys(prop.properties as Record<string, unknown>)) {
				results.push({ key: `${key}.${subkey}`, label: toLiveLabel(`${key}.${subkey}`), kind: 'value' })
			}
			continue
		}

		results.push({ key, label: toLiveLabel(key), kind: 'value' })
	}

	return results
}
