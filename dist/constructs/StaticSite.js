import path from "path";
import url from "url";
import fs from "fs";
import crypto from "crypto";
import { execSync } from "child_process";
import { Construct } from "constructs";
import { Token, Duration, RemovalPolicy, CustomResource, } from "aws-cdk-lib/core";
import { BlockPublicAccess, Bucket, } from "aws-cdk-lib/aws-s3";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Function as CfFunction, FunctionCode as CfFunctionCode, FunctionEventType as CfFunctionEventType, ViewerProtocolPolicy, } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { AwsCliLayer } from "aws-cdk-lib/lambda-layer-awscli";
import { Stack } from "./Stack.js";
import { Distribution } from "./Distribution.js";
import { getBuildCmdEnvironment, buildErrorResponsesFor404ErrorPage, buildErrorResponsesForRedirectToIndex, } from "./BaseSite.js";
import { useDeferredTasks } from "./deferred_task.js";
import { isCDKConstruct } from "./Construct.js";
import { getParameterPath, } from "./util/functionBinding.js";
import { gray } from "colorette";
import { useProject } from "../project.js";
import { createAppContext } from "./context.js";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
/**
 * The `StaticSite` construct is a higher level CDK construct that makes it easy to create a static website.
 *
 * @example
 *
 * Deploys a plain HTML website in the `path/to/src` directory.
 *
 * ```js
 * import { StaticSite } from "sst/constructs";
 *
 * new StaticSite(stack, "Site", {
 *   path: "path/to/src",
 * });
 * ```
 */
