param(
  [int]$TargetProcessId = 0,
  [int]$ParentProcessId = 0,
  [ValidateSet('Inspect', 'Minimize', 'Maximize', 'Restore', 'Close')]
  [string]$Action = 'Inspect',
  [string]$ScreenshotPath = '',
  [switch]$WaitVisible
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$nativeCode = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ClipNoteNativeWindow {
 public class Info { public long Handle; public uint Pid; public string Title; public bool Visible; public bool Enabled; public bool Hung; public bool Minimized; public bool Maximized; }
 private delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] private static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder text, int n);
 [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] private static extern bool IsHungAppWindow(IntPtr h);
 [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 public static void UsePhysicalPixels() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }
 public static Info[] List(int[] pids) { var result = new List<Info>(); EnumWindows((h,p) => { uint pid; GetWindowThreadProcessId(h,out pid); if (Array.IndexOf(pids,(int)pid)>=0) { var text=new StringBuilder(512); GetWindowText(h,text,512); result.Add(new Info {Handle=h.ToInt64(),Pid=pid,Title=text.ToString(),Visible=IsWindowVisible(h),Enabled=IsWindowEnabled(h),Hung=IsHungAppWindow(h),Minimized=IsIconic(h),Maximized=IsZoomed(h)}); } return true; },IntPtr.Zero); return result.ToArray(); }
 public static void Command(long handle, uint expectedPid, int command) { var h=new IntPtr(handle); uint pid; GetWindowThreadProcessId(h,out pid); if (pid!=expectedPid) throw new Exception("Window owner changed"); if (!PostMessage(h,0x0112,new IntPtr(command),IntPtr.Zero)) throw new Exception("System window command failed"); }
}
'@
Add-Type -TypeDefinition $nativeCode
[ClipNoteNativeWindow]::UsePhysicalPixels()
$deadline = [DateTime]::UtcNow.AddSeconds(12)
$window = $null
do {
  $ids = @()
  if ($TargetProcessId) { $ids = @($TargetProcessId) }
  elseif ($ParentProcessId) {
    $processTree = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
    $ids = @($ParentProcessId)
    do { $before = $ids.Count; $ids = @($ids + @($processTree | Where-Object { $ids -contains [int]$_.ParentProcessId } | Select-Object -ExpandProperty ProcessId) | Select-Object -Unique) } while ($ids.Count -gt $before)
  } else { throw 'A test-owned PID is required' }
  $window = [ClipNoteNativeWindow]::List([int[]]$ids) | Where-Object { $_.Title -eq 'ClipNote' } | Select-Object -First 1
  if (-not $window -or ($WaitVisible -and -not $window.Visible)) { Start-Sleep -Milliseconds 100 }
} while ((-not $window -or ($WaitVisible -and -not $window.Visible)) -and [DateTime]::UtcNow -lt $deadline)
if (-not $window) { throw 'ClipNote native window not found for the test-owned process' }
if ($Action -ne 'Inspect') {
  $commands = @{Minimize=0xF020;Maximize=0xF030;Restore=0xF120;Close=0xF060}
  [ClipNoteNativeWindow]::Command($window.Handle,$window.Pid,$commands[$Action])
  if ($Action -eq 'Close') { @{ClosePosted=$true;Pid=$window.Pid} | ConvertTo-Json -Compress; exit 0 }
  do {
    Start-Sleep -Milliseconds 50
    $window = [ClipNoteNativeWindow]::List([int[]]@($window.Pid)) | Where-Object { $_.Title -eq 'ClipNote' } | Select-Object -First 1
    $matches = $window -and (($Action -eq 'Minimize' -and $window.Minimized) -or ($Action -eq 'Maximize' -and $window.Maximized) -or ($Action -eq 'Restore' -and -not $window.Minimized -and -not $window.Maximized))
  } while (-not $matches -and [DateTime]::UtcNow -lt $deadline)
}
$window | Add-Member -NotePropertyName CaptureSaved -NotePropertyValue $false
if ($ScreenshotPath) {
  $allowed = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../.local/test-artifacts'))
  $capture = [IO.Path]::GetFullPath($ScreenshotPath)
  if (-not $capture.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Capture must stay inside project test artifacts' }
  [void][IO.Directory]::CreateDirectory($allowed)
  Add-Type -AssemblyName System.Drawing
  $rect = [ClipNoteNativeWindow+Rect]::new()
  [void][ClipNoteNativeWindow]::GetWindowRect([IntPtr]$window.Handle,[ref]$rect)
  $bitmap = [Drawing.Bitmap]::new($rect.Right - $rect.Left,$rect.Bottom - $rect.Top)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $dc = $graphics.GetHdc()
  try {
    if (-not [ClipNoteNativeWindow]::PrintWindow([IntPtr]$window.Handle,$dc,2)) { throw 'Native window capture failed' }
  } finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
  try { $bitmap.Save($capture,[Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
  $window.CaptureSaved = $true
}
$window | ConvertTo-Json -Compress
