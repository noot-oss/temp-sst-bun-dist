import { Construct } from "constructs";
import { FunctionProps } from "aws-cdk-lib/aws-lambda";
import { Distribution } from "./Distribution.js";
import { SsrFunction } from "./SsrFunction.js";
import { EdgeFunction } from "./EdgeFunction.js";
import { SsrSite, SsrSiteProps } from "./SsrSite.js";
import { Size } from "./util/size.js";
export interface NextjsSiteProps extends Omit<SsrSiteProps, "nodejs"> {
    imageOptimization?: {
        /**
         * The amount of memory in MB allocated for image optimization function.
         * @default 1024 MB
         * @example
         * ```js
         * memorySize: "512 MB",
         * ```
         */
        memorySize?: number | Size;
    };
    cdk?: SsrSiteProps["cdk"] & {
        revalidation?: Pick<FunctionProps, "vpc" | "vpcSubnets">;
        /**
         * Override the CloudFront cache policy properties for responses from the
         * server rendering Lambda.
         *
         * @default
         * By default, the cache policy is configured to cache all responses from
         * the server rendering Lambda based on the query-key only. If you're using
         * cookie or header based authentication, you'll need to override the
         * cache policy to cache based on those values as well.
         *
         * ```js
         * serverCachePolicy: new CachePolicy(this, "ServerCache", {
         *   queryStringBehavior: CacheQueryStringBehavior.all()
         *   headerBehavior: CacheHeaderBehavior.allowList(
         *     "accept",
         *     "rsc",
         *     "next-router-prefetch",
         *     "next-router-state-tree",
         *     "next-url",
         *   ),
         *   cookieBehavior: CacheCookieBehavior.none()
         *   defaultTtl: Duration.days(0)
         *   maxTtl: Duration.days(365)
         *   minTtl: Duration.days(0)
         * })
         * ```
         */
        serverCachePolicy?: NonNullable<SsrSiteProps["cdk"]>["serverCachePolicy"];
    };
}
/**
 * The `NextjsSite` construct is a higher level CDK construct that makes it easy to create a Next.js app.
 * @example
 * Deploys a Next.js app in the `my-next-app` directory.
 *
 * ```js
 * new NextjsSite(stack, "web", {
 *   path: "my-next-app/",
 * });
 * ```
 */
export declare class NextjsSite extends SsrSite {
    protected props: NextjsSiteProps & {
        path: Exclude<NextjsSiteProps["path"], undefined>;
        runtime: Exclude<NextjsSiteProps["runtime"], undefined>;
        timeout: Exclude<NextjsSiteProps["timeout"], undefined>;
        memorySize: Exclude<NextjsSiteProps["memorySize"], undefined>;
        waitForInvalidation: Exclude<NextjsSiteProps["waitForInvalidation"], undefined>;
    };
    constructor(scope: Construct, id: string, props?: NextjsSiteProps);
    protected createRevalidation(): void;
    protected initBuildConfig(): {
        typesPath: string;
        serverBuildOutputFile: string;
        clientBuildOutputDir: string;
        clientBuildVersionedSubDir: string;
        clientBuildS3KeyPrefix: string;
        prerenderedBuildOutputDir: string;
        prerenderedBuildS3KeyPrefix: string;
        warmerFunctionAssetPath: string;
    };
    protected createFunctionForRegional(): SsrFunction;
    protected createFunctionForEdge(): EdgeFunction;
    private createImageOptimizationFunction;
    protected createCloudFrontDistributionForRegional(): Distribution;
    protected createCloudFrontDistributionForEdge(): Distribution;
    protected useServerBehaviorCachePolicy(): import("aws-cdk-lib/aws-cloudfront").CachePolicy;
    private buildImageBehavior;
    protected generateBuildId(): string;
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
        type: "NextjsSite";
    };
}
