param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Target)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Resources {
 [DllImport("kernel32",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr LoadLibraryEx(string f,IntPtr h,uint flags);
 [DllImport("kernel32",SetLastError=true)] public static extern IntPtr FindResource(IntPtr h,IntPtr n,IntPtr t);
 [DllImport("kernel32",SetLastError=true)] public static extern uint SizeofResource(IntPtr h,IntPtr r);
 [DllImport("kernel32",SetLastError=true)] public static extern IntPtr LoadResource(IntPtr h,IntPtr r);
 [DllImport("kernel32",SetLastError=true)] public static extern IntPtr LockResource(IntPtr h);
 [DllImport("kernel32",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr BeginUpdateResource(string f,bool d);
 [DllImport("kernel32",SetLastError=true)] public static extern bool UpdateResource(IntPtr h,IntPtr t,IntPtr n,ushort l,byte[] data,uint size);
 [DllImport("kernel32",SetLastError=true)] public static extern bool EndUpdateResource(IntPtr h,bool discard);
 [DllImport("kernel32")] public static extern bool FreeLibrary(IntPtr h);
}
"@
$source=(Resolve-Path -LiteralPath $Source).Path
$target=(Resolve-Path -LiteralPath $Target).Path
$lib=[Resources]::LoadLibraryEx($source,[IntPtr]::Zero,2);if($lib -eq [IntPtr]::Zero){throw 'load failed'}
$up=[Resources]::BeginUpdateResource($target,$false);if($up -eq [IntPtr]::Zero){throw 'update failed'}
foreach($pair in @(@(16,1,1),@(14,101,1),@(3,1,1))){$type=[IntPtr]$pair[0];$name=[IntPtr]$pair[1];$targetName=[IntPtr]$pair[2];$resource=[Resources]::FindResource($lib,$name,$type);if($resource -eq [IntPtr]::Zero){throw "resource missing $pair"};$size=[Resources]::SizeofResource($lib,$resource);$data=New-Object byte[] $size;[Runtime.InteropServices.Marshal]::Copy([Resources]::LockResource([Resources]::LoadResource($lib,$resource)),$data,0,$size);if(-not [Resources]::UpdateResource($up,$type,$targetName,1033,$data,$size)){throw 'write failed'}}
if(-not [Resources]::EndUpdateResource($up,$false)){throw 'commit failed'};[void][Resources]::FreeLibrary($lib)
