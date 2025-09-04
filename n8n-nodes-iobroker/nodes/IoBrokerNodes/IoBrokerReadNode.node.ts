import {
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IBinaryData,
	type IDataObject,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	NodeConnectionType,
} from 'n8n-workflow';
import { getAdapter } from './IobAdapter';

export class IoBrokerReadNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ioBroker Read',
		name: 'ioBrokerRead',
		subtitle: '={{$parameter["type"] + ($parameter["oid"] ? " - " + $parameter["oid"] : "")}}',
		group: ['output'],
		icon: 'file:ioBroker.svg',
		version: 1,
		description: 'ioBroker Read',
		usableAsTool: true,
		defaults: {
			name: 'ioBroker Read',
			color: '#144578',
		},
		inputs: [NodeConnectionType.Main], // NodeConnectionType.Main
		outputs: [NodeConnectionType.Main], // NodeConnectionType.Main
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
						description: 'Read state',
						action: 'Read state',
					},
					{
						name: 'Object',
						value: 'object',
						description: 'Read object',
						action: 'Read object',
					},
					{
						name: 'File',
						value: 'file',
						description: 'Read file',
						action: 'Read file',
					},
					{
						name: 'Logs',
						value: 'log',
						description: 'Read logs',
						action: 'Read logs',
					},
					{
						name: 'Rooms',
						value: 'rooms',
						description: 'Read rooms',
						action: 'Read rooms',
					},
					{
						name: 'Functions',
						value: 'functions',
						description: 'Read functions',
						action: 'Read functions',
					},
					{
						name: 'Devices',
						value: 'devices',
						description: 'Read devices',
						action: 'Read devices',
					},
				],
				description: 'State, Object, File, Logs, Rooms, Functions or Devices',
			},
			{
				displayName: 'Object ID',
				name: 'oid',
				type: 'string',
				default: '',
				required: true,
				// Place is important, as this input will be detected by "ioBroker object"
				placeholder: 'Write here the ioBroker object ID',
				description: 'like javascript.0.myObject',
				displayOptions: {
					show: {
						type: ['state', 'object'],
					},
				},
			},
			{
				displayName: 'File name',
				name: 'fileName',
				type: 'string',
				default: '*',
				required: true,
				// Place is important, as this input will be detected by "ioBroker file"
				placeholder: 'Write here the ioBroker file name',
				description: 'like vis-2.0/main/vis-views.json',
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
				displayName: 'Number of logs',
				name: 'logsCount',
				type: 'number',
				default: 10,
				displayOptions: {
					show: {
						type: ['log'],
					},
				},
			},
			{
				displayName: 'Log level',
				name: 'level',
				type: 'options',
				default: '',
				displayOptions: {
					show: {
						type: ['log'],
					},
				},
				options: [
					{
						name: 'Any',
						value: '',
					},
					{
						name: 'Info',
						value: 'info',
					},
					{
						name: 'Warning',
						value: 'Warn',
					},
					{
						name: 'Error',
						value: 'error',
					},
					{
						name: 'Debug',
						value: 'debug',
					},
				],
			},
			{
				displayName: 'Log instance',
				name: 'instance',
				type: 'options',
				default: '',
				placeholder: 'You can filter logs by instance',
				description: 'Like javascript.0',
				typeOptions: {
					loadOptionsMethod: 'getInstances',
				},
				displayOptions: {
					show: {
						type: ['log'],
					},
				},
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				default: 'de',
				displayOptions: {
					show: {
						type: ['rooms', 'functions', 'devices'],
					},
				},
				options: [
					{
						name: 'Deutsch',
						value: 'de',
					},
					{
						name: 'English',
						value: 'en',
					},
					{
						name: 'Русский',
						value: 'ru',
					},
					{
						name: 'Español',
						value: 'es',
					},
					{
						name: 'Français',
						value: 'fr',
					},
					{
						name: 'Italiano',
						value: 'it',
					},
					{
						name: 'Polski',
						value: 'pl',
					},
					{
						name: 'Português',
						value: 'pt',
					},
					{
						name: '中文',
						value: 'zh-cn',
					},
					{
						name: 'Українська',
						value: 'uk',
					},
				],
			},
			{
				displayName: 'With icons',
				name: 'withIcons',
				default: false,
				type: 'boolean',
				description: 'Deliver objects with icons',
				displayOptions: {
					show: {
						type: ['rooms', 'functions'],
					},
				},
			},
			{
				displayName: 'Ignore empty items',
				name: 'ignoreEmptyItems',
				default: false,
				type: 'boolean',
				description: 'Ignore rooms or functions without items',
				displayOptions: {
					show: {
						type: ['rooms', 'functions'],
					},
				},
			},
		],
	};

	retryOnFail = false;

	methods = {
		loadOptions: {
			async getInstances(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const adapter = await getAdapter();
				return await adapter.getInstances();
			},
		},
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do. In this case, we're just appending the `myString` property
	// with whatever the user has entered.
	// You can make async calls and use `await`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();

		let type: 'state' | 'object' | 'file' | 'log' | 'rooms' | 'functions' | 'devices' | undefined;
		const adapter = await getAdapter();
		const result: INodeExecutionData[] = [];

		// Iterates over all input items and add the key "myString" with the
		// value the parameter "myString" resolves to.
		// (This could be a different value for each item in case it contains an expression)
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				type = this.getNodeParameter('type', itemIndex, '') as
					| 'state'
					| 'object'
					| 'file'
					| 'log'
					| 'rooms'
					| 'functions'
					| 'devices';
				if (type === 'object') {
					const oid = this.getNodeParameter('oid', itemIndex, '') as string;
					const object = await adapter.getIobObject(oid);
					result.push({ json: (object as unknown as IDataObject) || {}, pairedItem: itemIndex });
				} else if (type === 'state') {
					const oid = this.getNodeParameter('oid', itemIndex, '') as string;
					const state = await adapter.getIobState(oid);
					result.push({ json: (state as unknown as IDataObject) || {}, pairedItem: itemIndex });
				} else if (type === 'file') {
					let fileName = this.getNodeParameter('fileName', itemIndex, '') as string;
					const base64 = this.getNodeParameter('base64', itemIndex, '') as boolean;
					if (!fileName?.replace(/^\//, '')) {
						throw new NodeOperationError(this.getNode(), 'For file type, path must be provided.');
					}
					if (fileName.startsWith('/')) {
						fileName = fileName.substring(1);
					}
					const [adapterName, ...rest] = fileName.split('/');
					if (!rest.length) {
						throw new NodeOperationError(
							this.getNode(),
							'For file type, path must contain at least one directory.',
						);
					}
					if (!adapterName) {
						throw new NodeOperationError(
							this.getNode(),
							`For file type, path must start with some adapter name like "vis-2.0", but found: ${adapterName}.`,
						);
					}
					if (!rest.join('/')) {
						throw new NodeOperationError(
							this.getNode(),
							'For file type, path must contain a file name.',
						);
					}
					const file = await adapter.getIobFile(adapterName, rest.join('/'), base64);
					result.push({
						json: {
							fileName,
							mimeType: file?.mimeType || undefined,
							content: file && typeof file.file === 'string' ? file.file : undefined,
						},
						binary:
							file?.file && typeof file.file !== 'string'
								? { file: file.file as unknown as IBinaryData }
								: undefined,
						pairedItem: itemIndex,
					});
				} else if (type === 'log') {
					const level = this.getNodeParameter('level', itemIndex, '') as ioBroker.LogLevel;
					const instance = this.getNodeParameter('instance', itemIndex, '') as string;
					const logsCount = this.getNodeParameter('logsCount', itemIndex, '') as number;
					// not implemented yet
					const messages = await adapter.readIobLog(level, instance, logsCount);
					result.push({
						json: { logs: messages },
						pairedItem: itemIndex,
					});
				} else if (type === 'rooms') {
					const language = this.getNodeParameter('language', itemIndex, 'de') as ioBroker.Languages;
					const withIcons = this.getNodeParameter('withIcons', itemIndex, false) as boolean;
					const ignoreEmptyItems = this.getNodeParameter(
						'ignoreEmptyItems',
						itemIndex,
						false,
					) as boolean;
					const enums = await adapter.readIobEnums('rooms', language, withIcons);
					if (ignoreEmptyItems) {
						result.push({
							json: { enums: enums.filter((e) => e.items.length) },
							pairedItem: itemIndex,
						});
					} else {
						result.push({ json: { enums }, pairedItem: itemIndex });
					}
				} else if (type === 'functions') {
					const language = this.getNodeParameter('language', itemIndex, 'de') as ioBroker.Languages;
					const withIcons = this.getNodeParameter('withIcons', itemIndex, false) as boolean;
					const ignoreEmptyItems = this.getNodeParameter(
						'ignoreEmptyItems',
						itemIndex,
						false,
					) as boolean;
					const enums = await adapter.readIobEnums('functions', language, withIcons);
					if (ignoreEmptyItems) {
						result.push({
							json: { enums: enums.filter((e) => e.items.length) },
							pairedItem: itemIndex,
						});
					} else {
						result.push({ json: { enums }, pairedItem: itemIndex });
					}
				} else if (type === 'devices') {
					const language = this.getNodeParameter('language', itemIndex, 'de') as ioBroker.Languages;
					const rooms = await adapter.readIobDevices(language);
					result.push({ json: { rooms }, pairedItem: itemIndex });
				}
			} catch (error) {
				// This node should never fail, but we want to showcase how
				// to handle errors.
				if (this.continueOnFail()) {
					result.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
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

		return [result];
	}
}
