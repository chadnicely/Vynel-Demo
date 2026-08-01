// A Windows Job Object with KILL_ON_JOB_CLOSE, holding the daemon and every
// process it spawns (the agent SDK's own node/claude children inherit job
// membership). The OS closes the job handle when THIS process dies — by any
// path: graceful exit, crash, taskkill /F — and kills the whole tree with it.
// This closes the sliver daemon.rs's stop() can't: a shell death that never
// runs the exit handler would otherwise orphan node.exe holding port 18892.
//
// The handle is deliberately never closed by us — its lifetime IS the
// mechanism. A creation failure degrades to the pre-B2 behavior (stop() still
// kills the direct child) and is logged, never fatal.

#![cfg(windows)]

use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::OnceLock;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

struct JobHandle(HANDLE);
// SAFETY: the raw handle is only ever passed to thread-safe Win32 job calls.
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

static KILL_ON_CLOSE_JOB: OnceLock<Option<JobHandle>> = OnceLock::new();

fn kill_on_close_job() -> Option<HANDLE> {
    KILL_ON_CLOSE_JOB
        .get_or_init(|| {
            // SAFETY: standard Win32 job-object creation; every failure path
            // is checked and degrades to None.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    log::warn!("job object creation failed — daemon reaping falls back to stop()");
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&info).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 {
                    log::warn!("job object configuration failed — daemon reaping falls back to stop()");
                    windows_sys::Win32::Foundation::CloseHandle(job);
                    return None;
                }
                Some(JobHandle(job))
            }
        })
        .as_ref()
        .map(|handle| handle.0)
}

/// Put the freshly spawned daemon (and, transitively, everything it spawns)
/// under the kill-on-close job. Called right after spawn, before the child is
/// stored — the earlier the assignment, the smaller the orphan window.
pub fn assign_daemon_to_kill_on_close_job(child: &Child) {
    let Some(job) = kill_on_close_job() else {
        return;
    };
    // SAFETY: both handles are live — the job outlives the process, the child
    // handle is owned by `child` for the duration of this call.
    let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) };
    if assigned == 0 {
        log::warn!(
            "could not assign daemon (pid {}) to the kill-on-close job — orphan protection reduced",
            child.id()
        );
    }
}
