import ChannelDetector, { type DetectOptions, Types } from '@iobroker/type-detector';
import type { InternalDetectorState } from '@iobroker/type-detector/types';

export type SmartNameObject = { [lang in ioBroker.Languages]?: string } & {
	smartType?: string | null;
	byON?: string | null;
	toggle?: boolean;
};
export type SmartName = null | false | string | SmartNameObject;

export interface IotInternalDetectorState extends InternalDetectorState {
	id: string;
	smartName: SmartName | undefined;
	common: {
		min?: number;
		max?: number;
		type?: ioBroker.CommonType;
		states?: { [value: string]: string };
		role?: string;
		name?: ioBroker.StringOrTranslated;
		icon?: string;
		color?: string;
	};
}

export interface IotExternalDetectorState extends Omit<IotInternalDetectorState, 'enums' | 'role'> {
	enums?: boolean;
	role?: string;
}

export interface IotExternalPatternControl {
	states: IotExternalDetectorState[];
	type: Types;
	enumRequired?: boolean;
	object?: {
		id: string;
		type: ioBroker.ObjectType;
		common: ioBroker.StateCommon | ioBroker.ChannelCommon | ioBroker.DeviceCommon;
		autoDetected: boolean;
		toggle?: boolean;
		smartName?: SmartName;
	};
	groupNames: string[];
	room?: {
		id: string;
		common: ioBroker.EnumCommon;
	};
	functionality?: {
		id: string;
		common: ioBroker.EnumCommon;
	};
}

/**
 * Checks whether the provided value is a valid smart name.
 *
 * @param smartName The value to check
 * @param lang Configured language
 * @returns True if a valid smart name, false - otherwise.
 */
export function isValidSmartName(
	smartName: SmartName | undefined,
	lang: ioBroker.Languages,
): boolean {
	let name = smartName;
	if (smartName === false || smartName === 'ignore') {
		return false;
	}
	if (smartName && typeof smartName === 'object') {
		name = smartName[lang] || smartName.en || smartName.de;
	}
	return ![null, undefined, 'ignore', false].includes(name as string);
}

function isRoom(enumObject: ioBroker.EnumObject): boolean {
	return enumObject?._id?.startsWith('enum.rooms.');
}

function isFunctionality(enumObject: ioBroker.EnumObject): boolean {
	return enumObject?._id?.startsWith('enum.functions.');
}

async function allEnums(adapter: ioBroker.Adapter): Promise<ioBroker.EnumObject[]> {
	const result = await adapter.getObjectViewAsync('system', 'enum', {});
	return result.rows.map((row) => row.value);
}

function parentOf(id: string): string {
	const parts = (id || '').split('.');
	parts.pop();
	return parts.join('.');
}

async function allObjects(adapter: ioBroker.Adapter): Promise<Record<string, ioBroker.Object>> {
	const states = await adapter.getObjectViewAsync('system', 'state', {});
	const channels = await adapter.getObjectViewAsync('system', 'channel', {});
	const devices = await adapter.getObjectViewAsync('system', 'device', {});
	const enums = await adapter.getObjectViewAsync('system', 'enum', {});

	return (states.rows as { id: string; value: ioBroker.Object }[])
		.concat(channels.rows)
		.concat(devices.rows)
		.concat(enums.rows)
		.reduce(
			(obj, item) => (
				(obj[item.id] = {
					common: item.value?.common,
					type: item.value?.type,
				} as ioBroker.Object),
				obj
			),
			{} as Record<string, ioBroker.Object>,
		);
}

function getSmartNameFromObj(
	obj: ioBroker.Object | ioBroker.StateCommon,
	instanceId: string,
	noCommon?: boolean,
): undefined | false | SmartNameObject {
	if (!obj) {
		return undefined;
	}
	let result: undefined | false | SmartNameObject;
	// If it is a common object
	if (!(obj as ioBroker.StateObject).common) {
		result = (obj as ioBroker.StateCommon).smartName as undefined | false | SmartNameObject;
	} else if (!noCommon) {
		result = (obj as ioBroker.StateObject).common.smartName as undefined | false | SmartNameObject;
	} else {
		const custom = (obj as ioBroker.StateObject).common.custom;
		if (!custom) {
			return undefined;
		}
		result = custom[instanceId] ? custom[instanceId].smartName : undefined;
	}
	if (result && typeof result === 'string') {
		if (result === 'ignore') {
			return false;
		}
		return {
			en: result,
		};
	}
	return result;
}

async function functionalitiesAndRooms(
	adapter: ioBroker.Adapter,
): Promise<[ioBroker.EnumObject[], ioBroker.EnumObject[]]> {
	const enumerations = await allEnums(adapter);
	// skip empty enums (with no members, i.e. states, assigned)
	const notEmptyRoomsAndFunctionalities = enumerations
		.filter((item) => {
			const smartName = getSmartNameFromObj(item, adapter.namespace);
			return smartName !== false;
		})
		.filter((item) => item?.common?.members?.length);
	// all enums that are of type 'function'
	const functionalities = notEmptyRoomsAndFunctionalities.filter((item) => isFunctionality(item));
	// all enums, that are of type 'room'
	const rooms = notEmptyRoomsAndFunctionalities.filter((item) => isRoom(item));
	return [functionalities, rooms];
}

