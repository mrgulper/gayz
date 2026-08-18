import bpy
import math
import os
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "weapons/quaternius-guns/FBX")
SRC = os.path.join(SRC_DIR, "SubmachineGun_1.fbx")
SIL_SRC = os.path.join(SRC_DIR, "Accessories/Silencer_Short.fbx")
OUT = os.path.join(BASE, "weapons/suppressedsmg.glb")

# Same pack/convention as build-guns.py (rifle/shotgun/awp/glock18) and
# build-pistol.py - muzzle at +X, thin along Y, tall along Z in the raw
# import. Chosen over SubmachineGun_2-5 for being the most compact of the
# 5 SMG variants (raw X extent 2.771 vs 4.0-5.0 for the others) - fits an
# SMG's real-world "compact" silhouette best.
#
# Scale: raw X extent 2.771 -> target ~0.5 (0.5/2.771 = 0.180), landing in
# the same range this pack's other conversions already use (rifle 0.335,
# shotgun 0.159, awp/sniper 0.162, glock18/pistol 0.190) - an SMG being
# pistol-to-shotgun sized fits between those. Silencer_Short chosen over
# _long/_2 - at this same scale, _long would nearly double the gun's own
# length, disproportionate for a compact SMG.
CORRECTION = 0.180

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")

bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
mesh.scale = (CORRECTION, CORRECTION, CORRECTION)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
mesh.select_set(False)

# Muzzle attach point - computed directly from the gun's own (already
# rotated+scaled) bounding box rather than eyeballed, so the silencer
# butts up against the real muzzle with no gap or overlap. In this
# rotated-but-not-yet-yup-exported Blender space, Y is the forward axis
# (export_yup later remaps Blender Y -> glTF -Z, which is why the
# existing Grip/Muzzle .location convention elsewhere in this pack has
# the muzzle at negative Z, matching pistol's own Muzzle at z=-0.32).
gun_bbox = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
muzzle_y = max(v.y for v in gun_bbox)

bpy.ops.import_scene.fbx(filepath=SIL_SRC)
silencer = next(o for o in bpy.data.objects if o.type == "MESH" and o != mesh)
bpy.context.view_layer.objects.active = silencer
silencer.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
silencer.scale = (CORRECTION, CORRECTION, CORRECTION)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Slide the silencer along Y until its own near edge sits exactly at the
# gun's muzzle - same computed-bounding-box approach as above, not a
# guessed offset.
sil_bbox = [silencer.matrix_world @ Vector(c) for c in silencer.bound_box]
sil_near_y = min(v.y for v in sil_bbox)
silencer.location.y = muzzle_y - sil_near_y
silencer.select_set(False)

print("Gun materials:", [s.material.name for s in mesh.material_slots if s.material])
print("Silencer materials:", [s.material.name for s in silencer.material_slots if s.material])

# Grip/foregrip positions copied directly from the existing procedural
# buildSuppressedSmg() in Viewmodels.js (grip/foregrip .position values) -
# same "reuse the procedural builder's own calibration" approach
# build-guns.py's header comment documents. Placed in already-scaled
# target space, same as the gun/silencer above - no further scaling
# needed since CORRECTION was already baked into their axes via the
# gun's own transform above (they're just plain Empties with no
# geometry, so a location assignment in that same target space is
# already correct without its own transform_apply pass).
grip = bpy.data.objects.new("Grip", None)
grip.location = (0, -0.08, 0.08)
bpy.context.collection.objects.link(grip)

foregrip = bpy.data.objects.new("Foregrip", None)
foregrip.location = (0, -0.02, -0.12)
bpy.context.collection.objects.link(foregrip)

bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
silencer.select_set(True)
grip.select_set(True)
foregrip.select_set(True)
bpy.context.view_layer.objects.active = mesh

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print("Exported:", OUT)
