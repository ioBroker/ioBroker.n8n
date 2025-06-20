import type {
	INodeType,
	INodeTypeDescription, ITriggerFunctions, ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

export class IoBrokerInputNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ioBroker Input',
		name: 'ioBrokerInput',
		group: ['trigger'],
		icon: 'file:ioBroker.svg',
		version: 1,
		description: 'ioBroker Input',
		defaults: {
			name: 'ioBroker Input',
			color: '#144578',
		},
		inputs: [],
		outputs: [NodeConnectionType.Main],
		// usableAsTool: true,
		properties: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'state',
				required: true,
				options: [
					{
						name: 'State',
						value: 'state',
						description: 'Trigger on the state change',
						action: 'Trigger on the state change',
					},
					{
						name: 'Object',
						value: 'object',
						description: 'Trigger on the object change',
						action: 'Trigger on the object change',
					},
				],
				description: 'State or Object',
			},
			{
				displayName: 'Object ID',
				name: 'oid',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Write here the ioBroker object ID',
				description: 'like javascript.0.myObject',
				typeOptions: {
					containerClass: 'iob-select-container',
				}
			}
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const type = this.getNodeParameter('type')
		const oid = this.getNodeParameter('oid')

		console.log('Triggering on', type, oid);

		// this.emit([this.helpers.returnJsonArray([{}])]);
		const manuallyTrigger = () => {
			this.emit([[{ json: { val: 'Manually triggered', ts: Date.now() }}]]);
		};
		setInterval(() => manuallyTrigger(), 10000);

		return {
			manualTriggerFunction: async () => manuallyTrigger(),
		};
	}
}