function getChannelId(id: string, objects: Record<string, ioBroker.Object>): string | null {
	if (objects[id] && objects[id].type === 'channel') {
		return id;
	}

	if (objects[id] && objects[id].type === 'state') {
		const channelId = parentOf(id);
		if (objects[channelId] && objects[channelId].type === 'channel') {
			return channelId;
		}
	}
	return null;
}

function getDeviceId(id: string, objects: Record<string, ioBroker.Object>): string | null {
	const channelId = getChannelId(id, objects);
	if (channelId) {
		const deviceId = parentOf(channelId);
		if (
			objects[deviceId] &&
			(objects[deviceId].type === 'device' || objects[deviceId].type === 'channel')
		) {
			return deviceId;
		}
	}
	return null;
}
/**
 * Inspects all objects (states, channels and devices) and tries to identify so-called 'controls'
 *
 * To identify the controls, the ioBroker type detector library is used (https://github.com/ioBroker/ioBroker.type-detector).
 *
 * @param adapter The iot adapter instance
 * @param lang language
 * @returns An array containing the detected controls
 */
export async function controls(
	adapter: ioBroker.Adapter,
	lang: ioBroker.Languages,
): Promise<IotExternalPatternControl[]> {
	// here we collect ids to inspect
	const list: string[] = [];

	// fetch all objects (states, channels and devices in terms of iobroker)
	const devicesObject = await allObjects(adapter);
	// fetch all defined rooms and functions (enumerations)
	const [functionalities, rooms] = await functionalitiesAndRooms(adapter);

	// every member of a function enumeration is added to the list of ids to inspect
	functionalities.forEach((functionEnumItem) => {
		functionEnumItem.common.members?.forEach((id) => {
			const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);

			const objType = devicesObject[id].type;
			if (
				devicesObject[id]?.common &&
				(objType === 'state' || objType === 'channel' || objType === 'device') &&
				!list.includes(id) &&
				smartName !== false // if the device is not disabled
			) {
				list.push(id);
			}
		});
	});

	// a member of a room enumeration is only added if neither its parent (channel) nor its grandparent (device) is in
	rooms.forEach((roomEnumItem) => {
		roomEnumItem.common.members?.forEach((id) => {
			if (!devicesObject[id]) {
				return;
			}
			const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
			const objType = devicesObject[id].type;
			if (
				devicesObject[id]?.common &&
				(objType === 'state' || objType === 'channel' || objType === 'device') &&
				!list.includes(id) &&
				smartName !== false // if the device is not disabled
			) {
				const channelId = getChannelId(id, devicesObject);
				if (channelId) {
					if (!list.includes(channelId)) {
						const deviceId = getDeviceId(id, devicesObject);
						if (deviceId) {
							if (!list.includes(deviceId)) {
								list.push(id);
							}
						} else {
							list.push(id);
						}
					}
				} else {
					list.push(id);
				}
			}
		});
	});

	// all ids, i.e. ids of all iobroker states/channels/devices
	const keys = Object.keys(devicesObject).sort();

	const idsWithSmartName: string[] = [];
	// if a state has got a smart name directly assigned and neither itself nor its channel is in the list, add its id to the inspection list
	// and process it first
	keys.forEach((id) => {
		const smartName =
			devicesObject[id] && getSmartNameFromObj(devicesObject[id], adapter.namespace);

		const objType = devicesObject[id].type;

		if (
			isValidSmartName(smartName, lang) &&
			devicesObject[id].common &&
			(objType === 'state' || objType === 'channel' || objType === 'device')
		) {
			idsWithSmartName.push(id);
		}
	});

	// collect first all smart names and remove them from the auto-groups
	const detectedControls: IotExternalPatternControl[] = [];
	const detector = new ChannelDetector();

	const patterns = ChannelDetector.getPatterns();
	// process states with defined smartName
	for (let s = 0; s < idsWithSmartName.length; s++) {
		const id = idsWithSmartName[s];
		const common = devicesObject[id].common;
		const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace) as SmartNameObject;

		// try to convert the state to typeDetector format
		// "smartName": {
		//    "de": "Rote Lampe",
		//    "smartType": "LIGHT", // optional
		//    "byON": 80            // optional
		//  }
		if (!smartName.smartType) {
			// by default,
			// all booleans are sockets
			// all numbers are dimmer
			// string is not possible to control
			if (common.type === 'boolean' || common.type === 'mixed') {
				// we will write boolean
				smartName.smartType = 'socket';
			} else if (common.type === 'number') {
				smartName.smartType = 'dimmer';
			} else {
				smartName.smartType = 'socket';
			}
		}
		// try to simulate typeDetector format
		if (patterns[smartName.smartType]) {
			const control: IotExternalPatternControl = JSON.parse(
				JSON.stringify(patterns[smartName.smartType]),
			);
			// find first required
			const state = control.states.find((state) => state.required);
			if (state) {
				state.id = id;
				// process control
				// remove all unassigned control register
				control.states = control.states.filter((s) => s.id);

				// take all smartNames if any
				control.states.forEach((s) => {
					s.smartName = getSmartNameFromObj(devicesObject[s.id], adapter.namespace);
					s.common = {
						min: devicesObject[s.id]?.common?.min,
						max: devicesObject[s.id]?.common?.max,
						type: devicesObject[s.id]?.common?.type,
						states: devicesObject[s.id]?.common?.states,
						role: devicesObject[s.id]?.common?.role,
						name: devicesObject[s.id]?.common?.name,
						icon: devicesObject[s.id]?.common?.icon,
						color: devicesObject[s.id]?.common?.color,
					};
				});

				devicesObject[id].common.smartName = smartName;

				control.object = {
					id,
					type: devicesObject[id].type,
					common: devicesObject[id].common,
					autoDetected: false,
					toggle: smartName?.toggle,
				};

				// remove id from the groups
				let pos = list.indexOf(id);
				if (pos !== -1) {
					list.splice(pos, 1);
				}
				const channelId = getChannelId(id, devicesObject);
				if (channelId) {
					pos = list.indexOf(channelId);
					if (pos !== -1) {
						list.splice(pos, 1);
					}
				}

				const name = smartName[lang] || smartName.en || smartName.de;
				control.groupNames = name?.split(',').map((n) => n.trim()) || [];

				adapter.log.debug(`[ALEXA3] added ${id} with smartName as "${smartName.smartType}"`);
				detectedControls.push(control);
			} else {
				// ignored
				adapter.log.debug(
					`[ALEXA3] Ignored state ${id} with smartName ${JSON.stringify(smartName)} and type ${common.type}`,
				);
			}
		} else {
			// ignored
			adapter.log.debug(
				`[ALEXA3] Ignored state ${id} with smartName ${JSON.stringify(smartName)} and type ${common.type}`,
			);
		}
	}

	// initialize iobroker type detector
	const usedIds: string[] = [];
	const ignoreIndicators = ['UNREACH_STICKY']; // Ignore indicators by name
	const excludedTypes = [Types.info];
	const options: DetectOptions = {
		objects: devicesObject,
		_keysOptional: keys,
		_usedIdsOptional: usedIds,
		ignoreIndicators,
		excludedTypes,
		id: '', // this will be set for each id in the list
	};

	// go other the list of IDs to inspect and collect the detected controls
	list.forEach((id) => {
		options.id = id;
		const controls = detector.detect(options);
		controls?.forEach((control) => {
			const iotControl: IotExternalPatternControl = control as IotExternalPatternControl;

			// if any detected state has an ID, we can use this control
			if (iotControl.states.find((state) => state.id)) {
				// console.log(`In ${id} was detected "${control.type}" with the following states:`);

				// remove all unassigned control register
				iotControl.states = iotControl.states.filter((s) => s.id);

				// take all smartNames if any
				iotControl.states.forEach((s) => {
					s.smartName = getSmartNameFromObj(devicesObject[s.id], adapter.namespace);
					s.common = {
						min: devicesObject[s.id]?.common?.min,
						max: devicesObject[s.id]?.common?.max,
						type: devicesObject[s.id]?.common?.type,
						states: devicesObject[s.id]?.common?.states,
						role: devicesObject[s.id]?.common?.role,
						name: devicesObject[s.id]?.common?.name,
						icon: devicesObject[s.id]?.common?.icon,
						color: devicesObject[s.id]?.common?.color,
					};
				});

				// find out the room the found control is in
				const room = rooms.find((room) => room?.common?.members?.includes(id));

				// find out the functionality the found control assigned to
				const functionality = functionalities.find((functionality) =>
					functionality?.common?.members?.includes(id),
				);

				const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
				iotControl.object = {
					id,
					type: devicesObject[id].type,
					common: {
						min: devicesObject[id].common?.min,
						max: devicesObject[id].common?.max,
						type: devicesObject[id].common?.type,
						states: devicesObject[id].common?.states,
						role: devicesObject[id].common?.role,
						name: devicesObject[id].common?.name,
						icon: devicesObject[id].common?.icon,
						color: devicesObject[id].common?.color,
						smartName,
					},
					autoDetected: true,
					toggle: smartName && typeof smartName === 'object' ? smartName.toggle : undefined,
				};

				iotControl.room = room
					? {
							id: room._id,
							common: room.common,
						}
					: undefined;

				iotControl.functionality = functionality
					? {
							id: functionality._id,
							common: functionality.common,
						}
					: undefined;

				detectedControls.push(iotControl);
			}
		});
	});

	return detectedControls;
}
