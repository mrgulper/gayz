import bpy
import math
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "weapons/quaternius-guns/FBX/Pistol_1.fbx")
OUT = os.path.join(BASE, "weapons/pistol.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")

# Raw model: muzzle at +X, grip hangs down at -Z, thin along Y (confirmed via
# a rendered side-view screenshot). The game's existing procedural pistol
# convention (Viewmodels.js buildPistol) has the barrel pointing -Z, Y up,
# X = width - so rotate -90 around Z (Blender axis; becomes Three.js Y
# after the yup export below) to swing the +X muzzle direction to -Z.
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

# Empties for the game's attachHandToGrip/muzzle-flash contract - positions
# estimated from the mesh bounds (grip = low corner near the wood material,
# muzzle = the barrel-tip end), to be refined visually once wired in.
grip = bpy.data.objects.new("Grip", None)
grip.location = (0, -0.09, 0.12)
bpy.context.collection.objects.link(grip)

muzzle = bpy.data.objects.new("Muzzle", None)
muzzle.location = (0, 0.02, -0.32)
bpy.context.collection.objects.link(muzzle)

# Scale correction - raw model's forward-axis extent is ~1.82 units: target
# is the procedural pistol's own overall length (~0.30, slide 0.26 + muzzle
# overhang), same empirical-measurement approach as the zombie/titan/human
# GLB work (see Zombie.js's _glbScaleCorrection comments).
CORRECTION = 0.165
for obj in [mesh, grip, muzzle]:
    obj.scale = (CORRECTION, CORRECTION, CORRECTION)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)

print("Materials:", [s.material.name for s in mesh.material_slots if s.material])

bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
grip.select_set(True)
muzzle.select_set(True)
bpy.context.view_layer.objects.active = mesh

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)
print("Exported:", OUT)
