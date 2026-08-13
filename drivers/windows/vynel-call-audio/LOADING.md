# Loading the test-signed Vynel Call Audio driver — VM recipe

**Hard rule: never on a dev machine.** Test-signing mode weakens the whole box's driver-trust
posture and a kernel-mode audio driver fault blue-screens the host. Everything below happens in
a throwaway Windows 11 VM (Hyper-V quick-create, VMware, or VirtualBox; a Win11 Eval ISO is
fine — audio playback inside the VM is irrelevant, we only need Device Manager + the sound
panel to show the endpoints).

## One-time VM preparation

1. Snapshot the VM first ("pre-driver").
2. In an elevated prompt, allow test-signed kernel drivers and reboot:

   ```bat
   bcdedit /set testsigning on
   shutdown /r /t 0
   ```

   After the reboot the desktop shows a "Test Mode" watermark — that's correct.
   (Secure Boot blocks test-signing on some VMs: Hyper-V → VM Settings → Security → untick
   "Enable Secure Boot", or use the MicrosoftUEFICertificateAuthority template.)

## Copy in the driver package + the build's test certificate

First sign the built package with Vynel's own test certificate (`sign/README.md`):

```powershell
sign\New-VynelTestCert.ps1   # once per build machine
sign\Sign-Driver.ps1         # after each build — stamps, catalogs, signs .sys + .cat
```

Then from the build machine take the package folder
`drivers\windows\vynel-call-audio\VynelCallAudio\Driver\x64\Release\VynelCallAudio\`
(`VynelCallAudio.sys` + `VynelCallAudio.inf` + `vynelcallaudio.cat`) **plus**
`sign\VynelDriverTest.cer` — the public half of the cert that signed it.

In the VM (elevated), trust that certificate for kernel code:

```bat
certutil -addstore Root VynelDriverTest.cer
certutil -addstore TrustedPublisher VynelDriverTest.cer
```

## Install the root-enumerated device

`devcon` ships in the EWDK (`Program Files\Windows Kits\10\Tools\<arch>\devcon.exe`) — copy it
in, or use pnputil + Device Manager on a stock VM:

**devcon path (one command):**

```bat
devcon install VynelCallAudio.inf ROOT\VynelCallAudio
```

**stock-tools path:**

```bat
pnputil /add-driver VynelCallAudio.inf /install
```

then Device Manager → Action → *Add legacy hardware* → *Install the hardware that I manually
select* → *Sound, video and game controllers* → *Have Disk…* → point at `VynelCallAudio.inf`
→ pick **Vynel Call Audio**.

## Verify

- Device Manager → Sound, video and game controllers → **Vynel Call Audio** present, no
  yellow bang (Code 52 = signature not trusted → the certutil step or test mode is missing).
- `mmsys.cpl` → Playback tab shows **Vynel Call 1 Voice**, Recording tab shows
  **Vynel Call 1 Microphone**.

### The cable smoke (the real test)

The driver is a render→capture loopback: audio played into "Vynel Call 1 Voice" must come out
"Vynel Call 1 Microphone". `smoke-cable.mjs` proves it in one command (needs the repo's Node +
`node-cpal`, i.e. run it from a checkout in the VM, or copy the voice app's `node_modules`):

```bat
node drivers\windows\vynel-call-audio\smoke-cable.mjs 4
```

It plays a 440 Hz tone into the Voice endpoint, records the Microphone endpoint for 4 s, and
prints `PASS` with a non-zero `peak`/`rms` if the ring carried the audio (`FAIL` / silent if
not; exit 2 if the driver isn't loaded). A PASS here means the daemon's own capture path — same
`node-cpal` binding — will carry a real call. Then sanity-check latency + glitches by ear
(mmsys "Listen to this device" on the Microphone), and confirm both ends negotiate the same
format (the v1 ring assumes it).

- The registry's auto-discovery treats the lone **Voice** device as a loopback pair (ears via
  process-loopback), so a call on this VM uses the driver + the process-loopback addon — no
  capture device. The env inventory still works too, for a device-cable smoke.

## Remove / roll back

```bat
devcon remove ROOT\VynelCallAudio     (or Device Manager → uninstall device, tick "delete driver")
pnputil /enum-drivers                  (find the oemNN.inf for VynelCallAudio)
pnputil /delete-driver oemNN.inf /uninstall
bcdedit /set testsigning off
shutdown /r /t 0
```

…or just restore the "pre-driver" snapshot.
