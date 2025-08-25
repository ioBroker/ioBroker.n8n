import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { type IotExternalPatternControl } from './Utils';
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
export type IobFileSubscriptionHandler = (id: string, fileName: string, size?: number | null, file?: {
    file: string | Buffer;
    mimeType?: string;
}) => void;
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
export declare class N8NNodeAdapter extends Adapter {
    config: N8NAdapterConfig;
    private _ready;
    private subscribes;
    private ownLanguage;
    private cache;
    private handlers;
    private requests;
    constructor(options?: Partial<AdapterOptions>);
    private main;
    private onLog;
    private onStateChange;
    private onObjectChange;
    private onFileChange;
    private subscribeOnState;
    private subscribeOnObject;
    private subscribeOnFile;
    registerHandler(handler: IobStateSubscription | IobObjectSubscription | IobFileSubscription | IobLogSubscription): Promise<void>;
    setIobObject(oid: string, obj: Partial<ioBroker.Object>): Promise<{
        id: string;
    }>;
    getIobObject(oid: string): Promise<ioBroker.Object | null | undefined>;
    setIobState(oid: string, state: ioBroker.SettableState): Promise<string>;
    getIobState(oid: string): Promise<ioBroker.State | null | undefined>;
    setIobFile(oid: string, fileName: string, file: Buffer | string, base64?: boolean): Promise<void>;
    getIobFile(oid: string, fileName: string, base64?: boolean): Promise<{
        file: string | Buffer;
        mimeType?: string;
    } | null>;
    writeIobLog(message: string, level?: ioBroker.LogLevel): void;
    readIobLog(level?: ioBroker.LogLevel, instance?: string, count?: number): Promise<ioBroker.LogMessage[]>;
    readIobEnums(type: string, language?: ioBroker.Languages, withIcons?: boolean): Promise<EnumResponse[]>;
    private _readEnums;
    readIobDevices(language?: ioBroker.Languages, withIcons?: boolean): Promise<IotExternalPatternControl[]>;
    private _readDevices;
    private _getInstances;
    getInstances(): Promise<{
        value: string;
        name: string;
    }[]>;
}
export declare function getAdapter(handler?: IobStateSubscription | IobObjectSubscription | IobFileSubscription | IobLogSubscription): Promise<N8NNodeAdapter>;
