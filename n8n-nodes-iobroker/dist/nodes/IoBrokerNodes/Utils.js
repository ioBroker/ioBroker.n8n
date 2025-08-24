"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidSmartName = isValidSmartName;
exports.controls = controls;
const type_detector_1 = __importStar(require("@iobroker/type-detector"));
function isValidSmartName(smartName, lang) {
    let name = smartName;
    if (smartName === false || smartName === 'ignore') {
        return false;
    }
    if (smartName && typeof smartName === 'object') {
        name = smartName[lang] || smartName.en || smartName.de;
    }
    return ![null, undefined, 'ignore', false].includes(name);
}
function isRoom(enumObject) {
    var _a;
    return (_a = enumObject === null || enumObject === void 0 ? void 0 : enumObject._id) === null || _a === void 0 ? void 0 : _a.startsWith('enum.rooms.');
}
function isFunctionality(enumObject) {
    var _a;
    return (_a = enumObject === null || enumObject === void 0 ? void 0 : enumObject._id) === null || _a === void 0 ? void 0 : _a.startsWith('enum.functions.');
}
async function allEnums(adapter) {
    const result = await adapter.getObjectViewAsync('system', 'enum', {});
    return result.rows.map((row) => row.value);
}
function parentOf(id) {
    const parts = (id || '').split('.');
    parts.pop();
    return parts.join('.');
}
async function allObjects(adapter) {
    const states = await adapter.getObjectViewAsync('system', 'state', {});
    const channels = await adapter.getObjectViewAsync('system', 'channel', {});
    const devices = await adapter.getObjectViewAsync('system', 'device', {});
    const enums = await adapter.getObjectViewAsync('system', 'enum', {});
    return states.rows
        .concat(channels.rows)
        .concat(devices.rows)
        .concat(enums.rows)
        .reduce((obj, item) => {
        var _a, _b;
        return ((obj[item.id] = {
            common: (_a = item.value) === null || _a === void 0 ? void 0 : _a.common,
            type: (_b = item.value) === null || _b === void 0 ? void 0 : _b.type,
        }),
            obj);
    }, {});
}
function getSmartNameFromObj(obj, instanceId, noCommon) {
    if (!obj) {
        return undefined;
    }
    let result;
    if (!obj.common) {
        result = obj.smartName;
    }
    else if (!noCommon) {
        result = obj.common.smartName;
    }
    else {
        const custom = obj.common.custom;
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
async function functionalitiesAndRooms(adapter) {
    const enumerations = await allEnums(adapter);
    const notEmptyRoomsAndFunctionalities = enumerations
        .filter((item) => {
        const smartName = getSmartNameFromObj(item, adapter.namespace);
        return smartName !== false;
    })
        .filter((item) => { var _a, _b; return (_b = (_a = item === null || item === void 0 ? void 0 : item.common) === null || _a === void 0 ? void 0 : _a.members) === null || _b === void 0 ? void 0 : _b.length; });
    const functionalities = notEmptyRoomsAndFunctionalities.filter((item) => isFunctionality(item));
    const rooms = notEmptyRoomsAndFunctionalities.filter((item) => isRoom(item));
    return [functionalities, rooms];
}
function getChannelId(id, objects) {
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
function getDeviceId(id, objects) {
    const channelId = getChannelId(id, objects);
    if (channelId) {
        const deviceId = parentOf(channelId);
        if (objects[deviceId] &&
            (objects[deviceId].type === 'device' || objects[deviceId].type === 'channel')) {
            return deviceId;
        }
    }
    return null;
}
async function controls(adapter, lang) {
    const list = [];
    const devicesObject = await allObjects(adapter);
    const [functionalities, rooms] = await functionalitiesAndRooms(adapter);
    functionalities.forEach((functionEnumItem) => {
        var _a;
        (_a = functionEnumItem.common.members) === null || _a === void 0 ? void 0 : _a.forEach((id) => {
            var _a;
            const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
            const objType = devicesObject[id].type;
            if (((_a = devicesObject[id]) === null || _a === void 0 ? void 0 : _a.common) &&
                (objType === 'state' || objType === 'channel' || objType === 'device') &&
                !list.includes(id) &&
                smartName !== false) {
                list.push(id);
            }
        });
    });
    rooms.forEach((roomEnumItem) => {
        var _a;
        (_a = roomEnumItem.common.members) === null || _a === void 0 ? void 0 : _a.forEach((id) => {
            var _a;
            if (!devicesObject[id]) {
                return;
            }
            const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
            const objType = devicesObject[id].type;
            if (((_a = devicesObject[id]) === null || _a === void 0 ? void 0 : _a.common) &&
                (objType === 'state' || objType === 'channel' || objType === 'device') &&
                !list.includes(id) &&
                smartName !== false) {
                const channelId = getChannelId(id, devicesObject);
                if (channelId) {
                    if (!list.includes(channelId)) {
                        const deviceId = getDeviceId(id, devicesObject);
                        if (deviceId) {
                            if (!list.includes(deviceId)) {
                                list.push(id);
                            }
                        }
                        else {
                            list.push(id);
                        }
                    }
                }
                else {
                    list.push(id);
                }
            }
        });
    });
    const keys = Object.keys(devicesObject).sort();
    const idsWithSmartName = [];
    keys.forEach((id) => {
        const smartName = devicesObject[id] && getSmartNameFromObj(devicesObject[id], adapter.namespace);
        const objType = devicesObject[id].type;
        if (isValidSmartName(smartName, lang) &&
            devicesObject[id].common &&
            (objType === 'state' || objType === 'channel' || objType === 'device')) {
            idsWithSmartName.push(id);
        }
    });
    const detectedControls = [];
    const detector = new type_detector_1.default();
    const patterns = type_detector_1.default.getPatterns();
    for (let s = 0; s < idsWithSmartName.length; s++) {
        const id = idsWithSmartName[s];
        const common = devicesObject[id].common;
        const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
        if (!smartName.smartType) {
            if (common.type === 'boolean' || common.type === 'mixed') {
                smartName.smartType = 'socket';
            }
            else if (common.type === 'number') {
                smartName.smartType = 'dimmer';
            }
            else {
                smartName.smartType = 'socket';
            }
        }
        if (patterns[smartName.smartType]) {
            const control = JSON.parse(JSON.stringify(patterns[smartName.smartType]));
            const state = control.states.find((state) => state.required);
            if (state) {
                state.id = id;
                control.states = control.states.filter((s) => s.id);
                control.states.forEach((s) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
                    s.smartName = getSmartNameFromObj(devicesObject[s.id], adapter.namespace);
                    s.common = {
                        min: (_b = (_a = devicesObject[s.id]) === null || _a === void 0 ? void 0 : _a.common) === null || _b === void 0 ? void 0 : _b.min,
                        max: (_d = (_c = devicesObject[s.id]) === null || _c === void 0 ? void 0 : _c.common) === null || _d === void 0 ? void 0 : _d.max,
                        type: (_f = (_e = devicesObject[s.id]) === null || _e === void 0 ? void 0 : _e.common) === null || _f === void 0 ? void 0 : _f.type,
                        states: (_h = (_g = devicesObject[s.id]) === null || _g === void 0 ? void 0 : _g.common) === null || _h === void 0 ? void 0 : _h.states,
                        role: (_k = (_j = devicesObject[s.id]) === null || _j === void 0 ? void 0 : _j.common) === null || _k === void 0 ? void 0 : _k.role,
                        name: (_m = (_l = devicesObject[s.id]) === null || _l === void 0 ? void 0 : _l.common) === null || _m === void 0 ? void 0 : _m.name,
                        icon: (_p = (_o = devicesObject[s.id]) === null || _o === void 0 ? void 0 : _o.common) === null || _p === void 0 ? void 0 : _p.icon,
                        color: (_r = (_q = devicesObject[s.id]) === null || _q === void 0 ? void 0 : _q.common) === null || _r === void 0 ? void 0 : _r.color,
                    };
                });
                devicesObject[id].common.smartName = smartName;
                control.object = {
                    id,
                    type: devicesObject[id].type,
                    common: devicesObject[id].common,
                    autoDetected: false,
                    toggle: smartName === null || smartName === void 0 ? void 0 : smartName.toggle,
                };
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
                control.groupNames = (name === null || name === void 0 ? void 0 : name.split(',').map((n) => n.trim())) || [];
                adapter.log.debug(`[ALEXA3] added ${id} with smartName as "${smartName.smartType}"`);
                detectedControls.push(control);
            }
            else {
                adapter.log.debug(`[ALEXA3] Ignored state ${id} with smartName ${JSON.stringify(smartName)} and type ${common.type}`);
            }
        }
        else {
            adapter.log.debug(`[ALEXA3] Ignored state ${id} with smartName ${JSON.stringify(smartName)} and type ${common.type}`);
        }
    }
    const usedIds = [];
    const ignoreIndicators = ['UNREACH_STICKY'];
    const excludedTypes = [type_detector_1.Types.info];
    const options = {
        objects: devicesObject,
        _keysOptional: keys,
        _usedIdsOptional: usedIds,
        ignoreIndicators,
        excludedTypes,
        id: '',
    };
    list.forEach((id) => {
        options.id = id;
        const controls = detector.detect(options);
        controls === null || controls === void 0 ? void 0 : controls.forEach((control) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const iotControl = control;
            if (iotControl.states.find((state) => state.id)) {
                iotControl.states = iotControl.states.filter((s) => s.id);
                iotControl.states.forEach((s) => {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
                    s.smartName = getSmartNameFromObj(devicesObject[s.id], adapter.namespace);
                    s.common = {
                        min: (_b = (_a = devicesObject[s.id]) === null || _a === void 0 ? void 0 : _a.common) === null || _b === void 0 ? void 0 : _b.min,
                        max: (_d = (_c = devicesObject[s.id]) === null || _c === void 0 ? void 0 : _c.common) === null || _d === void 0 ? void 0 : _d.max,
                        type: (_f = (_e = devicesObject[s.id]) === null || _e === void 0 ? void 0 : _e.common) === null || _f === void 0 ? void 0 : _f.type,
                        states: (_h = (_g = devicesObject[s.id]) === null || _g === void 0 ? void 0 : _g.common) === null || _h === void 0 ? void 0 : _h.states,
                        role: (_k = (_j = devicesObject[s.id]) === null || _j === void 0 ? void 0 : _j.common) === null || _k === void 0 ? void 0 : _k.role,
                        name: (_m = (_l = devicesObject[s.id]) === null || _l === void 0 ? void 0 : _l.common) === null || _m === void 0 ? void 0 : _m.name,
                        icon: (_p = (_o = devicesObject[s.id]) === null || _o === void 0 ? void 0 : _o.common) === null || _p === void 0 ? void 0 : _p.icon,
                        color: (_r = (_q = devicesObject[s.id]) === null || _q === void 0 ? void 0 : _q.common) === null || _r === void 0 ? void 0 : _r.color,
                    };
                });
                const room = rooms.find((room) => { var _a, _b; return (_b = (_a = room === null || room === void 0 ? void 0 : room.common) === null || _a === void 0 ? void 0 : _a.members) === null || _b === void 0 ? void 0 : _b.includes(id); });
                const functionality = functionalities.find((functionality) => { var _a, _b; return (_b = (_a = functionality === null || functionality === void 0 ? void 0 : functionality.common) === null || _a === void 0 ? void 0 : _a.members) === null || _b === void 0 ? void 0 : _b.includes(id); });
                const smartName = getSmartNameFromObj(devicesObject[id], adapter.namespace);
                iotControl.object = {
                    id,
                    type: devicesObject[id].type,
                    common: {
                        min: (_a = devicesObject[id].common) === null || _a === void 0 ? void 0 : _a.min,
                        max: (_b = devicesObject[id].common) === null || _b === void 0 ? void 0 : _b.max,
                        type: (_c = devicesObject[id].common) === null || _c === void 0 ? void 0 : _c.type,
                        states: (_d = devicesObject[id].common) === null || _d === void 0 ? void 0 : _d.states,
                        role: (_e = devicesObject[id].common) === null || _e === void 0 ? void 0 : _e.role,
                        name: (_f = devicesObject[id].common) === null || _f === void 0 ? void 0 : _f.name,
                        icon: (_g = devicesObject[id].common) === null || _g === void 0 ? void 0 : _g.icon,
                        color: (_h = devicesObject[id].common) === null || _h === void 0 ? void 0 : _h.color,
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
//# sourceMappingURL=Utils.js.map