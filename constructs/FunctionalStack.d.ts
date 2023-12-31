import { App } from "./App.js";
import { Stack, StackProps } from "./Stack.js";
export declare function stack(app: App, fn: FunctionalStack<any>, props?: StackProps & {
    id?: string;
}): any;
export declare function use<T>(stack: FunctionalStack<T>): T;
export declare function dependsOn(stack: FunctionalStack<any>): void;
export declare function getStack(stack: FunctionalStack<any>): Stack;
export type StackContext = {
    app: App;
    stack: Stack;
};
export type FunctionalStack<T> = (this: Stack, ctx: StackContext) => T | Promise<T>;
