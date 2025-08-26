import { Adapter, type AdapterOptions, commonTools } from '@iobroker/adapter-core';
import { getAiFriendlyStructure, type Room } from './DevicesUtils';
import { readLastLogFile } from './LogUtils';
const pattern2RegEx = commonTools.pattern2RegEx;

export type N8NAdapterConfig = {
	bind: string;
	port: number;
	secure: boolean;
	doNotCheckPublicIP: boolean;
	auth: boolean;
	ttl: number;
};

export type EnumItem = {
	id: string;
	name: ioBroker.StringOrTranslated;
	color?: string;
	icon?: string;
	type: ioBroker.ObjectType;
	stateType?: ioBroker.CommonType;
	role?: string;
	unit?: string;
	min?: number;
	max?: number;
	step?: number;
};
export type EnumResponse = {
	id: string;
	name: ioBroker.StringOrTranslated;
	color?: string;
	icon?: string;
	items: EnumItem[];
};

export type IobStateSubscriptionHandler = (id: string, obj?: ioBroker.State | null) => void;
export type IobStateSubscription = {
	nodeId: string;
	oid: string;
	stateHandler: IobStateSubscriptionHandler;
};
export type IobObjectSubscriptionHandler = (id: string, obj?: ioBroker.Object | null) => void;
export type IobObjectSubscription = {
	nodeId: string;
	oid: string;
	objectHandler: IobObjectSubscriptionHandler;
};
export type IobFileSubscriptionHandler = (
	id: string,
	fileName: string,
	size?: number | null,
	file?: { file: string | Buffer; mimeType?: string },
) => void;
export type IobFileSubscription = {
	nodeId: string;
	oid: string;
	fileName?: string;
	withContent?: boolean;
	fileHandler?: IobFileSubscriptionHandler;
};
export type IobLogSubscriptionHandler = (message: ioBroker.LogMessage) => void;
export type IobLogSubscription = {
	nodeId: string;
	instance?: string;
	level?: ioBroker.LogLevel;
	logHandler?: IobLogSubscriptionHandler;
};

function getText(text: ioBroker.StringOrTranslated, language: ioBroker.Languages): string {
	if (typeof text === 'string') {
		return text;
	}
	return text[language] || text.en || '';
}
const logLevels = ['silly', 'debug', 'info', 'warn', 'error'];

function isLogLevelEqualOrHigher(level: ioBroker.LogLevel, compareLevel: number): boolean {
	return logLevels.indexOf(level) >= compareLevel;
}

export class N8NNodeAdapter extends Adapter {
	declare config: N8NAdapterConfig;
	private _ready = false;
	private subscribes: {
		state: { [pattern: string]: string[] };
		object: { [pattern: string]: string[] };
		file: { [pattern: string]: string[] };
	} = {
		state: {},
		object: {},
		file: {},
	};
	private ownLanguage: ioBroker.Languages = 'en';
	private cache: { devices: Room[] | null; ts: number } = {
		devices: null,
		ts: 0,
	};

	private handlers: {
		state: {
			[nodeId: string]: {
				oidRx?: RegExp;
				oid: string;
				cb: IobStateSubscriptionHandler;
			};
		};
		object: {
			[nodeId: string]: {
				oidRx?: RegExp;
				oid: string;
				cb: IobObjectSubscriptionHandler;
			};
		};
		file: {
			[nodeId: string]: {
				oid: string;
				oidRx?: RegExp;
				fileName: string;
				fileNameRx?: RegExp;
				withContent?: boolean;
				cb: IobFileSubscriptionHandler;
			};
		};
		log: {
			[nodeId: string]: {
				level?: ioBroker.LogLevel;
				compareLevel?: number;
				instance?: string;
				instanceRx?: RegExp;
				cb: IobLogSubscriptionHandler;
			};
		};
	} = {
		state: {},
		file: {},
		object: {},
		log: {},
	};

	// Cache requests before adapter is ready
	private requests: {
		getState: {
			oid: string;
			cb: (error: Error | null, state?: ioBroker.State | null) => void;
		}[];
		setState: {
			oid: string;
			state: ioBroker.SettableState;
			cb: (error: Error | null | undefined, id?: string) => void;
		}[];

		getObject: {
			oid: string;
			cb: (error: Error | null | undefined, obj?: ioBroker.Object | null) => void;
		}[];
		setObject: {
			oid: string;
			obj: Partial<ioBroker.Object>;
			cb: (
				error: Error | null | undefined,
				obj?: {
					id: string;
				},
			) => void;
		}[];

		getFile: {
			oid: string;
			fileName: string;
			base64?: boolean;
			cb: (
				error: Error | null | undefined,
				file?: { file: string | Buffer; mimeType?: string } | null,
			) => void;
		}[];
		setFile: {
			oid: string;
			fileName: string;
			base64?: boolean;
			file: Buffer | string;
			cb: (error: Error | null) => void;
		}[];

		getLogs: {
			level?: ioBroker.LogLevel;
			instance?: string;
			count?: number;
			cb: (error: Error | null | undefined, messages?: ioBroker.LogMessage[]) => void;
		}[];
		writeLog: {
			level: ioBroker.LogLevel;
			message: string;
		}[];

		readEnums: {
			type: string;
			language?: ioBroker.Languages;
			withIcons?: boolean;
			cb: (error: Error | null | undefined, result?: EnumResponse[]) => void;
		}[];

		instances: {
			cb: (error: Error | null | undefined, instances?: { value: string; name: string }[]) => void;
		}[];

		readDevices: {
			language?: ioBroker.Languages;
			withIcons?: boolean;
			cb: (error: Error | null | undefined, devices?: Room[] | null) => void;
		}[];
	} = {
		getState: [],
		setState: [],
		getObject: [],
		setObject: [],
		setFile: [],
		getFile: [],
		getLogs: [],
		writeLog: [],
		readEnums: [],
		instances: [],
		readDevices: [],
	};

