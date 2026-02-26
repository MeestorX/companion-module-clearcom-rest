import { InstanceTypes, InstanceBase, InstanceStatus, SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { postRequest, connectArcadiaSocket, disconnectArcadiaSocket } from './rest.js'
import {
	EndpointLiveStatus,
	Endpoint,
	Roleset,
	Keyset,
	Connection,
	Port,
	LiveStatusDef,
	KeyAssignCapabilities,
	FeedbacksSchema,
} from './types.js'
import {
	loadSchemasAndRefs,
	loadAndLogKeysetSettings,
	parseLiveStatusDefs,
	parseKeyAssignCapabilities,
} from './loadschemas.js'

export type { EndpointLiveStatus }

export interface ModuleTypes extends InstanceTypes {
	config: ModuleConfig
	feedbacks: FeedbacksSchema
}

export default class ModuleInstance extends InstanceBase<ModuleTypes> {
	config!: ModuleConfig
	bearerToken: string = ''
	endpointStatus: Map<number, EndpointLiveStatus> = new Map()
	rolesets: Map<number, Roleset> = new Map()
	keysets: Map<number, Keyset> = new Map()
	connections: Map<number, Connection> = new Map()
	ports: Map<number, Port> = new Map()
	gateways: Map<number, Endpoint> = new Map()
	settingDefs: import('./types.js').SettingDef[] = []
	liveStatusDefs: LiveStatusDef[] = []
	keyAssignCapabilities: Record<string, KeyAssignCapabilities> = {}
	// Maps feedbackId → trigger type ('endpoint' | 'keyset')
	feedbackTriggers: Map<string, 'endpoint' | 'keyset'> = new Map()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.updateVariableDefinitions()
		await this.configUpdated(config)
	}

	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
		disconnectArcadiaSocket(this)
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		disconnectArcadiaSocket(this)
		this.updateStatus(InstanceStatus.Connecting)
		const ok = await this.getAPI()
		if (ok) {
			this.updateActions()
			this.updateFeedbacks()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	async getAPI(): Promise<boolean> {
		const apiBaseUrl = `http://${this.config.host}`
		try {
			const postResponse = await postRequest<{ jwt: string }>(apiBaseUrl + '/auth/local/login', this, {
				logemail: 'admin',
				logpassword: this.config.password,
			})
			if (!postResponse) {
				this.updateStatus(InstanceStatus.ConnectionFailure, 'Login failed')
				return false
			}

			this.bearerToken = postResponse.jwt

			const { mainSchema: _mainSchema, refSchemas } = await loadSchemasAndRefs(this, apiBaseUrl)
			this.settingDefs = await loadAndLogKeysetSettings(this, refSchemas)

			const endpointSchema = refSchemas['response_schemas/endpoint_get.schema.json'] as
				| Record<string, unknown>
				| undefined
			const liveStatusSchema = (endpointSchema?.properties as Record<string, unknown> | undefined)?.liveStatus as
				| Record<string, unknown>
				| undefined
			if (liveStatusSchema?.properties) this.liveStatusDefs = parseLiveStatusDefs(liveStatusSchema)

			const keysetSchema = refSchemas['request_schemas/keysets_put_update_2.schema.json'] as
				| Record<string, unknown>
				| undefined
			if (keysetSchema) this.keyAssignCapabilities = parseKeyAssignCapabilities(keysetSchema)

			connectArcadiaSocket(this)
			return true
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.log('error', msg)
			this.updateStatus(InstanceStatus.UnknownError, msg)
			return false
		}
	}
}

export { UpgradeScripts }
