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
                    displayName: 'Value',
                    name: 'val',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'Value or JSON object',
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
        var _a, _b, _c;
        const items = this.getInputData();
        let type;
        let val = '';
        let oid = '';
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
                    const obj = await adapter.getIobObject(oid);
                    if (!obj) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Object with OID ${oid} does not exist.`);
                    }
                    if (obj.type !== 'state') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `OID ${oid} is not a state object.`);
                    }
                    if (((_a = obj.common) === null || _a === void 0 ? void 0 : _a.type) === 'number') {
                        if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                            const parsedState = JSON.parse(val);
                            if (typeof parsedState.val !== 'number') {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a number.`);
                            }
                            await adapter.setIobState(oid, parsedState);
                        }
                        else {
                            await adapter.setIobState(oid, { val: parseFloat(val), ack: false });
                        }
                    }
                    else if (((_b = obj.common) === null || _b === void 0 ? void 0 : _b.type) === 'boolean') {
                        if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                            const parsedState = JSON.parse(val);
                            if (typeof parsedState.val !== 'boolean') {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a boolean.`);
                            }
                            await adapter.setIobState(oid, parsedState);
                        }
                        else {
                            await adapter.setIobState(oid, { val: val.toLowerCase() === 'true', ack: false });
                        }
                    }
                    else if (((_c = obj.common) === null || _c === void 0 ? void 0 : _c.type) === 'string') {
                        if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                            const parsedState = JSON.parse(val);
                            if (typeof parsedState.val !== 'string') {
                                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for OID ${oid} must be a string.`);
                            }
                            await adapter.setIobState(oid, parsedState);
                        }
                        else {
                            await adapter.setIobState(oid, { val: val.toString(), ack: false });
                        }
                    }
                    else {
                        if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
                            const parsedState = JSON.parse(val);
                            await adapter.setIobState(oid, parsedState);
                        }
                        else {
                            await adapter.setIobState(oid, { val, ack: false });
                        }
                    }
                }
                else if (type === 'file') {
                }
                else if (type === 'log') {
                    if (typeof val !== 'string') {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Value for log must be a string.`);
                    }
                    adapter.writeIobLog(val, 'info');
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