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
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $Source).Path
$target=(Resolve-Path -LiteralPath $Target).Path
$lib=[Resources]::LoadLibraryEx($source,[IntPtr]::Zero,2)
if($lib -eq [IntPtr]::Zero){throw 'Unable to load Windows resources.'}
$update=[IntPtr]::Zero

function Read-Resource([int]$type,[int]$name) {
  $resource=[Resources]::FindResource($lib,[IntPtr]$name,[IntPtr]$type)
  if($resource -eq [IntPtr]::Zero){throw "Resource missing ($type, $name)."}
  $size=[Resources]::SizeofResource($lib,$resource)
  $data=New-Object byte[] $size
  [Runtime.InteropServices.Marshal]::Copy([Resources]::LockResource([Resources]::LoadResource($lib,$resource)),$data,0,$size)
  return ,$data
}

function Write-Resource([int]$type,[int]$name,[byte[]]$data) {
  if(-not [Resources]::UpdateResource($update,[IntPtr]$type,[IntPtr]$name,1033,$data,$data.Length)){
    throw "Unable to write Windows resource ($type, $name)."
  }
}

try {
  $group=Read-Resource 14 101
  if($group.Length -lt 6 -or [BitConverter]::ToUInt16($group,2) -ne 1){throw 'Invalid icon group.'}
  $count=[BitConverter]::ToUInt16($group,4)
  if($count -lt 1 -or $group.Length -ne (6+14*$count)){throw 'Invalid icon directory.'}

  $update=[Resources]::BeginUpdateResource($target,$false)
  if($update -eq [IntPtr]::Zero){throw 'Unable to update executable resources.'}
  Write-Resource 16 1 (Read-Resource 16 1)
  for($index=0;$index -lt $count;$index++){
    $id=[BitConverter]::ToUInt16($group,6+14*$index+12)
    Write-Resource 3 $id (Read-Resource 3 $id)
  }
  Write-Resource 14 1 $group
  $committed=[Resources]::EndUpdateResource($update,$false)
  $update=[IntPtr]::Zero
  if(-not $committed){throw 'Unable to save executable resources.'}
} finally {
  if($update -ne [IntPtr]::Zero){[void][Resources]::EndUpdateResource($update,$true)}
  [void][Resources]::FreeLibrary($lib)
}
