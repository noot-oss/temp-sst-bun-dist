import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
/**
 * Properties to configure an HTTPS Redirect
 */
export interface HttpsRedirectProps {
    /**
     * Hosted zone of the domain which will be used to create alias record(s) from
     * domain names in the hosted zone to the target domain. The hosted zone must
     * contain entries for the domain name(s) supplied through `recordNames` that
     * will redirect to the target domain.
     *
     * Domain names in the hosted zone can include a specific domain (example.com)
     * and its subdomains (acme.example.com, zenith.example.com).
     *
     */
    readonly zone: IHostedZone;
    /**
     * The redirect target fully qualified domain name (FQDN). An alias record
     * will be created that points to your CloudFront distribution. Root domain
     * or sub-domain can be supplied.
     */
    readonly targetDomain: string;
    /**
     * The domain names that will redirect to `targetDomain`
     *
     * @default - the domain name of the hosted zone
     */
    readonly recordNames?: string[];
    /**
     * The AWS Certificate Manager (ACM) certificate that will be associated with
     * the CloudFront distribution that will be created. If provided, the certificate must be
     * stored in us-east-1 (N. Virginia)
     *
     * @default - A new certificate is created in us-east-1 (N. Virginia)
     */
    readonly certificate?: ICertificate;
}
/**
 * Allows creating a domainA -> domainB redirect using CloudFront and S3.
 * You can specify multiple domains to be redirected.
 */
export declare class HttpsRedirect extends Construct {
    constructor(scope: Construct, id: string, props: HttpsRedirectProps);
    /**
     * Creates a certificate.
     *
     * This is also safe to upgrade since the new certificate will be created and updated
     * on the CloudFront distribution before the old one is deleted.
     */
    private createCertificate;
}
