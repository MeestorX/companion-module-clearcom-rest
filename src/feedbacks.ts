import ModuleInstance from './main.js'
import { buildKeysetFeedbacks, buildLiveStatusFeedbacks, buildKeyStateFeedbacks } from './createcmds.js'

export function UpdateFeedbacks(instance: ModuleInstance): void {
	const feedbacks = {
		...buildKeysetFeedbacks(instance, instance.settingDefs),
		...buildLiveStatusFeedbacks(instance),
		...buildKeyStateFeedbacks(instance),
	}
	instance.setFeedbackDefinitions(feedbacks as any)
}
