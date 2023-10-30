import PanelComponent from './panel.vue';

export default {
	id: 'panel-manual-flows',
	name: 'Manual Flows',
	icon: 'bolt',
	description: 'A panel to output a list of manual flows from the selected collections which can be triggered from your dashboard.',
	component: PanelComponent,
	options: [
		{
			field: 'collections',
			type: 'string',
			name: '$t:collection',
			meta: {
				interface: 'system-collection',
				options: {
					includeSystem: true,
					includeSingleton: false,
					multiple: true,
				},
				width: 'half',
			},
		},
	],
	minWidth: 19,
	minHeight: 8,
};
