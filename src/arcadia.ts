import ModuleInstance from './main.js'
import { getRequest, postRequest, putRequest, fetchKeysets } from './rest.js'
import { BeltpackEndpoint, SettingDef } from './types.js'

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function remoteMicKill(instance: ModuleInstance, roleId: string): Promise<void> {
	let endpointId: number | null = null

	if (roleId) {
		endpointId =
			[...instance.beltpackStatus.keys()].find(
				(id) => instance.beltpackStatus.get(id)?.association?.dpId === Number(roleId),
			) ?? null
		if (endpointId === null) {
			instance.log('warn', `RMK: no online beltpack found for role ${roleId}`)
			return
		}
	}

	const epSegment = endpointId !== null ? `/${endpointId}` : ''
	const endpoint = `http://${instance.config.host}/api/1/devices/1/endpoints${epSegment}/rmk`
	try {
		const response = await postRequest<{ ok: boolean }>(endpoint, instance)
		instance.log('info', `RMK sent (role=${roleId || 'all'}): ${JSON.stringify(response, null, 2)}`)
	} catch (error) {
		instance.log('error', `Failed to send RMK (role=${roleId || 'all'}): ${String(error)}`)
	}
}

export async function getLiveStatus(instance: ModuleInstance): Promise<BeltpackEndpoint[] | null> {
	try {
		return await getRequest<BeltpackEndpoint[]>(`http://${instance.config.host}/api/1/connections/liveStatus`, instance)
	} catch (error) {
		instance.log('error', `Failed to get live status: ${String(error)}`)
		return null
	}
}

export async function setKeyset(
	instance: ModuleInstance,
	roleIds: number[],
	settingKey: string,
	value: unknown,
	mode: 'absolute' | 'increment' | 'decrement',
	settingDef: SettingDef,
): Promise<void> {
	const url = `http://${instance.config.host}/api/2/keysets`
	const body: Record<string, unknown> = {}

	for (const roleId of roleIds) {
		const roleset = instance.rolesets.get(roleId)
		if (!roleset) {
			instance.log('warn', `setKeyset: no roleset for role ${roleId}`)
			continue
		}
		const session = roleset.sessions ? Object.values(roleset.sessions)[0] : undefined
		const keysetId = session?.data?.settings?.['defaultRole'] as number | undefined
		if (keysetId === undefined) {
			instance.log('warn', `setKeyset: no defaultRole for role ${roleId}`)
			continue
		}

		let resolvedValue = value

		if (mode !== 'absolute') {
			const current = instance.keysets.get(keysetId)
			if (!current) {
				instance.log('warn', `setKeyset: no cached keyset for keysetId ${keysetId}`)
				continue
			}
			const currentValue = current.settings[settingKey]
			const vt = settingDef.valueType

			if (vt.kind === 'integer') {
				const cur = (currentValue as number) ?? 0
				const next = mode === 'increment' ? cur + vt.step : cur - vt.step
				resolvedValue = Math.min(vt.max, Math.max(vt.min, next))
			} else if (vt.kind === 'number-enum') {
				const idx = vt.values.indexOf(currentValue as number)
				const next = mode === 'increment' ? idx + 1 : idx - 1
				resolvedValue = vt.values[Math.min(vt.values.length - 1, Math.max(0, next))]
			}
		}

		body[String(keysetId)] = { type: settingDef.deviceType, settings: { [settingKey]: resolvedValue } }
	}

	if (Object.keys(body).length === 0) return

	try {
		const response = await putRequest<{ ok: boolean; message: string }>(url, instance, body)
		instance.log('info', `setKeyset [${settingKey}]: ${JSON.stringify(response)}`)
		void fetchKeysets(instance)
	} catch (error) {
		instance.log('error', `setKeyset [${settingKey}] failed: ${String(error)}`)
	}
}