export class StaticSite extends Construct {
    id;
    props;
    doNotDeploy;
    bucket;
    distribution;
    constructor(scope, id, props) {
        super(scope, props?.cdk?.id || id);
        const app = scope.node.root;
        const stack = Stack.of(this);
        this.id = id;
        this.props = {
            path: ".",
            waitForInvalidation: false,
            ...props,
        };
        this.doNotDeploy =
            !stack.isActive || (app.mode === "dev" && !this.props.dev?.deploy);
        this.generateViteTypes();
        useSites().add(stack.stackName, id, this.props);
        if (this.doNotDeploy) {
            // @ts-ignore
            this.bucket = this.distribution = null;
            return;
        }
        this.bucket = this.createS3Bucket();
        this.distribution = this.createCfDistribution();
        useDeferredTasks().add(async () => {
            // Build app
            this.buildApp();
            // Create S3 Deployment
            const cliLayer = new AwsCliLayer(this, "AwsCliLayer");
            const assets = this.createS3Assets();
            const filenamesAsset = this.bundleFilenamesAsset();
            const s3deployCR = this.createS3Deployment(cliLayer, assets, filenamesAsset);
            this.distribution.node.addDependency(s3deployCR);
            // Invalidate CloudFront
            this.distribution.createInvalidation(this.generateInvalidationId(assets));
        });
    }
    /**
     * The CloudFront URL of the website.
     */
    get url() {
        if (this.doNotDeploy)
            return this.props.dev?.url;
        return this.distribution.url;
    }
    /**
     * If the custom domain is enabled, this is the URL of the website with the custom domain.
     */
    get customDomainUrl() {
        if (this.doNotDeploy)
            return;
        const { customDomain } = this.props;
        if (!customDomain)
            return;
        if (typeof customDomain === "string") {
            return `https://${customDomain}`;
        }
        else {
            return `https://${customDomain.domainName}`;
        }
    }
    /**
     * The internally created CDK resources.
     */
    get cdk() {
        if (this.doNotDeploy)
            return;
        return {
            bucket: this.bucket,
            distribution: this.distribution.cdk.distribution,
            hostedZone: this.distribution.cdk.hostedZone,
            certificate: this.distribution.cdk.certificate,
        };
    }
    getConstructMetadata() {
        return {
            type: "StaticSite",
            data: {
                path: this.props.path,
                environment: this.props.environment || {},
                customDomainUrl: this.customDomainUrl,
                url: this.url,
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
    generateViteTypes() {
        const { path: sitePath, environment } = this.props;
        // Build the path
        let typesPath = this.props.vite?.types;
        if (!typesPath) {
            if (fs.existsSync(path.join(sitePath, "vite.config.js")) ||
                fs.existsSync(path.join(sitePath, "vite.config.ts"))) {
                typesPath = "src/sst-env.d.ts";
            }
        }
        if (!typesPath) {
            return;
        }
        // Create type file
        const filePath = path.resolve(path.join(sitePath, typesPath));
        const content = `/// <reference types="vite/client" />
interface ImportMetaEnv {
${Object.keys(environment || {})
            .map((key) => `  readonly ${key}: string`)
            .join("\n")}
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}`;
        const fileDir = path.dirname(filePath);
        fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(filePath, content);
    }
    buildApp() {
        const { path: sitePath, buildCommand } = this.props;
        // validate site path exists
        if (!fs.existsSync(sitePath)) {
            throw new Error(`No path found at "${path.resolve(sitePath)}" for the "${this.node.id}" StaticSite.`);
        }
        // build
        if (buildCommand) {
            try {
                console.log(gray(`Building static site ${sitePath}`));
                execSync(buildCommand, {
                    cwd: sitePath,
                    stdio: "inherit",
                    env: {
                        ...process.env,
                        ...getBuildCmdEnvironment(this.props.environment),
                    },
                });
            }
            catch (e) {
                throw new Error(`There was a problem building the "${this.node.id}" StaticSite.`);
            }
        }
    }
    createS3Assets() {
        const { path: sitePath } = this.props;
        const buildOutput = this.props.buildOutput || ".";
        // validate buildOutput exists
        const siteOutputPath = path.resolve(path.join(sitePath, buildOutput));
        if (!fs.existsSync(siteOutputPath)) {
            throw new Error(`No build output found at "${siteOutputPath}" for the "${this.node.id}" StaticSite.`);
        }
        // clear zip path to ensure no partX.zip remain from previous build
        const zipPath = path.resolve(path.join(useProject().paths.artifacts, `StaticSite-${this.node.id}-${this.node.addr}`));
        fs.rmSync(zipPath, {
            force: true,
            recursive: true,
        });
        // create zip files
        const app = this.node.root;
        const script = path.join(__dirname, "../support/base-site-archiver.mjs");
        const fileSizeLimit = app.isRunningSSTTest()
            ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore: "sstTestFileSizeLimitOverride" not exposed in props
                this.props.sstTestFileSizeLimitOverride || 200
            : 200;
        const cmd = [
            "node",
            script,
            Buffer.from(JSON.stringify([{ src: siteOutputPath, tar: "" }])).toString("base64"),
            zipPath,
            fileSizeLimit,
        ].join(" ");
        try {
            execSync(cmd, {
                cwd: sitePath,
                stdio: "inherit",
            });
        }
        catch (e) {
            throw new Error(`There was a problem generating the "${this.node.id}" StaticSite package.`);
        }
        // create assets
        const assets = [];
        for (let partId = 0;; partId++) {
            const zipFilePath = path.join(zipPath, `part${partId}.zip`);
            if (!fs.existsSync(zipFilePath)) {
                break;
            }
            assets.push(new Asset(this, `Asset${partId}`, {
                path: zipFilePath,
            }));
        }
        return assets;
    }
    bundleFilenamesAsset() {
        if (this.props.purgeFiles === false) {
            return;
        }
        const zipPath = path.resolve(path.join(useProject().paths.artifacts, `StaticSite-${this.node.id}-${this.node.addr}`));
        // create assets
        const filenamesPath = path.join(zipPath, `filenames`);
        if (!fs.existsSync(filenamesPath)) {
            throw new Error(`There was a problem generating the "${this.node.id}" StaticSite package.`);
        }
        return new Asset(this, `AssetFilenames`, {
            path: filenamesPath,
        });
    }
    createS3Bucket() {
        const { cdk } = this.props;
        // cdk.bucket is an imported construct
        if (cdk?.bucket && isCDKConstruct(cdk?.bucket)) {
            return cdk.bucket;
        }
        // cdk.bucket is a prop
        else {
            const bucketProps = cdk?.bucket;
            // Validate s3Bucket
            if (bucketProps?.websiteIndexDocument) {
                throw new Error(`Do not configure the "s3Bucket.websiteIndexDocument". Use the "indexPage" to configure the StaticSite index page.`);
            }
            if (bucketProps?.websiteErrorDocument) {
                throw new Error(`Do not configure the "s3Bucket.websiteErrorDocument". Use the "errorPage" to configure the StaticSite index page.`);
            }
            return new Bucket(this, "S3Bucket", {
                publicReadAccess: false,
                blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
                autoDeleteObjects: true,
                removalPolicy: RemovalPolicy.DESTROY,
                ...bucketProps,
            });
        }
    }
    createS3Deployment(cliLayer, assets, filenamesAsset) {
        const fileOptions = this.props.fileOptions || [
            {
                exclude: "*",
                include: "*.html",
                cacheControl: "max-age=0,no-cache,no-store,must-revalidate",
            },
            {
                exclude: "*",
                include: ["*.js", "*.css"],
                cacheControl: "max-age=31536000,public,immutable",
            },
        ];
        // Create a Lambda function that will be doing the uploading
        const uploader = new Function(this, "S3Uploader", {
            code: Code.fromAsset(path.join(__dirname, "../support/base-site-custom-resource")),
            layers: [cliLayer],
            runtime: Runtime.PYTHON_3_11,
            handler: "s3-upload.handler",
            timeout: Duration.minutes(15),
            memorySize: 1024,
        });
        this.bucket.grantReadWrite(uploader);
        assets.forEach((asset) => asset.grantRead(uploader));
        // Create the custom resource function
        const handler = new Function(this, "S3Handler", {
            code: Code.fromAsset(path.join(__dirname, "../support/base-site-custom-resource")),
            layers: [cliLayer],
            runtime: Runtime.PYTHON_3_11,
            handler: "s3-handler.handler",
            timeout: Duration.minutes(15),
            memorySize: 1024,
            environment: {
                UPLOADER_FUNCTION_NAME: uploader.functionName,
            },
        });
        this.bucket.grantReadWrite(handler);
        filenamesAsset?.grantRead(handler);
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
                Filenames: filenamesAsset && {
                    BucketName: filenamesAsset.s3BucketName,
                    ObjectKey: filenamesAsset.s3ObjectKey,
                },
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
    // CloudFront Distribution
    /////////////////////
    createCfDistribution() {
        const { errorPage, customDomain, cdk } = this.props;
        const indexPage = this.props.indexPage || "index.html";
        return new Distribution(this, "CDN", {
            scopeOverride: this,
            customDomain,
            cdk: {
                distribution: cdk?.distribution && isCDKConstruct(cdk.distribution)
                    ? cdk.distribution
                    : {
                        // these values can be overwritten by cfDistributionProps
                        defaultRootObject: indexPage,
                        errorResponses: !errorPage || errorPage === "redirect_to_index_page"
                            ? buildErrorResponsesForRedirectToIndex(indexPage)
                            : buildErrorResponsesFor404ErrorPage(errorPage),
                        ...cdk?.distribution,
                        // these values can NOT be overwritten by cfDistributionProps
                        defaultBehavior: this.buildDistributionBehavior(),
                    },
            },
        });
    }
    generateInvalidationId(assets) {
        const stack = Stack.of(this);
        // Need the AssetHash field so the CR gets updated on each deploy
        return crypto
            .createHash("md5")
            .update(assets.map(({ assetHash }) => assetHash).join(""))
            .digest("hex");
    }
    buildDistributionBehavior() {
        const { cdk } = this.props;
        return {
            origin: new S3Origin(this.bucket),
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            functionAssociations: [
                {
                    // Note: this is required in Frameworks like Astro where `index.html`
                    //       is required in the URL path.
                    //       https://docs.astro.build/en/guides/deploy/aws/#cloudfront-functions-setup
                    function: new CfFunction(this, "CloudFrontFunction", {
                        code: CfFunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  if (uri.startsWith("/.well-known/")) {
    return request;
  }

  if (uri.endsWith("/")) {
    request.uri += "index.html";
  } else if (!uri.split("/").pop().includes(".")) {
    request.uri += ".html";
  }

  return request;
}
          `),
                    }),
                    eventType: CfFunctionEventType.VIEWER_REQUEST,
                },
            ],
            ...cdk?.distribution?.defaultBehavior,
        };
    }
    /////////////////////
    // Helper Functions
    /////////////////////
    getS3ContentReplaceValues() {
        const replaceValues = this.props.replaceValues || [];
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
            });
        });
        return replaceValues;
    }
}
export const useSites = createAppContext(() => {
    const sites = [];
    return {
        add(stack, name, props) {
            sites.push({ stack, name, props });
        },
        get all() {
            return sites;
        },
    };
});