	public constructor(options: Partial<AdapterOptions> = {}) {
		super({
			...options,
			instance: 0,
			name: 'n8n',
			logTransporter: true, // receive the logs
			stateChange: (id, state) => this.onStateChange(id, state),
			objectChange: (id, obj) => this.onObjectChange(id, obj),
			fileChange: (id, fileName, size) => this.onFileChange(id, fileName, size),
			ready: (): Promise<void> => this.main(),
		});

		this.on('log', this.onLog);
	}

	private async main(): Promise<void> {
		this._ready = true;
		this.log.info(`N8N Node Adapter started ${Object.keys(this.handlers.state).length}`);

		// read system configuration
		const systemObject = await this.getForeignObjectAsync('system.config');
		if (systemObject?.common?.language) {
			this.ownLanguage = systemObject.common.language;
		}

		// Subscribe on all requested states
		const states = Object.keys(this.handlers.state);
		for (let i = 0; i < states.length; i++) {
			const nodeId = states[i];
			const handler = this.handlers.state[nodeId];
			this.log.info(`Subscribing to state ${handler.oid} for node ${nodeId}`);
			this.subscribeOnState(nodeId, handler.oid);
		}

		// Subscribe on all requested objects
		const objects = Object.keys(this.handlers.object);
		for (let i = 0; i < objects.length; i++) {
			const nodeId = objects[i];
			const handler = this.handlers.object[nodeId];
			this.log.info(`Subscribing to object ${handler.oid} for node ${nodeId}`);
			this.subscribeOnObject(nodeId, handler.oid);
		}

		// Subscribe on all requested files
		const files = Object.keys(this.handlers.file);
		for (let i = 0; i < files.length; i++) {
			const nodeId = files[i];
			const handler = this.handlers.file[nodeId];
			this.log.info(`Subscribing to file ${handler.oid} for node ${nodeId}`);
			await this.subscribeOnFile(nodeId, { oid: handler.oid, fileName: handler.fileName });
		}

		if (Object.keys(this.handlers.log).length) {
			this.log.info(`Subscribing to logs for ${Object.keys(this.handlers.log).length} nodes`);
			await this.requireLog?.(true);
		}

		// Read all pending requests
		for (let s = 0; s < this.requests.getState.length; s++) {
			const request = this.requests.getState[s];
			try {
				const state = await this.getForeignStateAsync(request.oid);
				request.cb(null, state);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.getState = [];

		for (let s = 0; s < this.requests.setState.length; s++) {
			const request = this.requests.setState[s];
			try {
				const id = await this.setForeignStateAsync(request.oid, request.state);
				request.cb(null, id);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.setState = [];

		for (let s = 0; s < this.requests.getObject.length; s++) {
			const request = this.requests.getObject[s];
			try {
				const obj = await this.getForeignObjectAsync(request.oid);
				request.cb(null, obj);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.getObject = [];

		for (let s = 0; s < this.requests.setObject.length; s++) {
			const request = this.requests.setObject[s];
			try {
				const result = await this.setIobObject(request.oid, request.obj);
				request.cb(null, result);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.setObject = [];

		for (let s = 0; s < this.requests.getFile.length; s++) {
			const request = this.requests.getFile[s];
			try {
				const file = await this.readFileAsync(request.oid, request.fileName);
				if (request.base64 && file.file) {
					file.file = Buffer.from(file.file).toString('base64');
				}
				request.cb(null, file);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.getFile = [];

		for (let s = 0; s < this.requests.setFile.length; s++) {
			const request = this.requests.setFile[s];
			try {
				if (request.base64 && typeof request.file === 'string') {
					request.file = Buffer.from(request.file, 'base64');
				}
				await this.writeFileAsync(request.oid, request.fileName, request.file);
				request.cb(null);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.setFile = [];

		for (let s = 0; s < this.requests.getLogs.length; s++) {
			const request = this.requests.getLogs[s];
			try {
				// const messages = await this.getLogsAsync();
				request.cb(
					null,
					await readLastLogFile(
						this as unknown as ioBroker.Adapter,
						request.level,
						request.instance,
						request.count,
					),
				);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.getLogs = [];

		for (let s = 0; s < this.requests.writeLog.length; s++) {
			const request = this.requests.writeLog[s];
			try {
				if (
					request.level === 'info' ||
					request.level === 'debug' ||
					request.level === 'warn' ||
					request.level === 'error'
				) {
					this.log[request.level](request.message);
				}
			} catch (error) {
				this.log.error(`Failed to write log: ${error}`);
			}
		}
		this.requests.writeLog = [];

		for (let s = 0; s < this.requests.readEnums.length; s++) {
			const request = this.requests.readEnums[s];
			try {
				const enums = await this._readEnums(request.type, request.language, request.withIcons);
				request.cb(null, enums);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.readEnums = [];

		for (let s = 0; s < this.requests.readDevices.length; s++) {
			const request = this.requests.readDevices[s];
			try {
				const devices = await this._readDevices(request.language);
				request.cb(null, devices);
			} catch (error) {
				request.cb(error);
			}
		}
		this.requests.readDevices = [];

		for (let s = 0; s < this.requests.instances.length; s++) {
			const request = this.requests.instances[s];
			try {
				const instances = await this._getInstances();
				request.cb(null, instances);
			} catch (error) {
				request.cb(error);
			}
		}
	}

	private onLog = (message: ioBroker.LogMessage): void => {
		const nodeIds = Object.keys(this.handlers.log);
		for (let i = 0; i < nodeIds.length; i++) {
			const nodeId = nodeIds[i];
			if (this.handlers.log[nodeId].instanceRx) {
				if (this.handlers.log[nodeId].instanceRx.test(message.from)) {
					if (
						!this.handlers.log[nodeId].level ||
						isLogLevelEqualOrHigher(
							message.severity as ioBroker.LogLevel,
							this.handlers.log[nodeId].compareLevel!,
						)
					) {
						this.handlers.log[nodeId].cb(message);
					}
				}
			} else if (this.handlers.log[nodeId].instance) {
				if (this.handlers.log[nodeId].instance === message.from) {
					if (
						!this.handlers.log[nodeId].level ||
						isLogLevelEqualOrHigher(
							message.severity as ioBroker.LogLevel,
							this.handlers.log[nodeId].compareLevel!,
						)
					) {
						this.handlers.log[nodeId].cb(message);
					}
				}
			} else if (
				!this.handlers.log[nodeId].level ||
				isLogLevelEqualOrHigher(
					message.severity as ioBroker.LogLevel,
					this.handlers.log[nodeId].compareLevel!,
				)
			) {
				this.handlers.log[nodeId].cb(message);
			}
		}
	};

	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		const nodeIds = Object.keys(this.handlers.state);
		for (let i = 0; i < nodeIds.length; i++) {
			const nodeId = nodeIds[i];
			if (this.handlers.state[nodeId].oidRx) {
				if (this.handlers.state[nodeId].oidRx.test(id)) {
					this.handlers.state[nodeId].cb(id, state);
				}
			} else if (this.handlers.state[nodeId].oid === id) {
				this.handlers.state[nodeId].cb(id, state);
			}
		}
	}

	private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
		const nodeIds = Object.keys(this.handlers.object);
		for (let i = 0; i < nodeIds.length; i++) {
			const nodeId = nodeIds[i];
			if (this.handlers.object[nodeId].oidRx) {
				if (this.handlers.object[nodeId].oidRx.test(id)) {
					this.handlers.object[nodeId].cb(id, obj);
				}
			} else if (this.handlers.object[nodeId].oid === id) {
				this.handlers.object[nodeId].cb(id, obj);
			}
		}
	}

	private async onFileChange(
		id: string,
		fileName: string,
		_size: number | null | undefined,
	): Promise<void> {
		const nodeIds = Object.keys(this.handlers.file);
		let file: { file: string | Buffer; mimeType?: string } | undefined;
		for (let i = 0; i < nodeIds.length; i++) {
			const nodeId = nodeIds[i];
			if (this.handlers.file[nodeId].oidRx) {
				if (this.handlers.file[nodeId].oidRx.test(id)) {
					if (this.handlers.file[nodeId].fileNameRx) {
						if (this.handlers.file[nodeId].fileNameRx.test(fileName)) {
							if (
								this.handlers.file[nodeId].withContent &&
								!file &&
								_size !== null &&
								_size !== undefined
							) {
								file = await this.readFileAsync(id, fileName);
							}

							this.handlers.file[nodeId].cb(id, fileName, _size, file);
						}
					} else if (
						!this.handlers.file[nodeId].fileName ||
						this.handlers.file[nodeId].fileName === fileName
					) {
						if (
							this.handlers.file[nodeId].withContent &&
							!file &&
							_size !== null &&
							_size !== undefined
						) {
							file = await this.readFileAsync(id, fileName);
						}
						this.handlers.file[nodeId].cb(id, fileName, _size);
					}
				}
			} else if (this.handlers.file[nodeId].oid === id) {
				if (this.handlers.file[nodeId].fileNameRx) {
					if (this.handlers.file[nodeId].fileNameRx.test(fileName)) {
						if (
							this.handlers.file[nodeId].withContent &&
							!file &&
							_size !== null &&
							_size !== undefined
						) {
							file = await this.readFileAsync(id, fileName);
						}
						this.handlers.file[nodeId].cb(id, fileName, _size);
					}
				} else if (
					!this.handlers.file[nodeId].fileName ||
					this.handlers.file[nodeId].fileName === fileName
				) {
					if (
						this.handlers.file[nodeId].withContent &&
						!file &&
						_size !== null &&
						_size !== undefined
					) {
						file = await this.readFileAsync(id, fileName);
					}
					this.handlers.file[nodeId].cb(id, fileName, _size);
				}
			}
		}
	}

	private subscribeOnState(nodeId: string, oid: string, oldOid?: string): void {
		if (this._ready) {
			if (oldOid && oldOid !== oid) {
				// Remove oid from the list of subscribing
				if (this.subscribes.state[oldOid]) {
					const index = this.subscribes.state[oldOid].indexOf(nodeId);
					if (index !== -1) {
						this.subscribes.state[oldOid].splice(index, 1);
					}
					if (!this.subscribes.state[oldOid].length) {
						delete this.subscribes.state[oldOid];
						this.unsubscribeForeignStates(oldOid);
					}
				}
			}
			if (oid) {
				if (!this.subscribes.state[oid]) {
					this.subscribes.state[oid] = [];
					this.subscribeForeignStates(oid);
				}
				if (!this.subscribes.state[oid].includes(nodeId)) {
					this.subscribes.state[oid].push(nodeId);
				}
			}
		}
	}

	private subscribeOnObject(nodeId: string, oid: string, oldOid?: string): void {
		if (this._ready) {
			if (oldOid && oldOid !== oid) {
				// Remove oid from the list of subscribing
				if (this.subscribes.object[oldOid]) {
					const index = this.subscribes.object[oldOid].indexOf(nodeId);
					if (index !== -1) {
						this.subscribes.object[oldOid].splice(index, 1);
					}
					if (!this.subscribes.object[oldOid].length) {
						delete this.subscribes.object[oldOid];
						this.unsubscribeForeignObjects(oldOid);
					}
				}
			}
			if (oid) {
				if (!this.subscribes.object[oid]) {
					this.subscribes.object[oid] = [];
					this.subscribeForeignObjects(oid);
				}
				if (!this.subscribes.object[oid].includes(nodeId)) {
					this.subscribes.object[oid].push(nodeId);
				}
			}
		}
	}

	private async subscribeOnFile(
		nodeId: string,
		pattern: { oid: string; fileName?: string },
		oldPattern?: { oid: string; fileName?: string },
	): Promise<void> {
		if (this._ready) {
			const newKey = pattern.oid ? `${pattern.oid}####${pattern.fileName || '*'}` : '';
			const oldKey = oldPattern ? `${oldPattern.oid}####${oldPattern.fileName || '*'}` : '';
			if (oldKey && oldKey !== newKey) {
				// Remove oid from the list of subscribing
				if (this.subscribes.file[oldKey]) {
					const index = this.subscribes.file[oldKey].indexOf(nodeId);
					if (index !== -1) {
						this.subscribes.file[oldKey].splice(index, 1);
					}
					if (!this.subscribes.file[oldKey].length) {
						delete this.subscribes.file[oldKey];
						await this.unsubscribeForeignFiles(oldPattern!.oid, oldPattern!.fileName || '*');
					}
				}
			}
			if (newKey) {
				if (!this.subscribes.file[newKey]) {
					this.subscribes.file[newKey] = [];
					await this.subscribeForeignFiles(pattern.oid, pattern.fileName || '*');
				}
				if (!this.subscribes.file[newKey].includes(nodeId)) {
					this.subscribes.file[newKey].push(nodeId);
				}
			}
		}
	}

	public async registerHandler(
		handler:
			| IobStateSubscription
			| IobObjectSubscription
			| IobFileSubscription
			| IobLogSubscription,
	): Promise<void> {
		const wasSubscribed = !!Object.keys(this.handlers.log).length;
		const stateRequest = handler as IobStateSubscription;
		const objectRequest = handler as IobObjectSubscription;
		const fileRequest = handler as IobFileSubscription;
		const logRequest = handler as IobLogSubscription;

		if (stateRequest.stateHandler && stateRequest.oid) {
			if (!this.handlers.state[handler.nodeId]) {
				this.handlers.state[handler.nodeId] = {
					oid: stateRequest.oid,
					cb: stateRequest.stateHandler,
				};
				if (stateRequest.oid.includes('*')) {
					try {
						const p = pattern2RegEx(stateRequest.oid);
						this.handlers.state[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				}
				this.subscribeOnState(stateRequest.nodeId, stateRequest.oid);
			} else {
				if (this.handlers.state[stateRequest.nodeId].oid !== stateRequest.oid) {
					this.subscribeOnState(
						stateRequest.nodeId,
						stateRequest.oid,
						this.handlers.state[handler.nodeId].oid,
					);
					this.handlers.state[handler.nodeId].oid = stateRequest.oid;
					if (stateRequest.oid.includes('*')) {
						try {
							const p = pattern2RegEx(stateRequest.oid);
							this.handlers.state[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
						} catch (e) {
							this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
							this.handlers.state[handler.nodeId].oidRx = undefined;
						}
					} else {
						this.handlers.state[handler.nodeId].oidRx = undefined;
					}
				}
				this.handlers.state[handler.nodeId].cb = stateRequest.stateHandler;
			}

			// Delete the handler on file and object if they exist
			if (this.handlers.object[handler.nodeId]) {
				this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
				delete this.handlers.object[handler.nodeId];
			}
			if (this.handlers.file[handler.nodeId]) {
				await this.subscribeOnFile(
					handler.nodeId,
					{ oid: '', fileName: '' },
					{
						oid: this.handlers.file[handler.nodeId].oid,
						fileName: this.handlers.file[handler.nodeId].fileName,
					},
				);
				delete this.handlers.file[handler.nodeId];
			}
			if (this.handlers.log[handler.nodeId]) {
				delete this.handlers.log[handler.nodeId];
			}
		} else if (objectRequest.oid && objectRequest.objectHandler) {
			if (!this.handlers.object[handler.nodeId]) {
				this.handlers.object[handler.nodeId] = {
					oid: objectRequest.oid,
					cb: objectRequest.objectHandler,
				};
				if (objectRequest.oid.includes('*')) {
					try {
						const p = pattern2RegEx(objectRequest.oid);
						this.handlers.object[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				}
				this.subscribeOnObject(handler.nodeId, objectRequest.oid);
			} else {
				if (this.handlers.object[handler.nodeId].oid !== objectRequest.oid) {
					this.subscribeOnObject(
						objectRequest.nodeId,
						objectRequest.oid,
						this.handlers.object[objectRequest.nodeId].oid,
					);
					this.handlers.object[objectRequest.nodeId].oid = objectRequest.oid;
					if (objectRequest.oid.includes('*')) {
						try {
							const p = pattern2RegEx(objectRequest.oid);
							this.handlers.object[objectRequest.nodeId].oidRx = p ? new RegExp(p) : undefined;
						} catch (e) {
							this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
							this.handlers.object[objectRequest.nodeId].oidRx = undefined;
						}
					} else {
						this.handlers.object[objectRequest.nodeId].oidRx = undefined;
					}
				}
				this.handlers.object[objectRequest.nodeId].cb = objectRequest.objectHandler;
			}
			// Delete the handler on file and state if they exist
			if (this.handlers.state[objectRequest.nodeId]) {
				this.subscribeOnState(
					objectRequest.nodeId,
					'',
					this.handlers.state[objectRequest.nodeId].oid,
				);
				delete this.handlers.state[objectRequest.nodeId];
			}
			if (this.handlers.file[objectRequest.nodeId]) {
				await this.subscribeOnFile(
					handler.nodeId,
					{ oid: '', fileName: '' },
					{
						oid: this.handlers.file[objectRequest.nodeId].oid,
						fileName: this.handlers.file[objectRequest.nodeId].fileName,
					},
				);
				delete this.handlers.file[objectRequest.nodeId];
			}
			if (this.handlers.log[objectRequest.nodeId]) {
				delete this.handlers.log[objectRequest.nodeId];
			}
		} else if (fileRequest.fileHandler && fileRequest.oid) {
			if (!this.handlers.file[handler.nodeId]) {
				this.handlers.file[handler.nodeId] = {
					oid: fileRequest.oid,
					fileName: fileRequest.fileName || '*',
					cb: fileRequest.fileHandler,
					withContent: fileRequest.withContent,
				};
				if (fileRequest.oid.includes('*')) {
					try {
						const p = pattern2RegEx(fileRequest.oid);
						this.handlers.file[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				}
				if (fileRequest.fileName?.includes('*')) {
					try {
						const p = pattern2RegEx(fileRequest.fileName);
						this.handlers.file[handler.nodeId].fileNameRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				}
				await this.subscribeOnFile(handler.nodeId, {
					oid: fileRequest.oid,
					fileName: fileRequest.fileName,
				});
			} else {
				if (
					this.handlers.file[handler.nodeId].oid !== fileRequest.oid ||
					this.handlers.file[handler.nodeId].fileName !== fileRequest.fileName
				) {
					await this.subscribeOnFile(
						handler.nodeId,
						{
							oid: fileRequest.oid,
							fileName: fileRequest.fileName,
						},
						{
							oid: this.handlers.file[handler.nodeId].oid,
							fileName: this.handlers.file[handler.nodeId].fileName,
						},
					);
					this.handlers.file[handler.nodeId].oid = fileRequest.oid;
					if (fileRequest.oid.includes('*')) {
						try {
							const p = pattern2RegEx(fileRequest.oid);
							this.handlers.file[handler.nodeId].oidRx = p ? new RegExp(p) : undefined;
						} catch (e) {
							this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
							this.handlers.file[handler.nodeId].oidRx = undefined;
						}
					} else {
						this.handlers.file[handler.nodeId].oidRx = undefined;
					}
					if (fileRequest.fileName?.includes('*')) {
						try {
							const p = pattern2RegEx(fileRequest.fileName);
							this.handlers.file[handler.nodeId].fileNameRx = p ? new RegExp(p) : undefined;
						} catch (e) {
							this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
							this.handlers.file[handler.nodeId].fileNameRx = undefined;
						}
					} else {
						this.handlers.file[handler.nodeId].fileNameRx = undefined;
					}
				}
				this.handlers.file[handler.nodeId].cb = fileRequest.fileHandler;
				this.handlers.file[handler.nodeId].withContent = fileRequest.withContent;
			}
			// Delete the handler on state and object if they exist
			if (this.handlers.state[handler.nodeId]) {
				this.subscribeOnState(handler.nodeId, '', this.handlers.state[handler.nodeId].oid);
				delete this.handlers.state[handler.nodeId];
			}
			if (this.handlers.object[handler.nodeId]) {
				this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
				delete this.handlers.object[handler.nodeId];
			}
			if (this.handlers.log[handler.nodeId]) {
				delete this.handlers.log[handler.nodeId];
			}
		} else if (logRequest.logHandler) {
			if (!this.handlers.log[handler.nodeId]) {
				this.handlers.log[handler.nodeId] = {
					cb: logRequest.logHandler,
					instance: logRequest.instance,
					level: logRequest.level,
					compareLevel: logRequest.level ? logLevels.indexOf(logRequest.level) : undefined,
				};
				if (logRequest.instance?.includes('*')) {
					try {
						const p = pattern2RegEx(logRequest.instance);
						this.handlers.log[handler.nodeId].instanceRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				}
			} else {
				this.handlers.log[handler.nodeId].cb = logRequest.logHandler;
				this.handlers.log[handler.nodeId].instance = logRequest.instance;
				this.handlers.log[handler.nodeId].level = logRequest.level;
				if (logRequest.level) {
					this.handlers.log[handler.nodeId].compareLevel = logLevels.indexOf(logRequest.level);
				} else {
					this.handlers.log[handler.nodeId].compareLevel = undefined;
				}
				if (logRequest.instance?.includes('*')) {
					try {
						const p = pattern2RegEx(logRequest.instance);
						this.handlers.log[handler.nodeId].instanceRx = p ? new RegExp(p) : undefined;
					} catch (e) {
						this.log?.warn(`Invalid pattern on subscribe: ${e.message}`);
					}
				} else {
					this.handlers.log[handler.nodeId].instanceRx = undefined;
				}
			}
			// Delete the handler on state, object and file if they exist
			if (this.handlers.state[handler.nodeId]) {
				this.subscribeOnState(handler.nodeId, '', this.handlers.state[handler.nodeId].oid);
				delete this.handlers.state[handler.nodeId];
			}
			if (this.handlers.object[handler.nodeId]) {
				this.subscribeOnObject(handler.nodeId, '', this.handlers.object[handler.nodeId].oid);
				delete this.handlers.object[handler.nodeId];
			}
			if (this.handlers.file[handler.nodeId]) {
				await this.subscribeOnFile(
					handler.nodeId,
					{ oid: '', fileName: '' },
					{
						oid: this.handlers.file[handler.nodeId].oid,
						fileName: this.handlers.file[handler.nodeId].fileName,
					},
				);
				delete this.handlers.file[handler.nodeId];
			}
		}

		if (this._ready) {
			if (wasSubscribed && !Object.keys(this.handlers.log).length) {
				this.log.info(`Unsubscribing from logs as no handlers are registered`);
				void this.requireLog?.(false);
			} else if (!wasSubscribed && Object.keys(this.handlers.log).length) {
				this.log.info(`Subscribing to logs as handlers are registered`);
				await this.requireLog?.(true);
			}
		}
	}

	public async setIobObject(oid: string, obj: Partial<ioBroker.Object>): Promise<{ id: string }> {
		if (this._ready) {
			try {
				// read the object first
				let existingObj = await this.getForeignObjectAsync(oid);
				if (existingObj) {
					// merge it
					if (obj.common) {
						existingObj.common = existingObj.common || {};
						existingObj.common = { ...existingObj.common, ...obj.common } as ioBroker.ObjectCommon;
					}
					if (obj.native) {
						existingObj.native = existingObj.native || {};
						existingObj.native = { ...existingObj.native, ...obj.native };
					}
				} else {
					// make sure the _id is set
					existingObj = obj as ioBroker.Object;
				}
				// and set it
				return this.setForeignObjectAsync(oid, existingObj);
			} catch {
				return this.setForeignObjectAsync(oid, obj as ioBroker.Object);
			}
		}

		return new Promise<{ id: string }>((resolve, reject): void => {
			this.requests.setObject.push({
				oid,
				obj,
				cb: (error: Error | null | undefined, result?: { id: string }): void => {
					if (error) {
						reject(new Error(`Failed to set object ${oid}`));
					} else {
						resolve(result!);
					}
				},
			});
		});
	}

	public async getIobObject(oid: string): Promise<ioBroker.Object | null | undefined> {
		if (this._ready) {
			return this.getForeignObjectAsync(oid);
		}

		return new Promise<ioBroker.Object | null | undefined>((resolve, reject): void => {
			this.requests.getObject.push({
				oid,
				cb: (error: Error | null | undefined, result?: ioBroker.Object | null): void => {
					if (error) {
						reject(new Error(`Failed to set object ${oid}`));
					} else {
						resolve(result);
					}
				},
			});
		});
	}

	public async setIobState(oid: string, state: ioBroker.SettableState): Promise<string> {
		if (this._ready) {
			return this.setForeignStateAsync(oid, state);
		}

		return new Promise<string>((resolve, reject): void => {
			this.requests.setState.push({
				oid,
				state,
				cb: (error: Error | null | undefined, result?: string): void => {
					if (error) {
						reject(new Error(`Failed to set object ${oid}`));
					} else {
						resolve(result!);
					}
				},
			});
		});
	}

	public async getIobState(oid: string): Promise<ioBroker.State | null | undefined> {
		if (this._ready) {
			return this.getForeignStateAsync(oid);
		}

		return new Promise<ioBroker.State | null | undefined>((resolve, reject): void => {
			this.requests.getState.push({
				oid,
				cb: (error: Error | null, result?: ioBroker.State | null): void => {
					if (error) {
						reject(new Error(`Failed to set object ${oid}`));
					} else {
						resolve(result);
					}
				},
			});
		});
	}

	public async setIobFile(
		oid: string,
		fileName: string,
		file: Buffer | string,
		base64?: boolean,
	): Promise<void> {
		if (this._ready) {
			if (base64 && typeof file === 'string') {
				file = Buffer.from(file, 'base64');
			}
			return this.writeFileAsync(oid, fileName, file);
		}

		return new Promise<void>((resolve, reject): void => {
			this.requests.setFile.push({
				oid,
				fileName,
				file,
				base64,
				cb: (error: Error | null | undefined): void => {
					if (error) {
						reject(new Error(`Failed to set object ${oid}`));
					} else {
						resolve();
					}
				},
			});
		});
	}

	public async getIobFile(
		oid: string,
		fileName: string,
		base64?: boolean,
	): Promise<{ file: string | Buffer; mimeType?: string } | null> {
		if (this._ready) {
			const data = await this.readFileAsync(oid, fileName);
			if (base64 && data.file) {
				data.file = Buffer.from(data.file).toString('base64');
			}
			return data || null;
		}

		return new Promise<{ file: string | Buffer; mimeType?: string } | null>(
			(resolve, reject): void => {
				this.requests.getFile.push({
					oid,
					fileName,
					base64,
					cb: (
						error: Error | null | undefined,
						result?: { file: string | Buffer; mimeType?: string } | null,
					): void => {
						if (error) {
							reject(new Error(`Failed to write file ${oid}`));
						} else {
							resolve(result || null);
						}
					},
				});
			},
		);
	}

	public writeIobLog(message: string, level?: ioBroker.LogLevel): void {
		if (this._ready) {
			this.log[level || 'info'](message);
		} else {
			this.requests.writeLog.push({ message, level: level || 'info' });
		}
	}

	public async readIobLog(
		level?: ioBroker.LogLevel,
		instance?: string,
		count?: number,
	): Promise<ioBroker.LogMessage[]> {
		if (this._ready) {
			return await readLastLogFile(this as unknown as ioBroker.Adapter, level, instance, count);
		}
		return new Promise<ioBroker.LogMessage[]>((resolve, reject): void => {
			this.requests.getLogs.push({
				level: level,
				instance,
				count,
				cb: (error: Error | null | undefined, result?: ioBroker.LogMessage[]): void => {
					if (error) {
						reject(new Error(`Failed to read logs: ${error}`));
					} else {
						resolve(result || []);
					}
				},
			});
		});
	}

	public readIobEnums(
		type: string,
		language?: ioBroker.Languages,
		withIcons?: boolean,
	): Promise<EnumResponse[]> {
		if (this._ready) {
			this.log.info(`Reading enums of type ${type}`);
			return this._readEnums(type, language, withIcons);
		}

		return new Promise<EnumResponse[]>((resolve, reject): void => {
			this.requests.readEnums.push({
				type,
				language,
				withIcons,
				cb: (error: Error | null | undefined, result?: EnumResponse[]): void => {
					if (error) {
						reject(new Error(`Failed to read enums of type ${type}`));
					} else {
						resolve(result || []);
					}
				},
			});
		});
	}

	private async _readEnums(
		type: string,
		language?: ioBroker.Languages,
		withIcons?: boolean,
	): Promise<EnumResponse[]> {
		const enums = await this.getObjectViewAsync('system', 'enum', {
			startkey: `enum.${type}.`,
			endkey: `enum.${type}.\u9999`,
		});

		const result: EnumResponse[] = [];

		const objects: { [id: string]: ioBroker.Object | null | undefined | false } = {};
		// Read for every enum the belonging objects
		for (let e = 0; e < enums.rows.length; e++) {
			const enumObj = enums.rows[e].value;
			const oneEnum: EnumResponse = {
				id: enumObj._id,
				name:
					(language && enumObj.common
						? getText(enumObj.common.name, language)
						: enumObj.common?.name) ||
					enumObj._id.split('.').pop() ||
					'',
				color: enumObj.common.color,
				icon: withIcons ? enumObj.common.icon : undefined,
				items: [],
			};

			result.push(oneEnum);

			if (enumObj?.common?.members) {
				for (const member of enumObj.common.members) {
					let obj = objects[member];
					if (obj === undefined) {
						try {
							objects[member] = await this.getForeignObjectAsync(member);
						} catch {
							objects[member] = false; // Mark as failed
						}
						obj = objects[member];
					}
					if (obj) {
						oneEnum.items.push({
							id: member,
							type: obj.type,
							name:
								(language && obj.common ? getText(obj.common.name, language) : obj.common.name) ||
								member.split('.').pop() ||
								'',
							color: obj.common?.color,
							icon: withIcons ? obj.common?.icon : undefined,
							stateType: obj.common?.type,
							min: obj.common?.min,
							max: obj.common?.max,
							unit: obj.common?.unit,
							role: obj.common?.role,
							step: obj.common?.step,
						});
					}
				}
			}
		}
		return result;
	}

	public readIobDevices(language?: ioBroker.Languages): Promise<Room[]> {
		if (this._ready) {
			this.log.info(`Reading devices`);
			return this._readDevices(language);
		}

		return new Promise<Room[]>((resolve, reject): void => {
			this.requests.readDevices.push({
				language,
				cb: (error: Error | null | undefined, devices?: Room[] | null): void => {
					if (error) {
						reject(new Error('Failed to read devices'));
					} else {
						resolve(devices || []);
					}
				},
			});
		});
	}

	private async _readDevices(language?: ioBroker.Languages): Promise<Room[]> {
		if (this.cache?.ts + 30000 > Date.now() && this.cache.devices) {
			return this.cache.devices;
		}
		this.cache = {
			ts: Date.now(),
			devices: await getAiFriendlyStructure(
				this as unknown as ioBroker.Adapter,
				language || this.ownLanguage,
			),
		};

		return this.cache.devices || [];
	}

	private async _getInstances(): Promise<{ value: string; name: string }[]> {
		const result = await this.getObjectViewAsync('system', 'instance', {
			startkey: 'system.adapter.',
			endkey: 'system.adapter.\u9999',
		});
		const instances = result.rows.map((row) => {
			const namespace = row.id.replace('system.adapter.', '');
			let name =
				getText(row.value.common.titleLang || row.value.common.title || '', 'en') || namespace;
			const [adapterName, instance] = namespace.split('.');
			if (name === adapterName) {
				name = namespace;
			} else if (!name.includes(instance)) {
				name = `${name} [${namespace}]`;
			}
			return {
				value: row.id.replace('system.adapter.', ''),
				name,
			};
		});
		instances.unshift({
			value: '',
			name: 'Any instance',
		});
		return instances;
	}

	public async getInstances(): Promise<{ value: string; name: string }[]> {
		if (this._ready) {
			return this._getInstances();
		}

		return new Promise<{ value: string; name: string }[]>((resolve, reject): void => {
			this.requests.instances.push({
				cb: (error: Error | null | undefined, result?: { value: string; name: string }[]): void => {
					if (error) {
						reject(new Error(`Failed to read instances`));
					} else {
						resolve(result || []);
					}
				},
			});
		});
	}
}

let adapter: N8NNodeAdapter | undefined;

export async function getAdapter(
	handler?: IobStateSubscription | IobObjectSubscription | IobFileSubscription | IobLogSubscription,
): Promise<N8NNodeAdapter> {
	adapter ||= new N8NNodeAdapter();

	if (handler) {
		await adapter.registerHandler(handler);
	}

	return adapter;
}
