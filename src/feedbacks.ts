import ModuleInstance from './main.js'
import {
	buildKeysetFeedbacks,
	buildLiveStatusFeedbacks,
	buildKeyStateFeedbacks,
	buildGatewayFeedbacks,
} from './createcmds.js'

export function UpdateFeedbacks(instance: ModuleInstance): void {
	const feedbacks = {
		...buildKeysetFeedbacks(instance, instance.settingDefs),
		...buildLiveStatusFeedbacks(instance),
		...buildKeyStateFeedbacks(instance),
		...buildGatewayFeedbacks(instance),
	}
	instance.setFeedbackDefinitions(feedbacks as any)
}
