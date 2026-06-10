# Extracts CS2 weapon/knife worldmodels as GLB (with textures) for the website 3D viewer.
# Output: public/models/weapons/<defindex>.glb + manifest.json
# Requires Source 2 Viewer CLI: https://valveresourceformat.github.io/
param(
    [string]$Pak = 'D:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\pak01_dir.vpk',
    [string]$Vrf = 'C:\tools\vrf\Source2Viewer-CLI.exe',
    [string]$OutDir = (Join-Path $PSScriptRoot '..\public\models\weapons')
)

# defindex -> vpk model path (worldmodels)
$map = @{
    1  = 'weapons/models/deagle/weapon_pist_deagle.vmdl_c'
    2  = 'weapons/models/elite/weapon_pist_elite.vmdl_c'
    3  = 'weapons/models/fiveseven/weapon_pist_fiveseven.vmdl_c'
    4  = 'weapons/models/glock18/weapon_pist_glock18.vmdl_c'
    7  = 'weapons/models/ak47/weapon_rif_ak47.vmdl_c'
    8  = 'weapons/models/aug/weapon_rif_aug.vmdl_c'
    9  = 'weapons/models/awp/weapon_snip_awp.vmdl_c'
    10 = 'weapons/models/famas/weapon_rif_famas.vmdl_c'
    11 = 'weapons/models/g3sg1/weapon_snip_g3sg1.vmdl_c'
    13 = 'weapons/models/galilar/weapon_rif_galilar.vmdl_c'
    14 = 'weapons/models/m249/weapon_mach_m249.vmdl_c'
    16 = 'weapons/models/m4a4/weapon_rif_m4a4.vmdl_c'
    17 = 'weapons/models/mac10/weapon_smg_mac10.vmdl_c'
    19 = 'weapons/models/p90/weapon_smg_p90.vmdl_c'
    23 = 'weapons/models/mp5sd/weapon_smg_mp5sd.vmdl_c'
    24 = 'weapons/models/ump45/weapon_smg_ump45.vmdl_c'
    25 = 'weapons/models/xm1014/weapon_shot_xm1014.vmdl_c'
    26 = 'weapons/models/bizon/weapon_smg_bizon.vmdl_c'
    27 = 'weapons/models/mag7/weapon_shot_mag7.vmdl_c'
    28 = 'weapons/models/negev/weapon_mach_negev.vmdl_c'
    29 = 'weapons/models/sawedoff/weapon_shot_sawedoff.vmdl_c'
    30 = 'weapons/models/tec9/weapon_pist_tec9.vmdl_c'
    32 = 'weapons/models/hkp2000/weapon_pist_hkp2000.vmdl_c'
    33 = 'weapons/models/mp7/weapon_smg_mp7.vmdl_c'
    34 = 'weapons/models/mp9/weapon_smg_mp9.vmdl_c'
    35 = 'weapons/models/nova/weapon_shot_nova.vmdl_c'
    36 = 'weapons/models/p250/weapon_pist_p250.vmdl_c'
    38 = 'weapons/models/scar20/weapon_snip_scar20.vmdl_c'
    39 = 'weapons/models/sg556/weapon_rif_sg556.vmdl_c'
    40 = 'weapons/models/ssg08/weapon_snip_ssg08.vmdl_c'
    60 = 'weapons/models/m4a1_silencer/weapon_rif_m4a1_silencer.vmdl_c'
    61 = 'weapons/models/usp_silencer/weapon_pist_usp_silencer.vmdl_c'
    63 = 'weapons/models/cz75a/weapon_pist_cz75a.vmdl_c'
    64 = 'weapons/models/revolver/weapon_pist_revolver.vmdl_c'
    # knives
    500 = 'weapons/models/knife/knife_bayonet/weapon_knife_bayonet.vmdl_c'
    505 = 'weapons/models/knife/knife_flip/weapon_knife_flip.vmdl_c'
    506 = 'weapons/models/knife/knife_gut/weapon_knife_gut.vmdl_c'
    507 = 'weapons/models/knife/knife_karambit/weapon_knife_karambit.vmdl_c'
    508 = 'weapons/models/knife/knife_m9/weapon_knife_m9.vmdl_c'
    509 = 'weapons/models/knife/knife_tactical/weapon_knife_tactical.vmdl_c'
    512 = 'weapons/models/knife/knife_falchion/weapon_knife_falchion.vmdl_c'
    514 = 'weapons/models/knife/knife_bowie/weapon_knife_bowie.vmdl_c'
    515 = 'weapons/models/knife/knife_butterfly/weapon_knife_butterfly.vmdl_c'
    516 = 'weapons/models/knife/knife_push/weapon_knife_push.vmdl_c'
    517 = 'weapons/models/knife/knife_cord/weapon_knife_cord.vmdl_c'
    518 = 'weapons/models/knife/knife_canis/weapon_knife_canis.vmdl_c'
    519 = 'weapons/models/knife/knife_ursus/weapon_knife_ursus.vmdl_c'
    520 = 'weapons/models/knife/knife_navaja/weapon_knife_navaja.vmdl_c'
    521 = 'weapons/models/knife/knife_outdoor/weapon_knife_outdoor.vmdl_c'
    522 = 'weapons/models/knife/knife_stiletto/weapon_knife_stiletto.vmdl_c'
    523 = 'weapons/models/knife/knife_talon/weapon_knife_talon.vmdl_c'
    524 = 'weapons/models/knife/knife_skeleton/weapon_knife_skeleton.vmdl_c'
    525 = 'weapons/models/knife/knife_kukri/weapon_knife_kukri.vmdl_c'
    526 = 'weapons/models/knife/knife_css/weapon_knife_css.vmdl_c'
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$temp = Join-Path $env:TEMP "armory_glb_extract"
$done = @()

foreach ($defindex in ($map.Keys | Sort-Object)) {
    $target = Join-Path $OutDir "$defindex.glb"
    if (Test-Path $target) { $done += $defindex; continue }

    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
    New-Item -ItemType Directory -Force $temp | Out-Null

    & $Vrf -i $Pak --vpk_filepath $map[$defindex] -o $temp -d `
        --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt 2>&1 | Out-Null

    $glb = Get-ChildItem $temp -Recurse -Filter '*.glb' | Where-Object Name -notmatch '_physics' | Select-Object -First 1
    if ($glb) {
        Move-Item $glb.FullName $target -Force
        $done += $defindex
        Write-Host "ok  $defindex  $($map[$defindex])"
    } else {
        Write-Host "FAIL $defindex  $($map[$defindex])"
    }
}

if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }

# manifest = list of defindexes that have a 3D model
$done | Sort-Object | ConvertTo-Json | Set-Content (Join-Path $OutDir 'manifest.json') -Encoding ascii
Write-Host "manifest: $($done.Count) models"
