# notification-listener.ps1  (vendored asset of @vynel/desktop-control)
#
# Reads Windows notifications via the WinRT UserNotificationListener API and
# emits one compact JSON object per line (NDJSON) on stdout. `listener.ts`
# spawns this once and parses the stream; one-time codes are redacted Node-side
# at ingest (NOT here) — this helper stays a thin OS reader.
#
# Approach: poll GetNotificationsAsync + dedup by Id (more robust across
# PowerShell versions than subscribing to NotificationChanged from PS).
#
# Requirements / caveats:
#   * Run with Windows PowerShell 5.1 (built-in) for the simplest WinRT access.
#   * UserNotificationListener.RequestAccessAsync may prompt the user; for an
#     unpackaged console host the grant can differ from a packaged app. If
#     denied, enable under Settings > Privacy & security > Notifications.
#   * -ParentPid (optional): the spawning Node process id. When passed, the poll
#     loop exits as soon as that process is gone, so an abrupt parent death never
#     orphans this poller. Omit it to run standalone (polls until killed).

param([int]$ParentPid = 0)

$ErrorActionPreference = "Stop"

# --- helper to await WinRT IAsyncOperation<T> from PowerShell -------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

# --- load WinRT types ----------------------------------------------------------------
[void][Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications.Management, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime]

$listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current

# --- request access ------------------------------------------------------------------
$accessType = [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]
$status = Await ($listener.RequestAccessAsync()) $accessType
if ("$status" -ne "Allowed") {
    [Console]::Error.WriteLine("UserNotificationListener access not granted: $status")
    exit 1
}

# --- poll loop -----------------------------------------------------------------------
$toastKind    = [Windows.UI.Notifications.NotificationKinds]::Toast
$listType     = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
$toastBinding = [Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric
$seen = @{}

while ($true) {
    # Exit if our spawning Node process is gone (abrupt death — the graceful
    # stop() would have killed us directly). Cheap once-per-second liveness
    # check; also bails if the pid was reused by a non-node process.
    if ($ParentPid -ne 0) {
        $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if ($null -eq $parent -or $parent.ProcessName -ne 'node') { break }
    }

    try {
        $notifications = Await ($listener.GetNotificationsAsync($toastKind)) $listType
        foreach ($n in $notifications) {
            $id = "$($n.Id)"
            if ($seen.ContainsKey($id)) { continue }
            $seen[$id] = $true

            $app = ""
            try { $app = $n.AppInfo.DisplayInfo.DisplayName } catch {}

            $title = ""
            $body  = ""
            try {
                # Prefer the modern ToastGeneric binding; fall back to the first
                # available binding so legacy ToastText0X templates (whose text
                # GetBinding(ToastGeneric) returns $null for -> blank title/body)
                # are still captured.
                $binding = $n.Notification.Visual.GetBinding($toastBinding)
                if (-not $binding) {
                    $allBindings = $n.Notification.Visual.Bindings
                    if ($allBindings -and $allBindings.Count -ge 1) { $binding = $allBindings[0] }
                }
                if ($binding) {
                    $texts = $binding.GetTextElements()
                    # Wrap in "$(...)" so a $null Text projects to "" (not literal null).
                    if ($texts.Count -ge 1) { $title = "$($texts[0].Text)" }
                    if ($texts.Count -ge 2) {
                        $body = (($texts | Select-Object -Skip 1 | ForEach-Object { "$($_.Text)" }) -join "`n")
                    }
                }
            } catch {
                [Console]::Error.WriteLine("notif: text-extract error for '$app': $($_.Exception.Message)")
            }
            # Diagnostic (stderr, NOT the NDJSON data stream): a toast from a known
            # app with an empty title is the symptom we're chasing -- log it with
            # NO content so a recurrence is catchable in the api log.
            if ($title -eq "" -and $app -ne "") {
                [Console]::Error.WriteLine("notif: empty title for app '$app' (bindings=$($n.Notification.Visual.Bindings.Count))")
            }

            $obj = [ordered]@{
                id        = $id
                app       = $app
                title     = $title
                body      = $body
                timestamp = (Get-Date).ToUniversalTime().ToString("o")
                kind      = "toast"
            }
            [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
        }

        # Drop ids no longer present so re-posted notifications can surface again,
        # and keep the dedup table bounded.
        if ($seen.Count -gt 1000) { $seen.Clear() }
    }
    catch {
        [Console]::Error.WriteLine("poll error: $($_.Exception.Message)")
    }
    Start-Sleep -Milliseconds 1000
}
