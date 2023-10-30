<template>
	<div class="panel-flows" :class="{ 'has-header': showHeader }">
		<div class="fields" v-if="Object.keys(manualFlows).length">
			<div class="flow-group" v-for="(group, collection) in manualFlows" :key="collection">
				<v-divider v-if="collections.length > 1 || !showHeader">
					<slot name="icon">
						<v-icon :name="group.collection.icon" />
					</slot>
					<slot name="title">{{ group.collection.name }}</slot>
				</v-divider>
				<div v-for="manualFlow in group.flows" :key="manualFlow.id" class="flow-field">
					<div class="flow-icon">
						<v-icon :name="manualFlow.icon ?? 'bolt'"/>
					</div>
					<div class="flow-detail">
						<span class="flow-title">{{ manualFlow.name }}</span>
						<span class="flow-desc">{{ manualFlow.description }}</span>
					</div>
					<v-button
						v-tooltip="t('run_flow_on_current_collection')"
						x-small
						:loading="runningFlows.includes(manualFlow.id)"
						@click="onFlowClick(manualFlow.id, collection)"
					>
						{{ t('run_flow') }}
					</v-button>
				</div>
			</div>
		</div>
		<v-info v-else icon="warning" title="No Flows Found" type="warning">Could not find any manual triggered flows in the selected Collections. Please check permissions and flow configuration.</v-info>
		<v-dialog :model-value="!!confirmRunFlow" @esc="resetConfirm">
			<v-card>
				<template v-if="confirmFields">
					<v-card-title>{{ confirmFields.description ?? t('run_flow_confirm') }}</v-card-title>

					<v-card-text class="confirm-form">
						<v-form
							v-if="confirmFields.fields && confirmFields.fields.length > 0"
							:fields="confirmFields.fields"
							:model-value="confirmValues"
							autofocus
							primary-key="+"
							@update:model-value="confirmValues = $event;validateForm()"
						/>
					</v-card-text>
				</template>

				<template v-else>
					<v-card-title>{{ t('unsaved_changes') }}</v-card-title>
					<v-card-text>{{ t('run_flow_on_current_edited_confirm') }}</v-card-text>
				</template>

				<v-card-actions>
					<v-button secondary @click="resetConfirm">
						{{ t('cancel') }}
					</v-button>
					<v-button :disabled="isConfirmButtonDisabled" @click="runManualFlow(confirmRunFlow, confirmRunFlowCollection)">
						{{ t('run_flow') }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</div>
</template>

<script>
import { useApi, useStores } from '@directus/extensions-sdk';
import { useI18n } from 'vue-i18n';
import { ref, unref, watch } from 'vue';
import formatTitle from '@directus/format-title';
import { cloneDeep } from 'lodash';
export default {
	props: {
		showHeader: {
			type: Boolean,
			default: false,
		},
		collections: {
			type: Array,
			default: [],
		},
	},
	setup(props){
		const { t } = useI18n();
		const api = useApi();
		const { usePermissionsStore, useCollectionsStore, useFlowsStore, useNotificationsStore } = useStores();
		const collectionsStore = useCollectionsStore();
		const { hasPermission } = usePermissionsStore();
		const flowsStore = useFlowsStore();
		const notificationStore = useNotificationsStore();
		const collections = props.collections;
		const manualFlows = ref({});
		const runningFlows = ref([]);

		const confirmRunFlow = ref(null);
		const confirmRunFlowCollection = ref(null);
		const confirmFlowDetails = ref(null);
		const confirmFields = ref(null);
		const confirmValues = ref(null);
		const isConfirmButtonDisabled = ref(true);
		let awaitingValidation = false;

		function translateString(literal) {
			let translated = literal;

			if (typeof literal === 'string' && literal.startsWith('$t:')) translated = t(literal.replace('$t:', ''));

			return translated;
		}

		function translate(obj) {
			if (typeof obj === 'string') {
				return obj.replaceAll(/(\$t:[a-zA-Z0-9.-]*)/gm, (match) => translateString(match));
			} else {
				const newObj = cloneDeep(obj);

				Object.entries(newObj).forEach(([key, val]) => {
					if (val && typeof val === 'object') (newObj)[key] = translate(val);
					if (val && typeof val === 'string') (newObj)[key] = translateString(val);
				});

				return newObj;
			}
		}

		function fetchFlows(){
			collections.forEach(collection => {
				if(hasPermission(collection, 'read')){
					manualFlows.value[collection] = {
						collection: collectionsStore.getCollection(collection),
						flows: flowsStore.getManualFlowsForCollection(collection).filter(
						(flow) =>
							(!flow.options?.location || flow.options?.location != 'item') && flow.options?.requireSelection === false
						).map((flow) => ({
							...flow,
							options: flow.options ? translate(flow.options) : null,
						})),
					};
				}
			});
			console.log(manualFlows.value);
		}

		function validateForm() {
			if(!confirmRunFlow.value || !confirmRunFlowCollection.value){
				isConfirmButtonDisabled.value = true;
			} else if(!awaitingValidation) {
				setTimeout(() => {
					const { fields } = confirmDetails();
					let notValid = 0;
					for (const field of fields || []) {
						if (
							field.meta?.required &&
							(!confirmValues.value ||
								confirmValues.value[field.field] === null ||
								confirmValues.value[field.field] === undefined ||
								confirmValues.value[field.field] === '')
						) {
							notValid++;
						}
					}

					if(notValid > 0){
						isConfirmButtonDisabled.value = true;
					} else {
						isConfirmButtonDisabled.value = false;
					}
					awaitingValidation = false;
				}, 1000); // 1 sec delay
			}
			awaitingValidation = true;
			return isConfirmButtonDisabled.value;
		}

		function confirmDetails() {
			console.log('Validating');
			if (!unref(confirmRunFlow)) return null;
			if (!unref(confirmRunFlowCollection)) return null;
			
			const flow = unref(confirmFlowDetails);

			if (!flow) return null;
			if (!flow.options?.requireConfirmation) return null;

			return {
				description: flow.options.confirmationDescription,
				fields: (flow.options.fields ?? []).map((field) => ({
					...field,
					name: !field.name && field.field ? formatTitle(field.field) : field.name,
				})),
			};
		}

		function resetConfirm() {
			confirmRunFlow.value = null;
			confirmRunFlowCollection.value = null;
			confirmFlowDetails.value = null;
			confirmFields.value = null;
			confirmValues.value = null;
		}

		async function onFlowClick(flowId, collection) {
			const flow = unref(manualFlows)[collection]['flows'].find((flow) => flow.id === flowId);

			if (!flow) return;

			if (flow.options?.requireConfirmation) {
				confirmRunFlow.value = flowId;
				confirmRunFlowCollection.value = collection;
				confirmFlowDetails.value = flow;
				confirmFields.value = confirmDetails();
			} else {
				runManualFlow(flowId, collection);
			}
		};

		async function runManualFlow(flowId, collection){
			confirmRunFlow.value = null;
			if (!confirmFlowDetails.value) return;

			runningFlows.value = [...runningFlows.value, flowId];
			try {
				await api.post(`/flows/trigger/${flowId}`, { ...(unref(confirmValues) ?? {}), collection: collection });
				notificationStore.add({
					title: t('run_flow_success', { flow: confirmFlowDetails.value.name }),
				});

				resetConfirm();
			} catch (err) {
				console.error(err);
			} finally {
				runningFlows.value = runningFlows.value.filter((runningFlow) => runningFlow !== flowId);
			}
		};

		fetchFlows();

		watch(
			[
				() => props.collections,
			],
			() => {
				collections.value = props.collections;
				fetchFlows();
			},
		);

		return {
			t,
			manualFlows,
			runningFlows,
			onFlowClick,
			confirmRunFlow,
			confirmRunFlowCollection,
			resetConfirm,
			confirmFields,
			confirmValues,
			runManualFlow,
			validateForm,
			isConfirmButtonDisabled,
		};
	},
};
</script>

<style scoped>
.panel-flows {
	padding: 12px;
	overflow-y: scroll;
	height: 100%;
}

.panel-flows.has-header {
	padding: 0 12px 12px;
}

.flow-group {
	margin-bottom: 1.5em;
}

.flow-group:last-child {
	margin-bottom: 0;
}

.flow-field {
	display: flex;
	align-items: center;
	margin-top: 0.5em;
	background-color: var(--background-subdued);
	padding: 0.5em 0.75em;
	border-radius: var(--border-radius);
	border: var(--border-width) solid var(--border-subdued);
}

.flow-icon {
	overflow: hidden;
	background-color: var(--background-normal-alt);
	border: var(--border-width) solid var(--border-subdued);
	border-radius: 50%;
	padding: 0.5em;
	line-height: 1;
	flex-shrink: 0;
}

.flow-detail {
	flex-grow: 1;
	padding: 0 1em;
}

.flow-detail * {
	display: block;
	line-height: 1.2;
}

.flow-title {
	font-weight: bold;
}

.flow-desc {
	font-size: 0.8em;
}

.v-info {
	margin-top: 2em;
}
</style>
