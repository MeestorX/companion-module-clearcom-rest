import { CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import { KeySlot } from './types.js'
import ModuleInstance from './main.js'
import * as arcadia from './arcadia.js'
import { buildKeysetActions } from './createcmds.js'

export function UpdateActions(instance: ModuleInstance): void {
	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const actions: CompanionActionDefinitions = {
		assign_key_channel: {
			name: 'Assign Key Channel',
			options: [
				{
					type: 'multidropdown',
					label: 'Beltpack',
					id: 'roleIds',
					default: [],
					choices: roleChoices,
				},
				{
					type: 'dropdown',
					label: 'Key Slot',
					id: 'keyIndex',
					default: '0',
					choices: [0, 1, 2, 3, 4].map((i) => ({ id: String(i), label: `Key ${i + 1}` })),
				},
				{
					type: 'dropdown',
					label: 'Assign To',
					id: 'assignTo',
					default: '',
					choices: [
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
					],
				},
				{
					type: 'dropdown',
					label: 'Key Mode',
					id: 'activationState',
					default: 'talk',
					choices: [
						{ id: 'talk', label: 'Talk Only' },
						{ id: 'listen', label: 'Listen Only' },
						{ id: 'talklisten', label: 'Talk & Listen' },
						{ id: 'dualtalklisten', label: 'Dual Talk & Listen' },
						{ id: 'forcelisten', label: 'Force Listen' },
						{ id: 'talkforcelisten', label: 'Talk & Force Listen' },
						{ id: 'forcetalkforcelisten', label: 'Force Talk & Force Listen' },
					],
				},
				{
					type: 'checkbox',
					label: 'Talk Latch',
					id: 'talkLatch',
					default: false,
				},
			],
			callback: async (action: CompanionActionEvent) => {
				const roleIds = (action.options.roleIds as string[]).map(Number)
				const keyIndex = Number(action.options.keyIndex)
				const assignTo = action.options.assignTo as string
				const activationState = action.options.activationState as KeySlot['activationState']
				const talkLatch = action.options.talkLatch as boolean
				await arcadia.assignKeyChannel(instance, roleIds, keyIndex, assignTo, activationState, talkLatch)
			},
		},
		remote_mic_kill: {
			name: 'Remote Mic Kill (RMK)',
			options: [
				{
					type: 'multidropdown',
					label: 'Beltpack',
					id: 'roleIds',
					default: [],
					choices: [{ id: '', label: 'All' }, ...roleChoices],
				},
			],
			callback: async (action: CompanionActionEvent) => {
				const selected = action.options.roleIds as string[]
				for (const id of selected) {
					await arcadia.remoteMicKill(instance, id)
				}
			},
		},
	}

	const generatedActions = buildKeysetActions(instance, instance.settingDefs)
	instance.setActionDefinitions({ ...generatedActions, ...actions })
}
