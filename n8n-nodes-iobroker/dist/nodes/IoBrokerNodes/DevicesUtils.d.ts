import { Types } from '@iobroker/type-detector';
import type { InternalDetectorState } from '@iobroker/type-detector/types';
export type SmartNameObject = {
    [lang in ioBroker.Languages]?: string;
} & {
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
        unit?: string;
        type?: ioBroker.CommonType;
        states?: {
            [value: string]: string;
        };
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
export declare function isValidSmartName(smartName: SmartName | undefined, lang: ioBroker.Languages): boolean;
export declare function controls(adapter: ioBroker.Adapter, lang: ioBroker.Languages): Promise<IotExternalPatternControl[]>;
type RoomName = string;
type FunctionalityName = string;
type ControlType = 'power' | 'dimmer' | 'blindPosition' | 'stop' | 'openedClosed' | 'alarm' | 'color' | 'colorRed' | 'colorGreen' | 'colorBlue' | 'colorWhite' | 'colorTemperature' | 'openClose' | 'open' | 'close' | 'fanSpeed' | 'boostMode' | 'swingPosition' | 'saturation' | 'swingOnOff' | 'actualTemperature' | 'humidity' | 'illuminance' | 'level' | 'volume' | 'targetTemperature' | 'lock' | 'valve';
type ControlInDevice = {
    stateId: string;
    controlType: ControlType;
    ioBrokerValueType: ioBroker.CommonType;
    writable: boolean;
    readable: boolean;
    min?: number;
    max?: number;
    unit?: string;
    states?: {
        [value: string]: string;
    };
    role?: string;
};
export interface Device {
    deviceName: string | ioBroker.StringOrTranslated | undefined;
    deviceType: Types;
    friendlyDeviceNames: string[];
    room?: RoomName;
    functionality?: FunctionalityName;
    controls: {
        [controlType: string]: ControlInDevice;
    };
}
export interface Room {
    roomName: RoomName;
    devicesInRoom: Device[];
}
export interface Functionality {
    functionalityName: FunctionalityName;
    devicesInFunctionality: Device[];
}
export declare function getAiFriendlyStructure(adapter: ioBroker.Adapter, lang: ioBroker.Languages): Promise<Room[]>;
export {};
