import { type IExecuteFunctions, type INodeExecutionData, type INodeType, type INodeTypeDescription, type ILoadOptionsFunctions, type INodePropertyOptions } from 'n8n-workflow';
export declare class IoBrokerReadNode implements INodeType {
    description: INodeTypeDescription;
    retryOnFail: boolean;
    methods: {
        loadOptions: {
            getInstances(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
        };
    };
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
