import {
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	NodeConnectionType,
} from 'n8n-workflow';
import { getAdapter } from './IobAdapter';

export class IoBrokerOutputNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ioBroker Output',
		name: 'ioBrokerOutput',
		subtitle: '={{$parameter["type"] + ($parameter["oid"] ? " - " + $parameter["oid"] : "")}}',
		group: ['output'],
		icon: 'file:ioBroker.svg',
		version: 1,
		description: 'ioBroker Output',
		defaults: {
			name: 'ioBroker Output',
			color: '#144578',
		},
		inputs: [NodeConnectionType.Main], // NodeConnectionType.Main
		outputs: [NodeConnectionType.Main], // NodeConnectionType.Main
		// usableAsTool: true,
		properties: [
			{
				noDataExpression: true,
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
					{
						name: 'File',
						value: 'file',
						description: 'Write to file',
						action: 'Write to file',
					},
					{
						name: 'Logs',
						value: 'log',
						description: 'Write to logs',
						action: 'Write to logs',
					},
				],
				description: 'State, Object, File or Log',
			},
			{
				displayName: 'Object ID',
				name: 'oid',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Write here the ioBroker object ID',
				description: 'like javascript.0.myObject',
				displayOptions: {
					show: {
						type: ['state', 'object', 'file'],
					},
				},
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'File name',
				description: 'like main/vis-views.json',
				displayOptions: {
					show: {
						type: ['file'],
					},
				},
			},
			{
				displayName: 'Value',
				name: 'val',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Value or JSON object',
			},
			{
				displayName: 'Log Level',
				name: 'level',
				type: 'options',
				default: 'info',
				options: [
					{
						name: 'Info',
						value: 'info',
					},
					{
						name: 'Debug',
						value: 'debug',
					},
					{
						name: 'Warning',
						value: 'warn',
					},
					{
						name: 'Error',
						value: 'error',
					},
				],
				displayOptions: {
					show: {
						type: ['log'],
					},
				},
			},
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		let type: 'state' | 'object' | undefined;
		let val = '';
		let oid = '';
		const adapter = await getAdapter();

		// Iterates over all input items and add the key "myString" with the
		// value the parameter "myString" resolves to.
		// (This could be a different value for each item in case it contains an expression)
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				type = this.getNodeParameter('type', itemIndex, '') as 'state' | 'object';
				oid = this.getNodeParameter('oid', itemIndex, '') as string;
				val = this.getNodeParameter('val', itemIndex, '') as string;

				// Get the value to write based on the type
				if (type === 'object') {
					// For object type, we assume val is a JSON string
					if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
						const jsonValue = JSON.parse(val);
						await adapter.setIobObject(oid, jsonValue);
					} else if (typeof val === 'object' && val !== null) {
						// If val is already an object, we can directly use it
						await adapter.setIobObject(oid, val);
					} else {
						throw new NodeOperationError(
							this.getNode(),
							`Value for OID ${oid} must be a valid JSON object.`,
						);
					}
				} else if (type === 'state') {
					// For state type, we assume val is a simple value
					const obj = await adapter.getIobObject(oid);
					if (!obj) {
						throw new NodeOperationError(this.getNode(), `Object with OID ${oid} does not exist.`);
					}
					if (obj.type !== 'state') {
						throw new NodeOperationError(this.getNode(), `OID ${oid} is not a state object.`);
					}
					if (obj.common?.type === 'number') {
						if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
							// If the value is a JSON object, parse it
							const parsedState = JSON.parse(val);
							if (typeof parsedState.val !== 'number') {
								throw new NodeOperationError(
									this.getNode(),
									`Value for OID ${oid} must be a number.`,
								);
							}
							await adapter.setIobState(oid, parsedState);
						} else {
							await adapter.setIobState(oid, { val: parseFloat(val), ack: false });
						}
					} else if (obj.common?.type === 'boolean') {
						if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
							// If the value is a JSON object, parse it
							const parsedState = JSON.parse(val);
							if (typeof parsedState.val !== 'boolean') {
								throw new NodeOperationError(
									this.getNode(),
									`Value for OID ${oid} must be a boolean.`,
								);
							}
							await adapter.setIobState(oid, parsedState);
						} else {
							await adapter.setIobState(oid, { val: val.toLowerCase() === 'true', ack: false });
						}
					} else if (obj.common?.type === 'string') {
						if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
							// If the value is a JSON object, parse it
							const parsedState = JSON.parse(val);
							if (typeof parsedState.val !== 'string') {
								throw new NodeOperationError(
									this.getNode(),
									`Value for OID ${oid} must be a string.`,
								);
							}
							await adapter.setIobState(oid, parsedState);
						} else {
							await adapter.setIobState(oid, { val: val.toString(), ack: false });
						}
					} else {
						// For other types, we assume val is a simple value
						if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
							// If the value is a JSON object, parse it
							const parsedState = JSON.parse(val);
							await adapter.setIobState(oid, parsedState);
						} else {
							await adapter.setIobState(oid, { val, ack: false });
						}
					}
				} else if (type === 'file') {
					// later
				} else if (type === 'log') {
					// For log type, we assume val is a string message
					if (typeof val !== 'string') {
						throw new NodeOperationError(this.getNode(), `Value for log must be a string.`);
					}
					adapter.writeIobLog(val, 'info');
				}
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
