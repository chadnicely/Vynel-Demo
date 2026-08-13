# Signing the Vynel Call Audio driver

Two signatures, two purposes. This directory is the **local** one — what we use
to build, load (in a VM), and test the driver ourselves right now. Public
distribution to the community is a **separate, later** signature (see below).

## Now: our own local test signature

A Windows kernel driver won't load unsigned. For our own test loop we sign with
**Vynel's own self-signed certificate** — no Partner Center, no cost, fully
reproducible:

```powershell
# 1. Once per build machine — create the Vynel test cert (private key stays in
#    your cert store; exports the public VynelDriverTest.cer).
powershell -ExecutionPolicy Bypass -File sign\New-VynelTestCert.ps1

# 2. After each build — stamp a fixed date, build the catalog, sign + verify.
#    Run inside the EWDK env (so the kit tools are found), or pass -KitBin.
powershell -ExecutionPolicy Bypass -File sign\Sign-Driver.ps1
```

`Sign-Driver.ps1` stamps a **fixed past `DriverVer`** so catalog generation
never trips the "postdated DriverVer" check that the WDK's auto-"today" stamp
hits when the build clock runs ahead of UTC. It then signs `VynelCallAudio.sys`
and `vynelcallaudio.cat` with the cert and confirms the signer is ours.

Verifying on the build box reports **"untrusted root" — that's correct**: a
self-signed cert is deliberately not trusted here. Only a VM that imports
`VynelDriverTest.cer` (per `../LOADING.md`) trusts it, and only with
test-signing mode on. **Test-signed drivers never load on a normal machine** —
that's the safety line, and the reason this can't be shipped to users.

The cert is **per build machine**: `New-VynelTestCert.ps1` generates a distinct
keypair on each machine, and `VynelDriverTest.cer` (the public half) is a build
artifact, gitignored — it travels with the signed package to the VM, it is not
source. Sharing one team-wide signature would mean sharing a private key, which
we do not commit.

## Later: attestation signing for the community

Distributing to users needs the driver **attestation-signed** through the
Microsoft Partner Center (an EV certificate is required on the account).
Cross-signing lost default trust in April 2026, so attestation is the only path
for a driver that loads on normal machines. That step **replaces** the
`signtool` call in `Sign-Driver.ps1` — the build, the fixed-date stamp, the
catalog, and everything else stay the same. It's gated on Chad setting up
Partner Center + the EV cert; until then, the local signature above is how we
build → load → test → improve.
