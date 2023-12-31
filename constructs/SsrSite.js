import path from "path";
import url from "url";
import fs from "fs";
import glob from "glob";
import crypto from "crypto";
import spawn from "cross-spawn";
import { execSync } from "child_process";
import { Construct } from "constructs";
import { Fn, Token, Duration as CdkDuration, RemovalPolicy, CustomResource, } from "aws-cdk-lib/core";
import { BlockPublicAccess, Bucket, } from "aws-cdk-lib/aws-s3";
import { Effect, Role, Policy, PolicyStatement, AccountPrincipal, ServicePrincipal, CompositePrincipal, } from "aws-cdk-lib/aws-iam";
import { Function as CdkFunction, Code, Runtime, FunctionUrlAuthType, InvokeMode, } from "aws-cdk-lib/aws-lambda";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { ViewerProtocolPolicy, AllowedMethods, CachedMethods, LambdaEdgeEventType, CachePolicy, CacheQueryStringBehavior, CacheHeaderBehavior, CacheCookieBehavior, OriginRequestPolicy, Function as CfFunction, FunctionCode as CfFunctionCode, FunctionEventType as CfFunctionEventType, } from "aws-cdk-lib/aws-cloudfront";
import { AwsCliLayer } from "aws-cdk-lib/lambda-layer-awscli";
import { S3Origin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Stack } from "./Stack.js";
import { Distribution } from "./Distribution.js";
import { Logger } from "../logger.js";
import { createAppContext } from "./context.js";
import { isCDKConstruct } from "./Construct.js";
import { Secret } from "./Secret.js";
import { SsrFunction } from "./SsrFunction.js";
import { EdgeFunction } from "./EdgeFunction.js";
import { getBuildCmdEnvironment, } from "./BaseSite.js";
import { useDeferredTasks } from "./deferred_task.js";
import { toCdkDuration } from "./util/duration.js";
import { attachPermissionsToRole } from "./util/permission.js";
import { getParameterPath, } from "./util/functionBinding.js";
import { useProject } from "../project.js";
import { VisibleError } from "../error.js";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
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
export class SsrSite extends Construct {
    id;
    props;
    doNotDeploy;
    buildConfig;
    deferredTaskCallbacks = [];
    serverLambdaForEdge;
    serverLambdaForRegional;
    serverLambdaForDev;
    serverUrlSigningFunction;
    bucket;
    serverCfFunction;
    serverBehaviorCachePolicy;
    serverBehaviorOriginRequestPolicy;
    staticCfFunction;
    s3Origin;
    distribution;
    constructor(scope, id, props) {
        super(scope, props?.cdk?.id || id);
        const app = scope.node.root;
        const stack = Stack.of(this);
        this.id = id;
        this.props = {
            path: ".",
            waitForInvalidation: false,
            runtime: "nodejs18.x",
            timeout: "10 seconds",
            memorySize: "1024 MB",
            ...props,
        };
        this.doNotDeploy =
            !stack.isActive || (app.mode === "dev" && !this.props.dev?.deploy);
        this.buildConfig = this.initBuildConfig();
        this.validateSiteExists();
        this.validateTimeout();
        this.writeTypesFile();
        useSites().add(stack.stackName, id, this.constructor.name, this.props);
        if (this.doNotDeploy) {
            // @ts-expect-error
            this.bucket = this.s3Origin = this.distribution = null;
            this.serverLambdaForDev = this.createFunctionForDev();
            return;
        }
        // Create Bucket which will be utilised to contain the statics
        this.bucket = this.createS3Bucket();
        // Create Server functions
        if (this.props.edge) {
            this.serverLambdaForEdge = this.createFunctionForEdge();
        }
        else {
            this.serverLambdaForRegional = this.createFunctionForRegional();
        }
        this.grantServerS3Permissions();
        // Create CloudFront
        this.s3Origin = this.createCloudFrontS3Origin();
        this.distribution = this.props.edge
            ? this.createCloudFrontDistributionForEdge()
            : this.createCloudFrontDistributionForRegional();
        this.grantServerCloudFrontPermissions();
        useDeferredTasks().add(async () => {
            // Build app
            this.buildApp();
            // Build server functions
            await this.serverLambdaForEdge?.build();
            await this.serverLambdaForRegional?.build();
            await this.serverUrlSigningFunction?.build();
            // Create warmer
            // Note: create warmer after build app b/c the warmer code
            //       for NextjsSite depends on OpenNext build output
            this.createWarmer();
            // Create S3 Deployment
            const cliLayer = new AwsCliLayer(this, "AwsCliLayer");
            const assets = this.createS3Assets();
            const assetFileOptions = this.createS3AssetFileOptions();
            const s3deployCR = this.createS3Deployment(cliLayer, assets, assetFileOptions);
            this.distribution.node.addDependency(s3deployCR);
            // Add static file behaviors
            this.addStaticFileBehaviors();
            // Invalidate CloudFront
            this.distribution.createInvalidation(this.generateBuildId());
            for (const task of this.deferredTaskCallbacks) {
                await task();
            }
        });
    }
    /////////////////////
    // Public Properties
    /////////////////////
    /**
     * The CloudFront URL of the website.
     */
    get url() {
        if (this.doNotDeploy)
            return this.props.dev?.url;
        return this.distribution.url;
    }
    /**
     * If the custom domain is enabled, this is the URL of the website with the
     * custom domain.
     */
    get customDomainUrl() {
        if (this.doNotDeploy)
            return;
        return this.distribution.customDomainUrl;
    }
    /**
     * The internally created CDK resources.
     */
    get cdk() {
        if (this.doNotDeploy)
            return;
        return {
            function: this.serverLambdaForEdge?.function ||
                this.serverLambdaForRegional?.function,
            bucket: this.bucket,
            distribution: this.distribution.cdk.distribution,
            hostedZone: this.distribution.cdk.hostedZone,
            certificate: this.distribution.cdk.certificate,
        };
    }
    /////////////////////
    // Public Methods
    /////////////////////
    /**
     * Attaches the given list of permissions to allow the server side
     * rendering framework to access other AWS resources.
     *
     * @example
     * ```js
     * site.attachPermissions(["sns"]);
     * ```
     */
    attachPermissions(permissions) {
        const server = this.serverLambdaForEdge ||
            this.serverLambdaForRegional ||
            this.serverLambdaForDev;
        attachPermissionsToRole(server?.role, permissions);
    }
    /** @internal */
    getConstructMetadataBase() {
        return {
            data: {
                mode: this.doNotDeploy
                    ? "placeholder"
                    : "deployed",
                path: this.props.path,
                runtime: this.props.runtime,
                customDomainUrl: this.customDomainUrl,
                url: this.url,
                edge: this.props.edge,
                server: (this.serverLambdaForDev ||
                    this.serverLambdaForRegional ||
                    this.serverLambdaForEdge)?.functionArn,
                secrets: (this.props.bind || [])
                    .filter((c) => c instanceof Secret)
                    .map((c) => c.name),
            },
        };
    }
    /** @internal */
    getFunctionBinding() {
        const app = this.node.root;
        return {
            clientPackage: "site",
            variables: {
                url: this.doNotDeploy
                    ? {
                        type: "plain",
                        value: this.props.dev?.url ?? "localhost",
                    }
                    : {
                        // Do not set real value b/c we don't want to make the Lambda function
                        // depend on the Site. B/c often the site depends on the Api, causing
                        // a CloudFormation circular dependency if the Api and the Site belong
                        // to different stacks.
                        type: "site_url",
                        value: this.customDomainUrl || this.url,
                    },
            },
            permissions: {
                "ssm:GetParameters": [
                    `arn:${Stack.of(this).partition}:ssm:${app.region}:${app.account}:parameter${getParameterPath(this, "url")}`,
                ],
            },
        };
    }
    /////////////////////
    // Build App
    /////////////////////
    initBuildConfig() {
        return {
            typesPath: ".",
            serverBuildOutputFile: "placeholder",
            clientBuildOutputDir: "placeholder",
            clientBuildVersionedSubDir: "placeholder",
        };
    }
    buildApp() {
        const app = this.node.root;
        if (!app.isRunningSSTTest()) {
            this.runBuild();
        }
        this.validateBuildOutput();
    }
    validateBuildOutput() {
        const serverBuildFile = path.join(this.props.path, this.buildConfig.serverBuildOutputFile);
        if (!fs.existsSync(serverBuildFile)) {
            throw new Error(`No server build output found at "${serverBuildFile}"`);
        }
    }
    runBuild() {
        const { path: sitePath, buildCommand: rawBuildCommand, environment, } = this.props;
        const defaultCommand = "npm run build";
        const buildCommand = rawBuildCommand || defaultCommand;
        if (buildCommand === defaultCommand) {
            // Ensure that the site has a build script defined
            if (!fs.existsSync(path.join(sitePath, "package.json"))) {
                throw new Error(`No package.json found at "${sitePath}".`);
            }
            const packageJson = JSON.parse(fs.readFileSync(path.join(sitePath, "package.json")).toString());
            if (!packageJson.scripts || !packageJson.scripts.build) {
                throw new Error(`No "build" script found within package.json in "${sitePath}".`);
            }
        }
        // Run build
        Logger.debug(`Running "${buildCommand}" script`);
        try {
            execSync(buildCommand, {
                cwd: sitePath,
                stdio: "inherit",
                env: {
                    SST: "1",
                    ...process.env,
                    ...getBuildCmdEnvironment(environment),
                },
            });
        }
        catch (e) {
            throw new Error(`There was a problem building the "${this.node.id}" ${this.getConstructMetadata().type}.`);
        }
    }
    /////////////////////
    // Bundle S3 Assets
    /////////////////////
    createS3Assets() {
        // Create temp folder, clean up if exists
        const zipOutDir = path.resolve(path.join(useProject().paths.artifacts, `Site-${this.node.id}-${this.node.addr}`));
        fs.rmSync(zipOutDir, { recursive: true, force: true });
        // Create zip files
        const app = this.node.root;
        const script = path.resolve(__dirname, "../support/base-site-archiver.mjs");
        const fileSizeLimit = app.isRunningSSTTest()
            ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore: "sstTestFileSizeLimitOverride" not exposed in props
                this.props.sstTestFileSizeLimitOverride || 200
            : 200;
        const result = spawn.sync("node", [
            script,
            Buffer.from(JSON.stringify([
                {
                    src: path.join(this.props.path, this.buildConfig.clientBuildOutputDir),
                    tar: this.buildConfig.clientBuildS3KeyPrefix || "",
                },
                ...(this.buildConfig.prerenderedBuildOutputDir
                    ? [
                        {
                            src: path.join(this.props.path, this.buildConfig.prerenderedBuildOutputDir),
                            tar: this.buildConfig.prerenderedBuildS3KeyPrefix || "",
                        },
                    ]
                    : []),
            ])).toString("base64"),
            zipOutDir,
            `${fileSizeLimit}`,
        ], {
            stdio: "inherit",
        });
        if (result.status !== 0) {
            throw new Error(`There was a problem generating the assets package.`);
        }
        // Create S3 Assets for each zip file
        const assets = [];
        for (let partId = 0;; partId++) {
            const zipFilePath = path.join(zipOutDir, `part${partId}.zip`);
            if (!fs.existsSync(zipFilePath)) {
                break;
            }
            assets.push(new Asset(this, `Asset${partId}`, {
                path: zipFilePath,
            }));
        }
        return assets;
    }
    createS3AssetFileOptions() {
        if (this.props.fileOptions)
            return this.props.fileOptions;
        // Build file options
        const fileOptions = [];
        const clientPath = path.join(this.props.path, this.buildConfig.clientBuildOutputDir);
        for (const item of fs.readdirSync(clientPath)) {
            // Versioned files will be cached for 1 year (immutable) both at
            // the CDN and browser level.
            if (item === this.buildConfig.clientBuildVersionedSubDir) {
                fileOptions.push({
                    exclude: "*",
                    include: path.posix.join(this.buildConfig.clientBuildS3KeyPrefix ?? "", this.buildConfig.clientBuildVersionedSubDir, "*"),
                    cacheControl: "public,max-age=31536000,immutable",
                });
            }
            // Un-versioned files will be cached for 1 year at the CDN level.
            // But not at the browser level. CDN cache will be invalidated on deploy.
            else {
                const itemPath = path.join(clientPath, item);
                fileOptions.push({
                    exclude: "*",
                    include: path.posix.join(this.buildConfig.clientBuildS3KeyPrefix ?? "", item, fs.statSync(itemPath).isDirectory() ? "*" : ""),
                    cacheControl: "public,max-age=0,s-maxage=31536000,must-revalidate",
                });
            }
        }
        return fileOptions;
    }
    createS3Bucket() {
        const { cdk } = this.props;
        // cdk.bucket is an imported construct
        if (cdk?.bucket && isCDKConstruct(cdk?.bucket)) {
            return cdk.bucket;
        }
        // cdk.bucket is a prop
        return new Bucket(this, "S3Bucket", {
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
            enforceSSL: true,
            ...cdk?.bucket,
        });
    }
    createS3Deployment(cliLayer, assets, fileOptions) {
        // Create a Lambda function that will be doing the uploading
        const uploader = new CdkFunction(this, "S3Uploader", {
            code: Code.fromAsset(path.join(__dirname, "../support/base-site-custom-resource")),
            layers: [cliLayer],
            runtime: Runtime.PYTHON_3_11,
            handler: "s3-upload.handler",
            timeout: CdkDuration.minutes(15),
            memorySize: 1024,
        });
        this.bucket.grantReadWrite(uploader);
        assets.forEach((asset) => asset.grantRead(uploader));
        // Create the custom resource function
        const handler = new CdkFunction(this, "S3Handler", {
            code: Code.fromAsset(path.join(__dirname, "../support/base-site-custom-resource")),
            layers: [cliLayer],
            runtime: Runtime.PYTHON_3_11,
            handler: "s3-handler.handler",
            timeout: CdkDuration.minutes(15),
            memorySize: 1024,
            environment: {
                UPLOADER_FUNCTION_NAME: uploader.functionName,
            },
        });
        this.bucket.grantReadWrite(handler);
        uploader.grantInvoke(handler);
        // Create custom resource
        return new CustomResource(this, "S3Deployment", {
            serviceToken: handler.functionArn,
            resourceType: "Custom::SSTBucketDeployment",
            properties: {
                Sources: assets.map((asset) => ({
                    BucketName: asset.s3BucketName,
                    ObjectKey: asset.s3ObjectKey,
                })),
                DestinationBucketName: this.bucket.bucketName,
                FileOptions: (fileOptions || []).map(({ exclude, include, cacheControl, contentType }) => {
                    if (typeof exclude === "string") {
                        exclude = [exclude];
                    }
                    if (typeof include === "string") {
                        include = [include];
                    }
                    return [
                        ...exclude.map((per) => ["--exclude", per]),
                        ...include.map((per) => ["--include", per]),
                        ["--cache-control", cacheControl],
                        contentType ? ["--content-type", contentType] : [],
                    ].flat();
                }),
                ReplaceValues: this.getS3ContentReplaceValues(),
            },
        });
    }
    /////////////////////
    // Bundle Lambda Server
    /////////////////////
    createFunctionForRegional() {
        return {};
    }
    createFunctionForEdge() {
        return {};
    }
    createFunctionForDev() {
        const { runtime, timeout, memorySize, permissions, environment, bind } = this.props;
        const app = this.node.root;
        const role = new Role(this, "ServerFunctionRole", {
            assumedBy: new CompositePrincipal(new AccountPrincipal(app.account), new ServicePrincipal("lambda.amazonaws.com")),
            maxSessionDuration: CdkDuration.hours(12),
        });
        const ssrFn = new SsrFunction(this, `ServerFunction`, {
            description: "Server handler placeholder",
            bundle: path.join(__dirname, "../support/ssr-site-function-stub"),
            handler: "index.handler",
            runtime,
            memorySize,
            timeout,
            role,
            bind,
            environment,
            permissions,
            // note: do not need to set vpc settings b/c this function is not being used
        });
        useDeferredTasks().add(async () => {
            await ssrFn.build();
        });
        return ssrFn;
    }
    grantServerS3Permissions() {
        const server = this.serverLambdaForEdge || this.serverLambdaForRegional;
        this.bucket.grantReadWrite(server.role);
    }
    grantServerCloudFrontPermissions() {
        const stack = Stack.of(this);
        const server = this.serverLambdaForEdge || this.serverLambdaForRegional;
        const policy = new Policy(this, "ServerFunctionInvalidatorPolicy", {
            statements: [
                new PolicyStatement({
                    actions: ["cloudfront:CreateInvalidation"],
                    resources: [
                        `arn:${stack.partition}:cloudfront::${stack.account}:distribution/${this.distribution.cdk.distribution.distributionId}`,
                    ],
                }),
            ],
        });
        server?.role?.attachInlinePolicy(policy);
    }
    createWarmer() {
        const { warm, edge } = this.props;
        if (!warm)
            return;
        if (warm && edge) {
            throw new VisibleError(`In the "${this.node.id}" Site, warming is currently supported only for the regional mode.`);
        }
        if (!this.serverLambdaForRegional)
            return;
        // Create warmer function
        const warmer = new CdkFunction(this, "WarmerFunction", {
            description: "Next.js warmer",
            code: Code.fromAsset(this.buildConfig.warmerFunctionAssetPath ??
                path.join(__dirname, "../support/ssr-warmer")),
            runtime: Runtime.NODEJS_18_X,
            handler: "index.handler",
            timeout: CdkDuration.minutes(15),
            memorySize: 1024,
            environment: {
                FUNCTION_NAME: this.serverLambdaForRegional.functionName,
                CONCURRENCY: warm.toString(),
            },
        });
        this.serverLambdaForRegional.grantInvoke(warmer);
        // Create cron job
        new Rule(this, "WarmerRule", {
            schedule: Schedule.rate(CdkDuration.minutes(5)),
            targets: [new LambdaFunction(warmer, { retryAttempts: 0 })],
        });
        // Create custom resource to prewarm on deploy
        const stack = Stack.of(this);
        const policy = new Policy(this, "PrewarmerPolicy", {
            statements: [
                new PolicyStatement({
                    effect: Effect.ALLOW,
                    actions: ["lambda:InvokeFunction"],
                    resources: [warmer.functionArn],
                }),
            ],
        });
        stack.customResourceHandler.role?.attachInlinePolicy(policy);
        const resource = new CustomResource(this, "Prewarmer", {
            serviceToken: stack.customResourceHandler.functionArn,
            resourceType: "Custom::FunctionInvoker",
            properties: {
                version: Date.now().toString(),
                functionName: warmer.functionName,
            },
        });
        resource.node.addDependency(policy);
    }
    /////////////////////
    // CloudFront Distribution
    /////////////////////
    createCloudFrontS3Origin() {
        return new S3Origin(this.bucket, {
            originPath: "/" + (this.buildConfig.clientBuildS3KeyPrefix ?? ""),
        });
    }
    createCloudFrontDistributionForRegional() {
        const { customDomain, cdk } = this.props;
        const cfDistributionProps = cdk?.distribution || {};
        return new Distribution(this, "CDN", {
            scopeOverride: this,
            customDomain,
            cdk: {
                distribution: {
                    // these values can be overwritten by cfDistributionProps
                    defaultRootObject: "",
                    // Override props.
                    ...cfDistributionProps,
                    // these values can NOT be overwritten by cfDistributionProps
                    defaultBehavior: this.buildDefaultBehaviorForRegional(),
                    additionalBehaviors: {
                        ...(cfDistributionProps.additionalBehaviors || {}),
                    },
                },
            },
        });
    }
    createCloudFrontDistributionForEdge() {
        const { customDomain, cdk } = this.props;
        const cfDistributionProps = cdk?.distribution || {};
        return new Distribution(this, "CDN", {
            scopeOverride: this,
            customDomain,
            cdk: {
                distribution: {
                    // these values can be overwritten by cfDistributionProps
                    defaultRootObject: "",
                    // Override props.
                    ...cfDistributionProps,
                    // these values can NOT be overwritten by cfDistributionProps
                    defaultBehavior: this.buildDefaultBehaviorForEdge(),
                    additionalBehaviors: {
                        ...(cfDistributionProps.additionalBehaviors || {}),
                    },
                },
            },
        });
    }
    buildDefaultBehaviorForRegional() {
        const { timeout, regional, cdk } = this.props;
        const cfDistributionProps = cdk?.distribution || {};
        const fnUrl = this.serverLambdaForRegional.addFunctionUrl({
            authType: regional?.enableServerUrlIamAuth
                ? FunctionUrlAuthType.AWS_IAM
                : FunctionUrlAuthType.NONE,
            invokeMode: this.supportsStreaming()
                ? InvokeMode.RESPONSE_STREAM
                : undefined,
        });
        return {
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            origin: new HttpOrigin(Fn.parseDomainName(fnUrl.url), {
                readTimeout: typeof timeout === "string"
                    ? toCdkDuration(timeout)
                    : CdkDuration.seconds(timeout),
            }),
            allowedMethods: AllowedMethods.ALLOW_ALL,
            cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
            compress: true,
            cachePolicy: cdk?.serverCachePolicy ?? this.useServerBehaviorCachePolicy(),
            responseHeadersPolicy: cdk?.responseHeadersPolicy,
            originRequestPolicy: this.useServerBehaviorOriginRequestPolicy(),
            ...(cfDistributionProps.defaultBehavior || {}),
            functionAssociations: [
                ...this.useServerBehaviorFunctionAssociations(),
                ...(cfDistributionProps.defaultBehavior?.functionAssociations || []),
            ],
            edgeLambdas: [
                ...(regional?.enableServerUrlIamAuth
                    ? [
                        {
                            includeBody: true,
                            eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                            functionVersion: this.useServerUrlSigningFunction().currentVersion,
                        },
                    ]
                    : []),
                ...(cfDistributionProps.defaultBehavior?.edgeLambdas || []),
            ],
        };
    }
    buildDefaultBehaviorForEdge() {
        const { cdk } = this.props;
        const cfDistributionProps = cdk?.distribution || {};
        return {
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            origin: this.s3Origin,
            allowedMethods: AllowedMethods.ALLOW_ALL,
            cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
            compress: true,
            cachePolicy: cdk?.serverCachePolicy ?? this.useServerBehaviorCachePolicy(),
            responseHeadersPolicy: cdk?.responseHeadersPolicy,
            originRequestPolicy: this.useServerBehaviorOriginRequestPolicy(),
            ...(cfDistributionProps.defaultBehavior || {}),
            functionAssociations: [
                ...this.useServerBehaviorFunctionAssociations(),
                ...(cfDistributionProps.defaultBehavior?.functionAssociations || []),
            ],
            edgeLambdas: [
                {
                    includeBody: true,
                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                    functionVersion: this.serverLambdaForEdge.currentVersion,
                },
                ...(cfDistributionProps.defaultBehavior?.edgeLambdas || []),
            ],
        };
    }
    addStaticFileBehaviors() {
        const { cdk } = this.props;
        // Create a template for statics behaviours
        const publicDir = path.join(this.props.path, this.buildConfig.clientBuildOutputDir);
        for (const item of fs.readdirSync(publicDir)) {
            const isDir = fs.statSync(path.join(publicDir, item)).isDirectory();
            this.distribution.cdk.distribution.addBehavior(isDir ? `${item}/*` : item, this.s3Origin, {
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
                compress: true,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                responseHeadersPolicy: cdk?.responseHeadersPolicy,
                functionAssociations: [
                    ...this.useStaticBehaviorFunctionAssociations(),
                ],
            });
        }
    }
    useServerBehaviorFunctionAssociations() {
        this.serverCfFunction =
            this.serverCfFunction ??
                new CfFunction(this, "CloudFrontFunction", {
                    code: CfFunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.headers["x-forwarded-host"] = request.headers.host;
  ${this.buildConfig.serverCFFunctionInjection || ""}
  return request;
}`),
                });
        return [
            {
                eventType: CfFunctionEventType.VIEWER_REQUEST,
                function: this.serverCfFunction,
            },
        ];
    }
    useStaticBehaviorFunctionAssociations() {
        if (!this.buildConfig.clientCFFunctionInjection)
            return [];
        this.staticCfFunction =
            this.staticCfFunction ??
                new CfFunction(this, "CloudFrontFunctionForStaticBehavior", {
                    code: CfFunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  ${this.buildConfig.clientCFFunctionInjection || ""}
  return request;
}`),
                });
        return [
            {
                eventType: CfFunctionEventType.VIEWER_REQUEST,
                function: this.staticCfFunction,
            },
        ];
    }
    useServerUrlSigningFunction() {
        this.serverUrlSigningFunction =
            this.serverUrlSigningFunction ??
                new EdgeFunction(this, "ServerUrlSigningFunction", {
                    bundle: path.join(__dirname, "../support/signing-function"),
                    runtime: "nodejs18.x",
                    handler: "index.handler",
                    timeout: 10,
                    memorySize: 128,
                    permissions: [
                        new PolicyStatement({
                            actions: ["lambda:InvokeFunctionUrl"],
                            resources: [this.serverLambdaForRegional?.functionArn],
                        }),
                    ],
                });
        return this.serverUrlSigningFunction;
    }
    useServerBehaviorCachePolicy(allowedHeaders) {
        this.serverBehaviorCachePolicy =
            this.serverBehaviorCachePolicy ??
                new CachePolicy(this, "ServerCache", {
                    queryStringBehavior: CacheQueryStringBehavior.all(),
                    headerBehavior: allowedHeaders && allowedHeaders.length > 0
                        ? CacheHeaderBehavior.allowList(...allowedHeaders)
                        : CacheHeaderBehavior.none(),
                    cookieBehavior: CacheCookieBehavior.none(),
                    defaultTtl: CdkDuration.days(0),
                    maxTtl: CdkDuration.days(365),
                    minTtl: CdkDuration.days(0),
                    enableAcceptEncodingBrotli: true,
                    enableAcceptEncodingGzip: true,
                    comment: "SST server response cache policy",
                });
        return this.serverBehaviorCachePolicy;
    }
    useServerBehaviorOriginRequestPolicy() {
        // CloudFront's Managed-AllViewerExceptHostHeader policy
        this.serverBehaviorOriginRequestPolicy =
            this.serverBehaviorOriginRequestPolicy ??
                OriginRequestPolicy.fromOriginRequestPolicyId(this, "ServerOriginRequestPolicy", "b689b0a8-53d0-40ab-baf2-68738e2966ac");
        return this.serverBehaviorOriginRequestPolicy;
    }
    /////////////////////
    // Helper Functions
    /////////////////////
    getS3ContentReplaceValues() {
        const replaceValues = [];
        Object.entries(this.props.environment || {})
            .filter(([, value]) => Token.isUnresolved(value))
            .forEach(([key, value]) => {
            const token = `{{ ${key} }}`;
            replaceValues.push({
                files: "**/*.html",
                search: token,
                replace: value,
            }, {
                files: "**/*.js",
                search: token,
                replace: value,
            }, {
                files: "**/*.json",
                search: token,
                replace: value,
            });
        });
        return replaceValues;
    }
    validateSiteExists() {
        const { path: sitePath } = this.props;
        if (!fs.existsSync(sitePath)) {
            throw new Error(`No site found at "${path.resolve(sitePath)}"`);
        }
    }
    validateTimeout() {
        const { edge, timeout } = this.props;
        const num = typeof timeout === "number"
            ? timeout
            : toCdkDuration(timeout).toSeconds();
        const limit = edge ? 30 : 180;
        if (num > limit) {
            throw new Error(edge
                ? `Timeout must be less than or equal to 30 seconds when the "edge" flag is enabled.`
                : `Timeout must be less than or equal to 180 seconds.`);
        }
    }
    writeTypesFile() {
        const typesPath = path.resolve(this.props.path, this.buildConfig.typesPath, "sst-env.d.ts");
        // Do not override the types file if it already exists
        if (fs.existsSync(typesPath))
            return;
        const relPathToSstTypesFile = path.join(path.relative(path.dirname(typesPath), useProject().paths.root), ".sst/types/index.ts");
        fs.writeFileSync(typesPath, `/// <reference path="${relPathToSstTypesFile}" />`);
    }
    generateBuildId() {
        // We will generate a hash based on the contents of the "public" folder
        // which will be used to indicate if we need to invalidate our CloudFront
        // cache.
        // The below options are needed to support following symlinks when building zip files:
        // - nodir: This will prevent symlinks themselves from being copied into the zip.
        // - follow: This will follow symlinks and copy the files within.
        const globOptions = {
            dot: true,
            nodir: true,
            follow: true,
            cwd: path.resolve(this.props.path, this.buildConfig.clientBuildOutputDir),
        };
        const files = glob.sync("**", globOptions);
        const hash = crypto.createHash("sha1");
        for (const file of files) {
            hash.update(file);
        }
        const buildId = hash.digest("hex");
        Logger.debug(`Generated build ID ${buildId}`);
        return buildId;
    }
    supportsStreaming() {
        return false;
    }
}
export const useSites = createAppContext(() => {
    const sites = [];
    return {
        add(stack, name, type, props) {
            sites.push({ stack, name, type, props });
        },
        get all() {
            return sites;
        },
    };
});
