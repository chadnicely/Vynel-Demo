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

From the build machine take the package folder
`drivers\windows\vynel-call-audio\VynelCallAudio\Driver\x64\Release\VynelCallAudio\`
(`VynelCallAudio.sys` + `VynelCallAudio.inf` + `vynelcallaudio.cat`) **plus**
`VynelCallAudio.cer` from the folder one level up — the build exports the signing test
certificate (`WDKTestCert KLONE`) there automatically.

In the VM (elevated), trust that certificate for kernel code:

```bat
certutil -addstore Root VynelCallAudio.cer
certutil -addstore TrustedPublisher VynelCallAudio.cer
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
- `mmsys.cpl` → Playback tab shows **Vynel Call 1 Speaker**, Recording tab shows
  **Vynel Call 1 Microphone**.
- Optional: play a tone at the speaker endpoint — this SPIKE renders to nowhere by design
  (loopback wiring is the next milestone), so "plays without error" is the pass bar, not
  "audio comes back".
- The registry's auto-discovery must NOT claim it (endpoints are the app-facing pair only) —
  `Vynel Call <n> Ears/Voice` arrive with the loopback milestone. To exercise the daemon
  against the VM anyway, the env inventory still works.

## Remove / roll back

```bat
devcon remove ROOT\VynelCallAudio     (or Device Manager → uninstall device, tick "delete driver")
pnputil /enum-drivers                  (find the oemNN.inf for VynelCallAudio)
pnputil /delete-driver oemNN.inf /uninstall
bcdedit /set testsigning off
shutdown /r /t 0
```

…or just restore the "pre-driver" snapshot.
