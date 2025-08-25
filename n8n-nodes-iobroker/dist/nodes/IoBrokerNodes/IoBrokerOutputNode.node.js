"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IoBrokerOutputNode = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const IobAdapter_1 = require("./IobAdapter");
class IoBrokerOutputNode {
    constructor() {
        this.description = {
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
            inputs: ["main"],
            outputs: ["main"],
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
    }
    async execute() {
        var _a, _b, _c, _d;
        const items = this.getInputData();
        let type;
        let val = '';
        let oid = '';
        let ack = false;
        const adapter = await (0, IobAdapter_1.getAdapter)();
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                type = this.getNodeParameter('type', itemIndex, '');
                oid = this.getNodeParameter('oid', itemIndex, '');
                val = this.getNodeParameter('val', itemIndex, '');
                if (type === 'object') {
                    if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                        const jsonValue = JSON.parse(val);
                        await adapter.setIobObject(oid, jsonValue);
                    }
                    else if (typeof val === 'object' && val !== null) {
                        await adapter.setIobObject(oid, val);
                    }
                    else {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a valid JSON object.`);
                    }
                }
                else if (type === 'state') {
                    const _ack = this.getNodeParameter('ack', itemIndex, '');
                    ack = _ack === true || _ack === 'true' || _ack === 1 || _ack === '1';
                    if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                        const parsedState = JSON.parse(val);
                        if (typeof parsedState.val !== 'undefined') {
                            val = parsedState.val;
                            ack = (_a = parsedState.ack) !== null && _a !== void 0 ? _a : ack;
                        }
                    }
                    const obj = await adapter.getIobObject(oid);
                    if (!obj) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Object with OID ${oid} does not exist.`);
                    }
                    if (obj.type !== 'state') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `OID ${oid} is not a state object.`);
                    }
                    if (((_b = obj.common) === null || _b === void 0 ? void 0 : _b.type) === 'number') {
                        if (val === null) {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'string') {
                            await adapter.setIobState(oid, { val: parseFloat(val), ack });
                        }
                        else if (typeof val === 'number') {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'boolean') {
                            await adapter.setIobState(oid, { val: val ? 1 : 0, ack });
                        }
                        else {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a number.`);
                        }
                    }
                    else if (((_c = obj.common) === null || _c === void 0 ? void 0 : _c.type) === 'boolean') {
                        if (val === null) {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'string') {
                            await adapter.setIobState(oid, {
                                val: val.toLowerCase() === 'true' || val === '1',
                                ack,
                            });
                        }
                        else if (typeof val === 'boolean') {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'number') {
                            await adapter.setIobState(oid, { val: !!val, ack });
                        }
                        else {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a boolean.`);
                        }
                    }
                    else if (((_d = obj.common) === null || _d === void 0 ? void 0 : _d.type) === 'string') {
                        if (val === null) {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'string') {
                            await adapter.setIobState(oid, { val, ack });
                        }
                        else if (typeof val === 'number' || typeof val === 'boolean') {
                            await adapter.setIobState(oid, { val: val.toString(), ack });
                        }
                        else {
                            await adapter.setIobState(oid, { val: JSON.stringify(val), ack });
                        }
                    }
                    else {
                        await adapter.setIobState(oid, { val, ack: false });
                    }
                }
                else if (type === 'file') {
                    const fileName = this.getNodeParameter('fileName', itemIndex, '');
                    const base64 = this.getNodeParameter('base64', itemIndex, '');
                    if (!oid) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'For file type, OID must be provided.');
                    }
                    if (!fileName) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'For file type, path must be provided.');
                    }
                    await adapter.setIobFile(oid, fileName, val, base64);
                }
                else if (type === 'log') {
                    const level = this.getNodeParameter('level', itemIndex, '');
                    if (typeof val !== 'string') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for log must be a string.`);
                    }
                    if (level === 'error') {
                        adapter.writeIobLog(val, 'error');
                    }
                    else if (level === 'warn') {
                        adapter.writeIobLog(val, 'warn');
                    }
                    else if (level === 'debug') {
                        adapter.writeIobLog(val, 'debug');
                    }
                    else {
                        adapter.writeIobLog(val, 'info');
                    }
                }
            }
            catch (error) {
                if (this.continueOnFail()) {
                    items.push({ json: this.getInputData(itemIndex)[0].json, error, pairedItem: itemIndex });
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
        return [items];
    }
}
exports.IoBrokerOutputNode = IoBrokerOutputNode;
//# sourceMappingURL=IoBrokerOutputNode.node.js.map