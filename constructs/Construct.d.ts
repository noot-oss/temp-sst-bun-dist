import { Construct } from "constructs";
import { Stack as CDKStack } from "aws-cdk-lib/core";
import { FunctionBindingProps } from "./util/functionBinding.js";
export interface SSTConstructMetadata<T extends string = string, D extends Record<string, any> = Record<string, any>, L extends Record<string, any> = Record<string, any>> {
    type: T;
    data: D;
    local?: L;
}
export interface SSTConstruct extends Construct {
    id: string;
    getConstructMetadata(): SSTConstructMetadata;
    getFunctionBinding(): FunctionBindingProps | undefined;
}
export declare function getFunctionRef(fn?: any): {
    node: string;
    stack: string;
} | undefined;
export declare function isConstruct(construct: any): boolean;
export declare function isStackConstruct(construct: any): construct is CDKStack;
export declare function isSSTConstruct(construct: any): construct is SSTConstruct;
export declare function isSSTDebugStack(construct: any): construct is CDKStack;
export declare function isCDKConstructOf(construct: any, moduleName: string): construct is Construct;
export declare function isCDKConstruct(construct: any): construct is Construct;
