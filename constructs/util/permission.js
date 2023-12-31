/* eslint-disable @typescript-eslint/ban-ts-comment*/
import * as iam from "aws-cdk-lib/aws-iam";
import { isCDKConstruct, isCDKConstructOf } from "../Construct.js";
import { Api } from "../Api.js";
import { ApiGatewayV1Api } from "../ApiGatewayV1Api.js";
import { Stack } from "../Stack.js";
import { WebSocketApi } from "../WebSocketApi.js";
import { AppSyncApi } from "../AppSyncApi.js";
import { Table } from "../Table.js";
import { Topic } from "../Topic.js";
import { Queue } from "../Queue.js";
import { EventBus } from "../EventBus.js";
import { KinesisStream } from "../KinesisStream.js";
import { Bucket } from "../Bucket.js";
import { Function } from "../Function.js";
import { RDS } from "../RDS.js";
import { Job } from "../Job.js";
export function attachPermissionsToRole(role, permissions) {
    const { statements, grants } = permissionsToStatementsAndGrants(permissions);
    statements.forEach((statement) => role.addToPolicy(statement));
    grants.forEach((grant) => {
        const construct = grant[0];
        const methodName = grant[1];
        construct[methodName](role);
    });
}
export function attachPermissionsToPolicy(policy, permissions) {
    const { statements, grants } = permissionsToStatementsAndGrants(permissions);
    statements.forEach((statement) => policy.addStatements(statement));
    grants.forEach((grant) => {
        throw new Error(`Cannot attach the "${grant[1]}" permission to an IAM policy.`);
    });
}
function permissionsToStatementsAndGrants(permissions) {
    // Four patterns
    //
    // attachPermissions("*");
    // attachPermissions([ 'sns', 'sqs' ]);
    // attachPermissions([ event, queue ]);
    // attachPermissions([
    //   [ event.snsTopic, 'grantPublish' ],
    //   [ queue.sqsQueue, 'grantSendMessages' ],
    // ]);
    // attachPermissions([
    //   new iam.PolicyStatement({
    //     actions: ["s3:*"],
    //     effect: iam.Effect.ALLOW,
    //     resources: [
    //       bucket.bucketArn + "/private/${cognito-identity.amazonaws.com:sub}/*",
    //     ],
    //   })
    // ]);
    ////////////////////////////////////
    // Case: 'admin' permissions => '*'
    ////////////////////////////////////
    if (permissions === "*") {
        return {
            statements: [buildPolicyStatement(permissions, ["*"])],
            grants: [],
        };
    }
    if (!Array.isArray(permissions)) {
        throw new Error(`The specified permissions are not supported. They are expected to be "*" or an array.`);
    }
    // Handle array of permissions
    const statements = [];
    const grants = [];
    permissions.forEach((permission) => {
        ////////////////////////////////////
        // Case: string ie. 's3' or 's3:*'
        ////////////////////////////////////
        if (typeof permission === "string") {
            const perm = permission.indexOf(":") === -1 ? `${permission}:*` : permission;
            statements.push(buildPolicyStatement(perm, ["*"]));
        }
        ////////////////////////////////////
        // Case: iam.PolicyStatement
        ////////////////////////////////////
        else if (isCDKConstructOf(permission, "aws-cdk-lib.aws_iam.PolicyStatement")) {
            statements.push(permission);
        }
        ////////////////////////////////////
        // Case: SST construct
        ////////////////////////////////////
        else if (permission instanceof Api) {
            const httpApi = permission.cdk.httpApi;
            const { account, region, partition } = Stack.of(httpApi);
            statements.push(buildPolicyStatement("execute-api:Invoke", [
                `arn:${partition}:execute-api:${region}:${account}:${httpApi.httpApiId}/*`,
            ]));
        }
        else if (permission instanceof ApiGatewayV1Api) {
            const restApi = permission.cdk.restApi;
            const { account, region, partition } = Stack.of(restApi);
            statements.push(buildPolicyStatement("execute-api:Invoke", [
                `arn:${partition}:execute-api:${region}:${account}:${restApi.restApiId}/*`,
            ]));
        }
        else if (permission instanceof WebSocketApi) {
            const webSocketApi = permission.cdk.webSocketApi;
            const { account, region, partition } = Stack.of(webSocketApi);
            statements.push(buildPolicyStatement("execute-api:Invoke", [
                `arn:${partition}:execute-api:${region}:${account}:${webSocketApi.apiId}/*`,
            ]));
            statements.push(buildPolicyStatement("execute-api:ManageConnections", [
                permission._connectionsArn,
            ]));
        }
        else if (permission instanceof AppSyncApi) {
            const graphqlApi = permission.cdk.graphqlApi;
            const { account, region, partition } = Stack.of(graphqlApi);
            statements.push(buildPolicyStatement("appsync:GraphQL", [
                `arn:${partition}:appsync:${region}:${account}:apis/${graphqlApi.apiId}/*`,
            ]));
        }
        else if (permission instanceof Table) {
            const tableArn = permission.cdk.table.tableArn;
            statements.push(buildPolicyStatement("dynamodb:*", [tableArn, `${tableArn}/*`]));
        }
        else if (permission instanceof Topic) {
            statements.push(buildPolicyStatement("sns:*", [permission.cdk.topic.topicArn]));
        }
        else if (permission instanceof Queue) {
            statements.push(buildPolicyStatement("sqs:*", [permission.cdk.queue.queueArn]));
        }
        else if (permission instanceof EventBus) {
            statements.push(buildPolicyStatement("events:*", [permission.cdk.eventBus.eventBusArn]));
        }
        else if (permission instanceof KinesisStream) {
            statements.push(buildPolicyStatement("kinesis:*", [permission.cdk.stream.streamArn]));
        }
        else if (permission instanceof Bucket) {
            const bucketArn = permission.cdk.bucket.bucketArn;
            statements.push(buildPolicyStatement("s3:*", [bucketArn, `${bucketArn}/*`]));
        }
        else if (permission instanceof RDS) {
            statements.push(buildPolicyStatement("rds-data:*", [permission.clusterArn]));
            if (permission.cdk.cluster.secret) {
                statements.push(buildPolicyStatement(["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"], [permission.cdk.cluster.secret.secretArn]));
            }
        }
        else if (permission instanceof Function) {
            statements.push(buildPolicyStatement("lambda:*", [permission.functionArn]));
        }
        else if (permission instanceof Job) {
            statements.push(buildPolicyStatement("lambda:*", [permission._jobManager.functionArn]));
        }
        ////////////////////////////////////
        // Case: CDK constructs
        ////////////////////////////////////
        else if (permission.tableArn && permission.tableName) {
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            const tableArn = permission.tableArn;
            statements.push(buildPolicyStatement("dynamodb:*", [tableArn, `${tableArn}/*`]));
        }
        else if (permission.topicArn && permission.topicName) {
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            statements.push(buildPolicyStatement("sns:*", [permission.topicArn]));
        }
        else if (permission.queueArn && permission.queueName) {
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            statements.push(buildPolicyStatement("sqs:*", [permission.queueArn]));
        }
        else if (permission.eventBusArn &&
            permission.eventBusName) {
            statements.push(
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            buildPolicyStatement("events:*", [permission.eventBusArn]));
        }
        else if (permission.streamArn &&
            permission.streamName) {
            statements.push(
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            buildPolicyStatement("kinesis:*", [permission.streamArn]));
        }
        else if (permission.deliveryStreamArn &&
            permission.deliveryStreamName) {
            statements.push(buildPolicyStatement("firehose:*", [
                permission.deliveryStreamArn,
            ]));
        }
        else if (permission.bucketArn &&
            permission.bucketName) {
            // @ts-expect-error We do not want to import the cdk modules, just cast to any
            const bucketArn = permission.bucketArn;
            statements.push(buildPolicyStatement("s3:*", [bucketArn, `${bucketArn}/*`]));
        }
        else if (permission.clusterArn) {
            // For ServerlessCluster, we need to grant:
            // - permisssions to access the Data API;
            // - permisssions to access the Secret Manager (required by Data API).
            // No need to grant the permissions for IAM database authentication
            statements.push(buildPolicyStatement("rds-data:*", [permission.clusterArn]));
            const secret = permission.secret;
            if (secret) {
                statements.push(buildPolicyStatement(["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"], [secret.secretArn]));
            }
            if (secret?.encryptionKey) {
                statements.push(buildPolicyStatement(["kms:Decrypt"], [secret.encryptionKey.keyArn]));
            }
        }
        ////////////////////////////////////
        // Case: grant method
        ////////////////////////////////////
        else if (Array.isArray(permission) &&
            permission.length === 2 &&
            isCDKConstruct(permission[0]) &&
            typeof permission[1] === "string") {
            const construct = permission[0];
            const methodName = permission[1];
            if (typeof construct[methodName] !== "function")
                throw new Error(`The specified grant method is incorrect.
          Check the available methods that prefixed with grants on the Construct`);
            grants.push(permission);
        }
        else {
            throw new Error(`The specified permissions are not supported.`);
        }
    });
    return { statements, grants };
}
function buildPolicyStatement(actions, resources) {
    return new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: typeof actions === "string" ? [actions] : actions,
        resources,
    });
}
