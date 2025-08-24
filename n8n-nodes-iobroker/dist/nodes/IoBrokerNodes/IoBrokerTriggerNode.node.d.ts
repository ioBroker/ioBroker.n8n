import { type INodeType, type INodeTypeDescription, type ITriggerFunctions, type ITriggerResponse, type ILoadOptionsFunctions, type INodePropertyOptions } from 'n8n-workflow';
export declare class IoBrokerTriggerNode implements INodeType {
    description: INodeTypeDescription;
    methods: {
        loadOptions: {
            getInstances(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
        };
    };
    trigger(this: ITriggerFunctions): Promise<ITriggerResponse>;
}
