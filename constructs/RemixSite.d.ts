import { SsrSite } from "./SsrSite.js";
import { SsrFunction } from "./SsrFunction.js";
import { EdgeFunction } from "./EdgeFunction.js";
/**
 * The `RemixSite` construct is a higher level CDK construct that makes it easy to create a Remix app.
 *
 * @example
 *
 * Deploys a Remix app in the `my-remix-app` directory.
 *
 * ```js
 * new RemixSite(stack, "web", {
 *   path: "my-remix-app/",
 * });
 * ```
 */
export declare class RemixSite extends SsrSite {
    private serverModuleFormat;
    protected initBuildConfig(): {
        typesPath: string;
        serverBuildOutputFile: string;
        clientBuildOutputDir: string;
        clientBuildVersionedSubDir: string;
        clientCFFunctionInjection: string;
    };
    private createServerLambdaBundle;
    protected createFunctionForRegional(): SsrFunction;
    protected createFunctionForEdge(): EdgeFunction;
    getConstructMetadata(): {
        data: {
            mode: "placeholder" | "deployed";
            path: string;
            runtime: "nodejs14.x" | "nodejs16.x" | "nodejs18.x";
            customDomainUrl: string | undefined;
            url: string | undefined;
            edge: boolean | undefined;
            server: string;
            secrets: string[];
        };
        type: "RemixSite";
    };
}
