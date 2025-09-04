import {
	type INodeType,
	type INodeTypeDescription,
	type ITriggerFunctions,
	type ITriggerResponse,
	type IDataObject,
	type IBinaryData,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	NodeConnectionType,
	NodeOperationError,
} from 'n8n-workflow';
import {
	getAdapter,
	type IobFileSubscriptionHandler,
	type IobLogSubscriptionHandler,
	type IobObjectSubscriptionHandler,
	type IobStateSubscriptionHandler,
} from './IobAdapter';

export class IoBrokerTriggerNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ioBroker Input',
		name: 'ioBrokerInput',
		subtitle: '={{$parameter["type"] + ($parameter["oid"] ? " - " + $parameter["oid"] : "")}}',
		group: ['trigger'],
		icon: 'file:ioBroker.svg',
		version: 1,
		description: 'ioBroker Input',
		defaults: {
			name: 'ioBroker Input',
			color: '#144578',
		},
		inputs: [],
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
						description: 'Trigger on the state change',
						action: 'Trigger on the state change',
					},
					{
						name: 'Object',
						value: 'object',
						description: 'Trigger on the object change',
						action: 'Trigger on the object change',
					},
					{
						name: 'File',
						value: 'file',
						description: 'Trigger on the file change',
						action: 'Trigger on the file change',
					},
					{
						name: 'Logs',
						value: 'log',
						description: 'Trigger on the new log entry',
						action: 'Trigger on the new log entry',
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
				displayName: 'With content',
				name: 'withContent',
				type: 'boolean',
				default: false,
				description: 'With file content',
				displayOptions: {
					show: {
						type: ['file'],
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
						value: 'warn',
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
		],
	};

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
	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const type = this.getNodeParameter('type') as 'state' | 'object' | 'file' | 'log';
		if (type === 'log') {
			// For logs, we don't need an OID, but we can filter by instance
			const instance = this.getNodeParameter('instance') as string;
			const level = this.getNodeParameter('level') as ioBroker.LogLevel;

			const logHandler: IobLogSubscriptionHandler = (message?: ioBroker.LogMessage): void => {
				this.emit([[{ json: message as unknown as IDataObject }]]);
			};

			await getAdapter({ nodeId: this.getNode().id, logHandler, instance, level });

			return {};
		} else if (type === 'file') {
			// For files, we need the file name
			let fileName = this.getNodeParameter('fileName') as string;
			const withContent = this.getNodeParameter('withContent') as boolean;
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
			fileName = rest.join('/');
			console.log('Listening for ', type, adapterName, fileName);
			const fileHandler: IobFileSubscriptionHandler = (
				id: string,
				fileName: string,
				size?: number | null,
				file?: { file: string | Buffer; mimeType?: string },
			): void => {
				console.log('Triggering on file', type, id, fileName);
				this.emit([
					[
						{
							json: {
								fileName,
								size,
								mimeType: file?.mimeType || undefined,
								content: file && typeof file.file === 'string' ? file.file : undefined,
							},
							binary:
								file?.file && typeof file.file !== 'string'
									? { file: file.file as unknown as IBinaryData }
									: undefined,
						},
					],
				]);
			};

			const nodeId = this.getNode().id;
			await getAdapter({ nodeId, oid: adapterName, fileName, fileHandler, withContent });

			return {};
		} else if (type === 'object') {
			// For objects, we need the OID
			const oid = this.getNodeParameter('oid') as string;
			const objectHandler: IobObjectSubscriptionHandler = (
				id: string,
				obj?: ioBroker.Object | null,
			): void => {
				console.log('Triggering on object', type, id, obj);
				this.emit([[{ json: (obj as unknown as IDataObject) || {} }]]);
			};

			const nodeId = this.getNode().id;
			await getAdapter({ nodeId, oid, objectHandler });

			return {};
		}
		// state
		const oid = this.getNodeParameter('oid') as string;

		console.log('Triggering on', type, oid);
		const stateHandler: IobStateSubscriptionHandler = (
			id: string,
			state?: ioBroker.State | null,
		): void => {
			console.log('Triggering on', type, id, state);
			this.emit([[{ json: (state as unknown as IDataObject) || {} }]]);
		};

		const nodeId = this.getNode().id;
		await getAdapter({ nodeId, oid, stateHandler });

		return {
			//manualTriggerFunction: async () => manuallyTrigger(),
		};
	}
}
