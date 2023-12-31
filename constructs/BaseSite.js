import { Token } from "aws-cdk-lib/core";
export function buildErrorResponsesForRedirectToIndex(indexPage) {
    return [
        {
            httpStatus: 403,
            responsePagePath: `/${indexPage}`,
            responseHttpStatus: 200,
        },
        {
            httpStatus: 404,
            responsePagePath: `/${indexPage}`,
            responseHttpStatus: 200,
        },
    ];
}
export function buildErrorResponsesFor404ErrorPage(errorPage) {
    return [
        {
            httpStatus: 403,
            responsePagePath: `/${errorPage}`,
        },
        {
            httpStatus: 404,
            responsePagePath: `/${errorPage}`,
        },
    ];
}
/////////////////////
// Helper Functions
/////////////////////
export function getBuildCmdEnvironment(siteEnvironment) {
    // Generate environment placeholders to be replaced
    // ie. environment => { API_URL: api.url }
    //     environment => API_URL="{{ API_URL }}"
    //
    const buildCmdEnvironment = {};
    Object.entries(siteEnvironment || {}).forEach(([key, value]) => {
        buildCmdEnvironment[key] = Token.isUnresolved(value)
            ? `{{ ${key} }}`
            : value;
    });
    return buildCmdEnvironment;
}
