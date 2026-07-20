import bpy
import os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "humans/quaternius-ultimate-character-pack/FBX")
OUT_DIR = os.path.join(BASE, "humans")

# All four Phase 3 characters share the exact same rig and the exact same
# native animation set (confirmed via inspection) - unlike the zombie, no
# Mixamo retargeting needed at all, just import + rename + export.
CHARACTERS = {
    "companion": "Soldier_Male.fbx",
    "rival": "BlueSoldier_Male.fbx",
    "survivor": "Worker_Male.fbx",
    "playerbody": "Casual_Male.fbx",
}

# Native action names -> short clip names used by the game code. A subset of
# the full 17-action set - just what Phase 3's NPCs actually need.
RENAME_MAP = {
    "Idle": "idle",
    "Walk": "walk",
    "Run": "run",
    "Death": "death",
    "Defeat": "defeat",
    "Punch": "punch",
    "Shoot_OneHanded": "shoot",
    "SitDown": "sitdown",
    "StandUp": "standup",
    "RecieveHit": "hit",
}

for out_name, fbx_name in CHARACTERS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC_DIR, fbx_name))
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")

    kept_actions = []
    for action in list(bpy.data.actions):
        matched = False
        for src, dst in RENAME_MAP.items():
            if action.name.endswith(src):
                action.name = dst
                kept_actions.append(dst)
                matched = True
                break
        if not matched:
            bpy.data.actions.remove(action)

    print(f"{out_name} ({fbx_name}): kept actions {kept_actions}")
    print(f"  bone count: {len(armature.data.bones)}, vertex count: {len(mesh.data.vertices)}")
    print(f"  materials: {[s.material.name for s in mesh.material_slots if s.material]}")

    out_path = os.path.join(OUT_DIR, f"{out_name}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_apply=False,
        export_yup=True,
    )
    print("Exported:", out_path)
