import { Stack } from "./Stack.js";
export function stack(app, fn, props) {
    currentApp = app;
    currentStack = fn;
    const id = props?.id || fn.name;
    const exists = getExports(app).has(fn);
    if (exists)
        throw new Error(`StackDuplicates: Attempting to initialize stack ${id} several times`);
    class EmptyStack extends Stack {
        constructor(scope, id, props) {
            super(scope, id, props);
        }
    }
    const stack = new EmptyStack(app, id, props);
    getStacks(app).set(fn, stack);
    const ctx = {
        app,
        stack,
    };
    const returns = fn.bind(stack)(ctx);
    if (returns && "then" in returns)
        return returns.then((data) => {
            getExports(app).set(fn, data);
        });
    getExports(app).set(fn, returns);
    return app;
}
let currentApp;
let currentStack;
const exportsCache = new Map();
const stackCache = new Map();
function getExports(app) {
    if (!exportsCache.has(app))
        exportsCache.set(app, new Map());
    return exportsCache.get(app);
}
function getStacks(app) {
    if (!stackCache.has(app))
        stackCache.set(app, new Map());
    return stackCache.get(app);
}
export function use(stack) {
    if (!currentApp)
        throw new Error("No app is set");
    const exports = getExports(currentApp);
    if (!exports.has(stack))
        throw new Error(`StackWrongOrder: Initialize "${stack.name}" stack before "${currentStack?.name}" stack`);
    return exports.get(stack);
}
export function dependsOn(stack) {
    const current = getStack(currentStack);
    const target = getStack(stack);
    current.addDependency(target);
}
export function getStack(stack) {
    if (!currentApp)
        throw new Error("No app is set");
    const stacks = getStacks(currentApp);
    if (!stacks.has(stack))
        throw new Error(`StackWrongOrder: Initialize "${stack.name}" stack before "${currentStack?.name}" stack`);
    return stacks.get(stack);
}
