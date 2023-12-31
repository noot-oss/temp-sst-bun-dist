import { Construct } from "constructs";
import { Bucket, BucketProps, IBucket } from "aws-cdk-lib/aws-s3";
import { FunctionProps as CdkFunctionProps } from "aws-cdk-lib/aws-lambda";
import { ICachePolicy, IResponseHeadersPolicy, BehaviorOptions, CachePolicy, Function as CfFunction, FunctionEventType as CfFunctionEventType } from "aws-cdk-lib/aws-cloudfront";
import { Distribution, DistributionDomainProps } from "./Distribution.js";
import { SSTConstruct } from "./Construct.js";
import { NodeJSProps, FunctionProps } from "./Function.js";
import { SsrFunction } from "./SsrFunction.js";
import { EdgeFunction } from "./EdgeFunction.js";
import { BaseSiteFileOptions, BaseSiteReplaceProps, BaseSiteCdkDistributionProps } from "./BaseSite.js";
import { Size } from "./util/size.js";
import { Duration } from "./util/duration.js";
import { Permissions } from "./util/permission.js";
import { FunctionBindingProps } from "./util/functionBinding.js";
export type SsrBuildConfig = {
    typesPath: string;
    serverBuildOutputFile: string;
    serverCFFunctionInjection?: string;
    clientBuildOutputDir: string;
    clientBuildVersionedSubDir: string;
    clientBuildS3KeyPrefix?: string;
    clientCFFunctionInjection?: string;
    prerenderedBuildOutputDir?: string;
    prerenderedBuildS3KeyPrefix?: string;
    warmerFunctionAssetPath?: string;
};
export interface SsrSiteNodeJSProps extends NodeJSProps {
}
export interface SsrDomainProps extends DistributionDomainProps {
}
export interface SsrSiteFileOptions extends BaseSiteFileOptions {
}
export interface SsrSiteReplaceProps extends BaseSiteReplaceProps {
}
export interface SsrCdkDistributionProps extends BaseSiteCdkDistributionProps {
}
export interface SsrSiteProps {
    /**
     * Bind resources for the function
     *
     * @example
     * ```js
     * new Function(stack, "Function", {
     *   handler: "src/function.handler",
     *   bind: [STRIPE_KEY, bucket],
     * })
     * ```
     */
    bind?: SSTConstruct[];
    /**
     * Path to the directory where the app is located.
     * @default "."
     */
    path?: string;
    /**
     * The command for building the website
     * @default `npm run build`
     * @example
     * ```js
     * buildCommand: "yarn build",
     * ```
     */
    buildCommand?: string;
    /**
     * The customDomain for this website. SST supports domains that are hosted
     * either on [Route 53](https://aws.amazon.com/route53/) or externally.
     *
     * Note that you can also migrate externally hosted domains to Route 53 by
     * [following this guide](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/MigratingDNS.html).
     *
     * @example
     * ```js
     * customDomain: "domain.com",
     * ```
     *
     * ```js
     * customDomain: {
     *   domainName: "domain.com",
     *   domainAlias: "www.domain.com",
     *   hostedZone: "domain.com"
     * },
     * ```
     */
    customDomain?: string | SsrDomainProps;
    /**
     * The SSR function is deployed to Lambda in a single region. Alternatively, you can enable this option to deploy to Lambda@Edge.
     * @default false
     */
    edge?: boolean;
    /**
     * The execution timeout in seconds for SSR function.
     * @default 10 seconds
     * @example
     * ```js
     * timeout: "5 seconds",
     * ```
     */
    timeout?: number | Duration;
    /**
     * The amount of memory in MB allocated for SSR function.
     * @default 1024 MB
     * @example
     * ```js
     * memorySize: "512 MB",
     * ```
     */
    memorySize?: number | Size;
    /**
     * The runtime environment for the SSR function.
     * @default nodejs18.x
     * @example
     * ```js
     * runtime: "nodejs16.x",
     * ```
     */
    runtime?: "nodejs14.x" | "nodejs16.x" | "nodejs18.x";
    /**
     * Used to configure nodejs function properties
     */
    nodejs?: SsrSiteNodeJSProps;
    /**
     * Attaches the given list of permissions to the SSR function. Configuring this property is equivalent to calling `attachPermissions()` after the site is created.
     * @example
     * ```js
     * permissions: ["ses"]
     * ```
     */
    permissions?: Permissions;
    /**
     * An object with the key being the environment variable name.
     *
     * @example
     * ```js
     * environment: {
     *   API_URL: api.url,
     *   USER_POOL_CLIENT: auth.cognitoUserPoolClient.userPoolClientId,
     * },
     * ```
     */
    environment?: Record<string, string>;
    /**
     * The number of server functions to keep warm. This option is only supported for the regional mode.
     * @default Server function is not kept warm
     */
    warm?: number;
    regional?: {
        /**
         * Secure the server function URL using AWS IAM authentication. By default, the server function URL is publicly accessible. When this flag is enabled, the server function URL will require IAM authorization, and a Lambda@Edge function will sign the requests. Be aware that this introduces added latency to the requests.
         * @default false
         */
        enableServerUrlIamAuth?: boolean;
    };
    dev?: {
        /**
         * When running `sst dev`, site is not deployed. This is to ensure `sst dev` can start up quickly.
         * @default false
         * @example
         * ```js
         * dev: {
         *   deploy: true
         * }
         * ```
         */
        deploy?: boolean;
        /**
         * The local site URL when running `sst dev`.
         * @example
         * ```js
         * dev: {
         *   url: "http://localhost:3000"
         * }
         * ```
         */
        url?: string;
    };
    /**
     * While deploying, SST waits for the CloudFront cache invalidation process to finish. This ensures that the new content will be served once the deploy command finishes. However, this process can sometimes take more than 5 mins. For non-prod environments it might make sense to pass in `false`. That'll skip waiting for the cache to invalidate and speed up the deploy process.
     * @default false
     */
    waitForInvalidation?: boolean;
    cdk?: {
        /**
         * Allows you to override default id for this construct.
         */
        id?: string;
        /**
         * Allows you to override default settings this construct uses internally to ceate the bucket
         */
        bucket?: BucketProps | IBucket;
        /**
         * Pass in a value to override the default settings this construct uses to
         * create the CDK `Distribution` internally.
         */
        distribution?: SsrCdkDistributionProps;
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
         *   headerBehavior: CacheHeaderBehavior.none()
         *   cookieBehavior: CacheCookieBehavior.none()
         *   defaultTtl: Duration.days(0)
         *   maxTtl: Duration.days(365)
         *   minTtl: Duration.days(0)
         * })
         * ```
         */
        serverCachePolicy?: ICachePolicy;
        /**
         * Override the CloudFront response headers policy properties for responses
         * from the server rendering Lambda.
         */
        responseHeadersPolicy?: IResponseHeadersPolicy;
        server?: Pick<CdkFunctionProps, "vpc" | "vpcSubnets" | "securityGroups" | "allowAllOutbound" | "allowPublicSubnet" | "architecture" | "logRetention"> & Pick<FunctionProps, "copyFiles">;
    };
    /**
     * Pass in a list of file options to customize cache control and content type specific files.
     *
     * @default
     * Versioned files cached for 1 year at the CDN and brower level.
     * Unversioned files cached for 1 year at the CDN level, but not at the browser level.
     * ```js
     * fileOptions: [
     *   {
     *     exclude: "*",
     *     include: "{versioned_directory}/*",
     *     cacheControl: "public,max-age=31536000,immutable",
     *   },
     *   {
     *     exclude: "*",
     *     include: "[{non_versioned_file1}, {non_versioned_file2}, ...]",
     *     cacheControl: "public,max-age=0,s-maxage=31536000,must-revalidate",
     *   },
     *   {
     *     exclude: "*",
     *     include: "[{non_versioned_dir_1}/*, {non_versioned_dir_2}/*, ...]",
     *     cacheControl: "public,max-age=0,s-maxage=31536000,must-revalidate",
     *   },
     * ]
     * ```
     *
     * @example
     * ```js
     * fileOptions: [
     *   {
     *     exclude: "*",
     *     include: "{versioned_directory}/*.css",
     *     cacheControl: "public,max-age=31536000,immutable",
     *     contentType: "text/css; charset=UTF-8",
     *   },
     *   {
     *     exclude: "*",
     *     include: "{versioned_directory}/*.js",
     *     cacheControl: "public,max-age=31536000,immutable",
     *   },
     *   {
     *     exclude: "*",
     *     include: "[{non_versioned_file1}, {non_versioned_file2}, ...]",
     *     cacheControl: "public,max-age=0,s-maxage=31536000,must-revalidate",
     *   },
     *   {
     *     exclude: "*",
     *     include: "[{non_versioned_dir_1}/*, {non_versioned_dir_2}/*, ...]",
     *     cacheControl: "public,max-age=0,s-maxage=31536000,must-revalidate",
     *   },
     * ]
     * ```
     */
    fileOptions?: SsrSiteFileOptions[];
}
type SsrSiteNormalizedProps = SsrSiteProps & {
    path: Exclude<SsrSiteProps["path"], undefined>;
    runtime: Exclude<SsrSiteProps["runtime"], undefined>;
    timeout: Exclude<SsrSiteProps["timeout"], undefined>;
    memorySize: Exclude<SsrSiteProps["memorySize"], undefined>;
    waitForInvalidation: Exclude<SsrSiteProps["waitForInvalidation"], undefined>;
};
/**
 * The `SsrSite` construct is a higher level CDK construct that makes it easy to create modern web apps with Server Side Rendering capabilities.
 * @example
 * Deploys an Astro app in the `web` directory.
 *
 * ```js
 * new SsrSite(stack, "site", {
 *   path: "web",
 * });
 * ```
 */
export declare abstract class SsrSite extends Construct implements SSTConstruct {
    readonly id: string;
    protected props: SsrSiteNormalizedProps;
    protected doNotDeploy: boolean;
    protected buildConfig: SsrBuildConfig;
    protected deferredTaskCallbacks: (() => void)[];
    protected serverLambdaForEdge?: EdgeFunction;
    protected serverLambdaForRegional?: SsrFunction;
    private serverLambdaForDev?;
    private serverUrlSigningFunction?;
    protected bucket: Bucket;
    private serverCfFunction?;
    private serverBehaviorCachePolicy?;
    private serverBehaviorOriginRequestPolicy?;
    private staticCfFunction?;
    private s3Origin;
    private distribution;
    constructor(scope: Construct, id: string, props?: SsrSiteProps);
    /**
     * The CloudFront URL of the website.
     */
    get url(): string | undefined;
    /**
     * If the custom domain is enabled, this is the URL of the website with the
     * custom domain.
     */
    get customDomainUrl(): string | undefined;
    /**
     * The internally created CDK resources.
     */
    get cdk(): {
        function: import("aws-cdk-lib/aws-lambda").IFunction | undefined;
        bucket: Bucket;
        distribution: import("aws-cdk-lib/aws-cloudfront").IDistribution;
        hostedZone: import("aws-cdk-lib/aws-route53").IHostedZone | undefined;
        certificate: import("aws-cdk-lib/aws-certificatemanager").ICertificate | undefined;
    } | undefined;
    /**
     * Attaches the given list of permissions to allow the server side
     * rendering framework to access other AWS resources.
     *
     * @example
     * ```js
     * site.attachPermissions(["sns"]);
     * ```
     */
    attachPermissions(permissions: Permissions): void;
    /** @internal */
    protected getConstructMetadataBase(): {
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
    };
    abstract getConstructMetadata(): ReturnType<SSTConstruct["getConstructMetadata"]>;
    /** @internal */
    getFunctionBinding(): FunctionBindingProps;
    protected initBuildConfig(): SsrBuildConfig;
    private buildApp;
    protected validateBuildOutput(): void;
    private runBuild;
    private createS3Assets;
    private createS3AssetFileOptions;
    private createS3Bucket;
    private createS3Deployment;
    protected createFunctionForRegional(): SsrFunction;
    protected createFunctionForEdge(): EdgeFunction;
    protected createFunctionForDev(): SsrFunction;
    private grantServerS3Permissions;
    private grantServerCloudFrontPermissions;
    private createWarmer;
    private createCloudFrontS3Origin;
    protected createCloudFrontDistributionForRegional(): Distribution;
    protected createCloudFrontDistributionForEdge(): Distribution;
    protected buildDefaultBehaviorForRegional(): BehaviorOptions;
    protected buildDefaultBehaviorForEdge(): BehaviorOptions;
    protected addStaticFileBehaviors(): void;
    protected useServerBehaviorFunctionAssociations(): {
        eventType: CfFunctionEventType;
        function: CfFunction;
    }[];
    protected useStaticBehaviorFunctionAssociations(): {
        eventType: CfFunctionEventType;
        function: CfFunction;
    }[];
    protected useServerUrlSigningFunction(): EdgeFunction;
    protected useServerBehaviorCachePolicy(allowedHeaders?: string[]): CachePolicy;
    private useServerBehaviorOriginRequestPolicy;
    private getS3ContentReplaceValues;
    private validateSiteExists;
    private validateTimeout;
    private writeTypesFile;
    protected generateBuildId(): string;
    protected supportsStreaming(): boolean;
}
export declare const useSites: () => {
    add(stack: string, name: string, type: string, props: SsrSiteNormalizedProps): void;
    readonly all: {
        stack: string;
        name: string;
        type: string;
        props: SsrSiteNormalizedProps;
    }[];
};
export {};
