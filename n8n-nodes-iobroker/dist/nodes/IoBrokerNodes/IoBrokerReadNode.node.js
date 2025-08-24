"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IoBrokerReadNode = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const IobAdapter_1 = require("./IobAdapter");
class IoBrokerReadNode {
    constructor() {
        this.description = {
            displayName: 'ioBroker Read',
            name: 'ioBrokerRead',
            subtitle: '={{$parameter["type"] + ($parameter["oid"] ? " - " + $parameter["oid"] : "")}}',
            group: ['output'],
            icon: 'file:ioBroker.svg',
            version: 1,
            description: 'ioBroker Read',
            defaults: {
                name: 'ioBroker Read',
                color: '#144578',
            },
            inputs: ["main"],
            outputs: ["main"],
            usableAsTool: true,
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
                    placeholder: 'Write here the ioBroker object ID',
                    description: 'like javascript.0.myObject',
                    displayOptions: {
                        show: {
                            type: ['state', 'object', 'file'],
                        },
                    },
                },
                {
                    displayName: 'File name',
                    name: 'fileName',
                    type: 'string',
                    default: '*',
                    required: true,
                    placeholder: 'File name or pattern',
                    description: 'like main/vis-views.json',
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
                            type: ['rooms', 'functions', 'devices'],
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
        this.retryOnFail = false;
        this.methods = {
            loadOptions: {
                async getInstances() {
                    const adapter = await (0, IobAdapter_1.getAdapter)();
                    return await adapter.getInstances();
                },
            },
        };
    }
    async execute() {
        const items = this.getInputData();
        let type;
        const adapter = await (0, IobAdapter_1.getAdapter)();
        const result = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                type = this.getNodeParameter('type', itemIndex, '');
                if (type === 'object') {
                    const oid = this.getNodeParameter('oid', itemIndex, '');
                    const object = await adapter.getIobObject(oid);
                    result.push({ json: object || {}, pairedItem: itemIndex });
                }
                else if (type === 'state') {
                    const oid = this.getNodeParameter('oid', itemIndex, '');
                    const state = await adapter.getIobState(oid);
                    result.push({ json: state || {}, pairedItem: itemIndex });
                }
                else if (type === 'file') {
                    const oid = this.getNodeParameter('oid', itemIndex, '');
                    const fileName = this.getNodeParameter('fileName', itemIndex, '');
                    const file = await adapter.readFileAsync(oid, fileName);
                    result.push({
                        json: {
                            fileName,
                            mimeType: (file === null || file === void 0 ? void 0 : file.mimeType) || undefined,
                            content: file && typeof file.file === 'string' ? file.file : undefined,
                        },
                        binary: (file === null || file === void 0 ? void 0 : file.file) && typeof file.file !== 'string'
                            ? { file: file.file }
                            : undefined,
                        pairedItem: itemIndex,
                    });
                }
                else if (type === 'log') {
                    const level = this.getNodeParameter('level', itemIndex, '');
                    const instance = this.getNodeParameter('instance', itemIndex, '');
                    const logsCount = this.getNodeParameter('logsCount', itemIndex, '');
                    const messages = await adapter.readIobLog(level, instance, logsCount);
                    result.push({
                        json: { logs: messages },
                        pairedItem: itemIndex,
                    });
                }
                else if (type === 'rooms') {
                    const language = this.getNodeParameter('language', itemIndex, 'de');
                    const withIcons = this.getNodeParameter('withIcons', itemIndex, false);
                    const ignoreEmptyItems = this.getNodeParameter('ignoreEmptyItems', itemIndex, false);
                    const enums = await adapter.readIobEnums('rooms', language, withIcons);
                    if (ignoreEmptyItems) {
                        result.push({
                            json: { enums: enums.filter((e) => e.items.length) },
                            pairedItem: itemIndex,
                        });
                    }
                    else {
                        result.push({ json: { enums }, pairedItem: itemIndex });
                    }
                }
                else if (type === 'functions') {
                    const language = this.getNodeParameter('language', itemIndex, 'de');
                    const withIcons = this.getNodeParameter('withIcons', itemIndex, false);
                    const ignoreEmptyItems = this.getNodeParameter('ignoreEmptyItems', itemIndex, false);
                    const enums = await adapter.readIobEnums('functions', language, withIcons);
                    if (ignoreEmptyItems) {
                        result.push({
                            json: { enums: enums.filter((e) => e.items.length) },
                            pairedItem: itemIndex,
                        });
                    }
                    else {
                        result.push({ json: { enums }, pairedItem: itemIndex });
                    }
                }
                else if (type === 'devices') {
                    const language = this.getNodeParameter('language', itemIndex, 'de');
                    const withIcons = this.getNodeParameter('withIcons', itemIndex, false);
                    const devices = await adapter.readIobDevices(language, withIcons);
                    result.push({ json: { devices }, pairedItem: itemIndex });
                }
            }
            catch (error) {
                if (this.continueOnFail()) {
                    result.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [result];
    }
}
exports.IoBrokerReadNode = IoBrokerReadNode;
//# sourceMappingURL=IoBrokerReadNode.node.js.map