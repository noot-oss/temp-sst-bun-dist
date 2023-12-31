import { Function as Fn } from "aws-cdk-lib/aws-lambda";
import { Stack } from "./Stack.js";
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
export function getFunctionRef(fn) {
    if (!fn)
        return undefined;
    if (!(fn instanceof Fn))
        return undefined;
    return {
        node: fn.node.addr,
        stack: Stack.of(fn).stackName,
    };
}
export function isConstruct(construct) {
    return isSSTConstruct(construct) || isCDKConstruct(construct);
}
export function isStackConstruct(construct) {
    return isCDKConstructOf(construct, "aws-cdk-lib.Stack");
}
export function isSSTConstruct(construct) {
    return typeof construct === "object" && "getConstructMetadata" in construct;
}
export function isSSTDebugStack(construct) {
    return (isStackConstruct(construct) && construct.constructor.name === "DebugStack");
}
export function isCDKConstructOf(construct, moduleName) {
    // We need to check if construct is an CDK construct. To do that:
    // - we cannot use the `construct instanceof` check because ie. the PolicyStatement
    //   instance in the user's app might come from a different npm package version
    // - we cannot use the `construct.constructor.name` check because the constructor
    //   name can be prefixed with a number ie. PolicyStatement2
    //
    // Therefore we are going to get the constructor's fqn. The constructor for a CDK
    // construct looks like:
    //    [class Bucket2 extends BucketBase] {
    //      [Symbol(jsii.rtti)]: { fqn: '@aws-cdk/aws-s3.Bucket', version: '1.91.0' }
    //    }
    // We will check against `fqn`.
    const fqn = construct?.constructor?.[JSII_RTTI_SYMBOL_1]?.fqn;
    return typeof fqn === "string" && fqn === moduleName;
}
export function isCDKConstruct(construct) {
    const fqn = construct?.constructor?.[JSII_RTTI_SYMBOL_1]?.fqn;
    return (typeof fqn === "string" &&
        (fqn.startsWith("@aws-cdk/") || fqn.startsWith("aws-cdk-lib")));
}
