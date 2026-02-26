import { CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import ModuleInstance from './main.js'
import * as arcadia from './arcadia.js'
import { buildKeysetActions, buildKeyAssignActions } from './createcmds.js'

export function UpdateActions(instance: ModuleInstance): void {
	const roleChoices = [...instance.rolesets.values()].map((rs) => ({
		id: String(rs.id),
		label: rs.name,
	}))

	const actions: CompanionActionDefinitions = {
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

	instance.setActionDefinitions({
		...buildKeysetActions(instance, instance.settingDefs),
		...buildKeyAssignActions(instance),
		...actions,
	})
}
