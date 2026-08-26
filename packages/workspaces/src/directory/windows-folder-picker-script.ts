// The Windows half of the ONE Browse button: the MODERN Explorer-style
// choose-folder dialog (IFileOpenDialog + FOS_PICKFOLDERS), printed as a path.
//
// WHY the COM interop instead of WinForms' FolderBrowserDialog: under Windows
// PowerShell 5.1 (.NET Framework) that class still shows the legacy tree-style
// "Browse For Folder" box. The dialog people recognise from every other
// program is IFileOpenDialog in folder mode — same window, same muscle memory.
//
// WHY a string and not a vendored .ps1: the script rides inside the compiled
// module and reaches PowerShell as `-EncodedCommand`, so there is no file to
// copy into `dist` (a missing copy would have made the picker silently answer
// "cancelled") and nothing for the shell to re-quote.
//
// Prints the absolute path on OK; prints nothing on cancel. The caller treats
// empty output as "no folder chosen", never as an error.

export const WINDOWS_FOLDER_PICKER_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class VynelFolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogRCW { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] uint Show(IntPtr hwndParent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder(IntPtr psi);
        void SetFolder(IntPtr psi);
        void GetFolder(out IntPtr ppsi);
        void GetCurrentSelection(out IntPtr ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IntPtr psi, uint fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    private const uint FOS_PICKFOLDERS = 0x20;
    private const uint FOS_FORCEFILESYSTEM = 0x40;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    public static string Pick(string title)
    {
        var dialog = (IFileDialog)new FileOpenDialogRCW();
        dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        dialog.SetTitle(title);
        if (dialog.Show(IntPtr.Zero) != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        IntPtr pszPath;
        item.GetDisplayName(SIGDN_FILESYSPATH, out pszPath);
        try { return Marshal.PtrToStringUni(pszPath); }
        finally { Marshal.FreeCoTaskMem(pszPath); }
    }
}
"@

$picked = [VynelFolderPicker]::Pick('Choose the folder your projects live in')
if ($picked) { [Console]::Out.Write($picked) }
`

/** PowerShell's `-EncodedCommand` wants the script as base64 of UTF-16LE. */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}
