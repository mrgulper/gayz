import bpy
import os
from mathutils import Vector as mathutils_Vector

BASE = os.path.dirname(os.path.abspath(__file__))
QUAT_PATH = os.path.join(BASE, "zombie/quaternius-zombie/ZombieSmooth.fbx")
OUT_PATH = os.path.join(BASE, "zombie-phase1.glb")

# Mixamo clips harvested purely for their animation action (same retarget
# as Phase 1's Death: mixamorig:<Bone> prefix strip maps 1:1 onto the
# Quaternius rig). Phase 2 adds punch (regular zombies) and kick (boss
# types) per the kick/punch split - see the design note in
# 3D_ASSET_OVERHAUL.md Phase 2 / the project memory it came from.
MIXAMO_CLIPS = {
    "death": "animations/mixamo/Zombie Death.fbx",
    "punch": "animations/mixamo/Zombie Punching.fbx",
    "kick": "animations/mixamo/Zombie Kicking.fbx",
}

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- Import the Quaternius zombie: mesh + armature + its own native
# Walk/Idle/Crawl/Bite actions (confirmed present via inspection). ---
bpy.ops.import_scene.fbx(filepath=QUAT_PATH)
quat_armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
quat_mesh = next(o for o in bpy.data.objects if o.type == "MESH")
quat_bone_names = {b.name for b in quat_armature.data.bones}

RENAME_MAP = {
    "ZombieWalk": "walk",
    "ZombieIdle": "idle",
    "ZombieCrawl": "crawl",
    "ZombieBite": "attack",
}
for action in list(bpy.data.actions):
    for src, dst in RENAME_MAP.items():
        if action.name.endswith(src):
            action.name = dst
            break

print("Native actions after rename:", [a.name for a in bpy.data.actions])

# --- Import each Mixamo FBX purely to harvest its animation action. Every
# one of these armatures uses "mixamorig:<BoneName>" - stripping that
# prefix maps 1:1 onto the Quaternius rig's bone names (confirmed identical
# minus the prefix), so this is a straight retarget, not a real cross-rig
# transfer. ---
for clip_name, rel_path in MIXAMO_CLIPS.items():
    existing_action_names = {a.name for a in bpy.data.actions}
    bpy.ops.import_scene.fbx(filepath=os.path.join(BASE, rel_path))

    clip_action = None
    for action in bpy.data.actions:
        if action.name not in existing_action_names:
            clip_action = action
            break
    if clip_action is None:
        raise RuntimeError(f"Could not find the newly-imported Mixamo action for {clip_name}")

    # Blender 5.2's "layered actions" model nests fcurves under
    # layers[].strips[].channelbags[].fcurves, not a flat action.fcurves list.
    channelbag = clip_action.layers[0].strips[0].channelbags[0]
    kept, dropped = 0, 0
    for fcurve in list(channelbag.fcurves):
        dp = fcurve.data_path
        if 'pose.bones["mixamorig:' in dp:
            new_dp = dp.replace('pose.bones["mixamorig:', 'pose.bones["')
            bone_name = new_dp.split('pose.bones["')[1].split('"')[0]
            if bone_name in quat_bone_names:
                fcurve.data_path = new_dp
                kept += 1
            else:
                # Bone doesn't exist on the Quaternius rig (e.g. finger bones
                # Quaternius's simplified rig omits) - drop that curve rather
                # than leave it pointing at nothing.
                channelbag.fcurves.remove(fcurve)
                dropped += 1
    clip_action.name = clip_name
    print(f"{clip_name} action retarget: kept {kept} curves, dropped {dropped} (no matching bone)")

    # Remove this clip's imported armature/mesh objects - only the action
    # data-block (now retargeted) was needed from that file.
    for obj in list(bpy.data.objects):
        if obj not in (quat_armature, quat_mesh):
            bpy.data.objects.remove(obj, do_unlink=True)

print("Final actions:", [a.name for a in bpy.data.actions])
print("Armature bone count:", len(quat_armature.data.bones))
print("Mesh vertex count:", len(quat_mesh.data.vertices))

# The pack's FBX ships with no linked texture (confirmed: flat grey
# Principled BSDF, no image, no vertex colors) - the source zip likely
# didn't include the actual texture image file. Temporary sickly-green
# tint so Phase 1's in-game test is a fair visual check rather than a
# flat grey blob; swap for the real texture once it's tracked down.
for mat_slot in quat_mesh.material_slots:
    mat = mat_slot.material
    if mat and mat.use_nodes:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (0.29, 0.36, 0.22, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.85

# Scale correction is intentionally NOT done here in Blender - applying
# scale to an animated armature via transform_apply() risks desyncing the
# animation keyframes' translation channels from the newly-rescaled rest-
# pose bone lengths (suspected root cause of scale corrections not landing
# 1:1 at runtime in earlier iterations of this script). Scale is corrected
# in exactly one place instead: a plain Object3D.scale multiplier applied
# in Zombie.js's _buildBodyFromGLB, against this clean, unscaled export.

# --- Export GLB with every action as its own named animation clip. ---
bpy.ops.object.select_all(action="DESELECT")
quat_armature.select_set(True)
quat_mesh.select_set(True)
bpy.context.view_layer.objects.active = quat_armature

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
