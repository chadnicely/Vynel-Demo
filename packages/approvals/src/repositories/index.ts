// Repository barrel for the `approvals` domain — owned by `@vynel/approvals`
// (the vertical-slice shape: schema+repos live in the feature package, not the
// `@vynel/db` kernel). The domain's ops import their repos through this barrel
// (`./repositories/index.js`). structure-standard.md "Universal rules".
export * from './approval-requests.js'
export * from './approval-rules.js'
