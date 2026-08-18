import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "weapons/quaternius-guns/FBX/SubmachineGun_1.fbx")
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
# pistol-to-shotgun sized fits between those.
CORRECTION = 0.180

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")

bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
mesh.select_set(False)

# Grip/foregrip positions copied directly from the existing procedural
# buildSuppressedSmg() in Viewmodels.js (grip/foregrip .position values) -
# same "reuse the procedural builder's own calibration" approach
# build-guns.py's header comment documents.
grip = bpy.data.objects.new("Grip", None)
grip.location = (0, -0.08, 0.08)
bpy.context.collection.objects.link(grip)

foregrip = bpy.data.objects.new("Foregrip", None)
foregrip.location = (0, -0.02, -0.12)
bpy.context.collection.objects.link(foregrip)

for obj in [mesh, grip, foregrip]:
    obj.scale = (CORRECTION, CORRECTION, CORRECTION)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)

print("Materials:", [s.material.name for s in mesh.material_slots if s.material])

bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
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
