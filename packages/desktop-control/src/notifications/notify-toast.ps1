# notify-toast.ps1  (vendored asset of @vynel/desktop-control)
#
# Posts ONE Windows toast notification and exits. The counterpart of
# notification-listener.ps1 — same WinRT surface, write direction. A stopped
# per-user WpnUserService fails this with 0x80040154 "Class not registered",
# exactly as the listener's poll does; the caller surfaces that error rather
# than inventing a platform claim.
#
# Title/body arrive via ENVIRONMENT VARIABLES (VYNEL_TOAST_TITLE /
# VYNEL_TOAST_BODY) — the launch-app lesson: -Args under -Command is silently
# ignored, and env vars keep model-authored text out of the command line.
# The text lands in the XML via CreateTextNode, never string interpolation,
# so markup in a title cannot become toast XML.
#
# The AppUserModelID is Windows PowerShell's own: CreateToastNotifier requires
# a REGISTERED AUMID, an unpackaged Node process has none, and PowerShell's is
# registered on every Windows box. Known cosmetic cost: the toast attributes
# itself to "Windows PowerShell". Registering a Vynel AUMID (Start-menu
# shortcut) is the packaged-app follow-up, not this helper's job.

$ErrorActionPreference = "Stop"

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

$title = "$env:VYNEL_TOAST_TITLE"
$body  = "$env:VYNEL_TOAST_BODY"
if ($title -eq "") {
    [Console]::Error.WriteLine("notify-toast: VYNEL_TOAST_TITLE is empty")
    exit 1
}

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>')
$texts = $xml.GetElementsByTagName("text")
[void]$texts.Item(0).AppendChild($xml.CreateTextNode($title))
if ($body -ne "") {
    [void]$texts.Item(1).AppendChild($xml.CreateTextNode($body))
}

$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v5.1\powershell.exe'
$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
