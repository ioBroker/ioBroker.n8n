"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IoBrokerTriggerNode = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const IobAdapter_1 = require("./IobAdapter");
class IoBrokerTriggerNode {
    constructor() {
        this.description = {
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
        this.methods = {
            loadOptions: {
                async getInstances() {
                    const adapter = await (0, IobAdapter_1.getAdapter)();
                    return await adapter.getInstances();
                },
            },
        };
    }
    async trigger() {
        const type = this.getNodeParameter('type');
        if (type === 'log') {
            const instance = this.getNodeParameter('instance');
            const level = this.getNodeParameter('level');
            const logHandler = (message) => {
                this.emit([[{ json: message }]]);
            };
            await (0, IobAdapter_1.getAdapter)({ nodeId: this.getNode().id, logHandler, instance, level });
            return {};
        }
        else if (type === 'file') {
            let fileName = this.getNodeParameter('fileName');
            const withContent = this.getNodeParameter('withContent');
            if (!(fileName === null || fileName === void 0 ? void 0 : fileName.replace(/^\//, ''))) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'For file type, path must be provided.');
            }
            if (fileName.startsWith('/')) {
                fileName = fileName.substring(1);
            }
            const [adapterName, ...rest] = fileName.split('/');
            if (!rest.length) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'For file type, path must contain at least one directory.');
            }
            if (!adapterName) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), `For file type, path must start with some adapter name like "vis-2.0", but found: ${adapterName}.`);
            }
            if (!rest.join('/')) {
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'For file type, path must contain a file name.');
            }
            fileName = rest.join('/');
            console.log('Listening for ', type, adapterName, fileName);
            const fileHandler = (id, fileName, size, file) => {
                console.log('Triggering on file', type, id, fileName);
                this.emit([
                    [
                        {
                            json: {
                                fileName,
                                size,
                                mimeType: (file === null || file === void 0 ? void 0 : file.mimeType) || undefined,
                                content: file && typeof file.file === 'string' ? file.file : undefined,
                            },
                            binary: (file === null || file === void 0 ? void 0 : file.file) && typeof file.file !== 'string'
                                ? { file: file.file }
                                : undefined,
                        },
                    ],
                ]);
            };
            const nodeId = this.getNode().id;
            await (0, IobAdapter_1.getAdapter)({ nodeId, oid: adapterName, fileName, fileHandler, withContent });
            return {};
        }
        else if (type === 'object') {
            const oid = this.getNodeParameter('oid');
            const objectHandler = (id, obj) => {
                console.log('Triggering on object', type, id, obj);
                this.emit([[{ json: obj || {} }]]);
            };
            const nodeId = this.getNode().id;
            await (0, IobAdapter_1.getAdapter)({ nodeId, oid, objectHandler });
            return {};
        }
        const oid = this.getNodeParameter('oid');
        console.log('Triggering on', type, oid);
        const stateHandler = (id, state) => {
            console.log('Triggering on', type, id, state);
            this.emit([[{ json: state || {} }]]);
        };
        const nodeId = this.getNode().id;
        await (0, IobAdapter_1.getAdapter)({ nodeId, oid, stateHandler });
        return {};
    }
}
exports.IoBrokerTriggerNode = IoBrokerTriggerNode;
//# sourceMappingURL=IoBrokerTriggerNode.node.js.map