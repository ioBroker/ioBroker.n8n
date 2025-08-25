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
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
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
				displayName: 'Content as base64',
				name: 'base64',
				type: 'boolean',
				default: false,
				required: false,
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
				displayName: 'Acknowledgment',
				name: 'ack',
				type: 'boolean',
				default: false,
				required: false,
				placeholder: 'ack',
				displayOptions: {
					show: {
						type: ['state'],
					},
				},
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
		let val: ioBroker.StateValue = '';
		let oid = '';
		let ack = false;
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
					const _ack = this.getNodeParameter('ack', itemIndex, '') as any;
					ack = _ack === true || _ack === 'true' || _ack === 1 || _ack === '1';

					// May be it is a JSON object
					if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
						const parsedState = JSON.parse(val);
						if (typeof parsedState.val !== 'undefined') {
							val = parsedState.val;
							ack = parsedState.ack ?? ack;
						}
					}

					// For state type, we assume val is a simple value
					const obj = await adapter.getIobObject(oid);
					if (!obj) {
						throw new NodeOperationError(this.getNode(), `Object with OID ${oid} does not exist.`);
					}
					if (obj.type !== 'state') {
						throw new NodeOperationError(this.getNode(), `OID ${oid} is not a state object.`);
					}
					if (obj.common?.type === 'number') {
						if (val === null) {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'string') {
							await adapter.setIobState(oid, { val: parseFloat(val), ack });
						} else if (typeof val === 'number') {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'boolean') {
							await adapter.setIobState(oid, { val: val ? 1 : 0, ack });
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Value for OID ${oid} must be a number.`,
							);
						}
					} else if (obj.common?.type === 'boolean') {
						if (val === null) {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'string') {
							await adapter.setIobState(oid, {
								val: val.toLowerCase() === 'true' || val === '1',
								ack,
							});
						} else if (typeof val === 'boolean') {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'number') {
							await adapter.setIobState(oid, { val: !!val, ack });
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Value for OID ${oid} must be a boolean.`,
							);
						}
					} else if (obj.common?.type === 'string') {
						if (val === null) {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'string') {
							await adapter.setIobState(oid, { val, ack });
						} else if (typeof val === 'number' || typeof val === 'boolean') {
							// Convert number or boolean to string
							await adapter.setIobState(oid, { val: val.toString(), ack });
						} else {
							// For other types, convert to string
							await adapter.setIobState(oid, { val: JSON.stringify(val), ack });
						}
					} else {
						// For other types, we assume val is a simple value
						await adapter.setIobState(oid, { val, ack: false });
					}
				} else if (type === 'file') {
					const fileName = this.getNodeParameter('fileName', itemIndex, '') as string;
					const base64 = this.getNodeParameter('base64', itemIndex, '') as boolean;
					if (!oid) {
						throw new NodeOperationError(this.getNode(), 'For file type, OID must be provided.');
					}
					if (!fileName) {
						throw new NodeOperationError(this.getNode(), 'For file type, path must be provided.');
					}
					// For file type, we assume val is the file content
					// Here, we write the file to the specified path
					await adapter.setIobFile(oid, fileName, val, base64);
					// Note: Error handling for file operations can be improved
				} else if (type === 'log') {
					const level: ioBroker.LogLevel = this.getNodeParameter(
						'level',
						itemIndex,
						'',
					) as ioBroker.LogLevel;
					// For log type, we assume val is a string message
					if (typeof val !== 'string') {
						throw new NodeOperationError(this.getNode(), `Value for log must be a string.`);
					}
					if (level === 'error') {
						adapter.writeIobLog(val, 'error');
					} else if (level === 'warn') {
						adapter.writeIobLog(val, 'warn');
					} else if (level === 'debug') {
						adapter.writeIobLog(val, 'debug');
					} else {
						adapter.writeIobLog(val, 'info');
					}
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
