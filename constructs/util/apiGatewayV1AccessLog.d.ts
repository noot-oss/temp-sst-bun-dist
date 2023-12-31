import { Construct } from "constructs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apig from "aws-cdk-lib/aws-apigateway";
export interface AccessLogProps {
    format?: string;
    destinationArn?: string;
    retention?: Lowercase<keyof typeof logs.RetentionDays>;
}
export type AccessLogData = {
    logGroup: logs.LogGroup | undefined;
    format: apig.AccessLogFormat;
    destination: apig.LogGroupLogDestination;
};
export declare function buildAccessLogData(scope: Construct, accessLog: boolean | string | AccessLogProps | undefined): AccessLogData | undefined;
export declare function cleanupLogGroupName(str: string): string;
