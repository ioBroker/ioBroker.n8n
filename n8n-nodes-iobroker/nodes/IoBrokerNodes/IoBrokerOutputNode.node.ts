import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

export class IoBrokerOutputNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ioBroker Output',
		name: 'ioBrokerOutput',
		group: ['output'],
		icon: 'file:ioBroker.svg',
		version: 1,
		description: 'ioBroker Output',
		defaults: {
			name: 'ioBroker Output',
			color: '#144578',
		},
		inputs: [NodeConnectionType.Main],
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
						description: 'Write to state',
						action: 'Write to state',
					},
					{
						name: 'Object',
						value: 'object',
						description: 'Write to object',
						action: 'Write to object',
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
				placeholder: 'Write here the object ID',
				description: 'like javascript.0.myObject',
			},
			{
				displayName: 'Value',
				name: 'val',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Value or JSON object'
			},
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		let item: INodeExecutionData;
		let type: 'state' | 'object' | undefined;
		let val = '';
		let oid = '';

		// Iterates over all input items and add the key "myString" with the
		// value the parameter "myString" resolves to.
		// (This could be a different value for each item in case it contains an expression)
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				type = this.getNodeParameter('type', itemIndex, '') as 'state' | 'object';
				oid = this.getNodeParameter('oid', itemIndex, '') as string;
				val = this.getNodeParameter('val', itemIndex, '') as string;
				item = items[itemIndex];

				// Get the value to write based on the type
				console.log(`Writing to ${type} with OID: ${oid} and value: ${val}`);
				console.log(item);
				console.log(process.env.IOB_HOST);
			} catch (error) {
				// This node should never fail, but we want to showcase how
				// to handle errors.
				if (this.continueOnFail()) {
					items.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
				} else {
					// Adding `itemIndex` allows other workflows to handle this error
					if (error.context) {
						// If the error thrown already contains the context property,
						// only append the itemIndex
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, {
						itemIndex,
					});
				}
			}
		}

		return [items];
	}
}
