import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { Adapter } from "./adapter/adapter.js";
import { SignerOptions } from "fast-jwt";
import { SessionBuilder, SessionValue } from "./session.js";
interface OnSuccessResponder<T> {
    session(input: T & Partial<SignerOptions>): {
        type: "session";
        properties: T;
    };
    http(input: APIGatewayProxyStructuredResultV2): {
        type: "http";
        properties: typeof input;
    };
}
export declare class UnknownProviderError {
    provider?: string | undefined;
    constructor(provider?: string | undefined);
}
export declare function AuthHandler<Providers extends Record<string, Adapter<any>>, Sessions extends SessionBuilder, Result = {
    [key in keyof Providers]: {
        provider: key;
    } & Extract<Awaited<ReturnType<Providers[key]>>, {
        type: "success";
    }>["properties"];
}[keyof Providers]>(input: {
    providers: Providers;
    sessions?: Sessions;
    /** @deprecated use allowClient callback instead */
    clients?: () => Promise<Record<string, string>>;
    allowClient?: (clientID: string, redirect: string) => Promise<boolean>;
    onAuthorize?: (event: APIGatewayProxyEventV2) => Promise<void | keyof Providers>;
    onSuccess: (input: Result, response: OnSuccessResponder<SessionValue | {
        [key in keyof Sessions["$type"]]: {
            type: key;
            properties: Sessions["$type"][key];
        };
    }[keyof Sessions["$type"]]>) => Promise<ReturnType<OnSuccessResponder<SessionValue | {
        [key in keyof Sessions["$type"]]: {
            type: key;
            properties: Sessions["$type"][key];
        };
    }[keyof Sessions["$type"]]>[keyof OnSuccessResponder<any>]>>;
    onIndex?: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;
    onError?: (error: UnknownProviderError) => Promise<APIGatewayProxyStructuredResultV2 | undefined>;
}): (event: APIGatewayProxyEventV2, context: import("aws-lambda").Context) => Promise<APIGatewayProxyStructuredResultV2>;
export {};
