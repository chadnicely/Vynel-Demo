// Test-only reach into the leaf's repository — lets a test park a row in a
// state provisioning would take minutes to reach (e.g. 'installed', so the
// Claude sign-in relay can be exercised). The ssh-servers/test-support
// precedent; never imported by product code.

export { insertServerInstall, updateServerInstall } from './repositories/index.js'
