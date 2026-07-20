import bpy
import os

BASE = os.path.dirname(os.path.abspath(__file__))
TREX_PATH = os.path.join(BASE, "titan/quaternius-dinosaur/Trex.fbx")
OUT_PATH = os.path.join(BASE, "titan.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)

# Unlike the zombie (Quaternius body + separately retargeted Mixamo clips),
# this pack ships each dinosaur with its own matching walk/run/idle/attack/
# death/jump animations already on the same rig - no cross-rig retarget
# needed, just import and rename to short clip names.
bpy.ops.import_scene.fbx(filepath=TREX_PATH)
armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")

RENAME_MAP = {
    "TRex_Walk": "walk",
    "TRex_Run": "run",
    "TRex_Idle": "idle",
    "TRex_Attack": "attack",
    "TRex_Death": "death",
    "TRex_Jump": "jump",
}
for action in list(bpy.data.actions):
    for src, dst in RENAME_MAP.items():
        if action.name.endswith(src):
            action.name = dst
            break

print("Final actions:", [a.name for a in bpy.data.actions])
print("Armature bone count:", len(armature.data.bones))
print("Mesh vertex count:", len(mesh.data.vertices))
print("Materials:", [s.material.name for s in mesh.material_slots if s.material])

# --- Export GLB with every action as its own named animation clip. ---
bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = armature

bpy.ops.export_scene.gltf(
    filepath=OUT_PATH,
    export_format="GLB",
    use_selection=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_apply=False,
    export_yup=True,
)
print("Exported:", OUT_PATH)
