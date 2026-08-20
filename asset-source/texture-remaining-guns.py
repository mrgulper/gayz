import bpy
import math
import os
from mathutils import Vector

BASE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE, "weapons/quaternius-guns/FBX")
OUT_DIR = os.path.join(BASE, "weapons", "textured_staging")
BAKE_SIZE = 1024

METAL_BASE_COLOR = (0.045, 0.045, 0.05, 1.0)
WOOD_BASE_COLOR = (0.09, 0.06, 0.045, 1.0)


def add_wear_and_bake(mesh):
    """Same proven recipe as texture-pistol.py: real UVs (smart project),
    per-material wear (noise + edge-pointiness roughness/color variation,
    a bump normal), baked to real 1024x1024 images, wired back in as the
    exportable material. Applied per mesh so this works whether the gun
    is one mesh (rifle/shotgun/awp/glock18) or two (suppressedsmg + its
    silencer attachment)."""
    bpy.context.view_layer.objects.active = mesh
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    bake_targets = []
    for slot in mesh.material_slots:
        mat = slot.material
        if not mat:
            continue
        is_wood = "wood" in mat.name.lower()
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        bsdf.inputs["Base Color"].default_value = WOOD_BASE_COLOR if is_wood else METAL_BASE_COLOR
        bsdf.inputs["Metallic"].default_value = 0.0 if is_wood else 1.0
        base_rough = 0.55 if is_wood else 0.35
        bsdf.inputs["Roughness"].default_value = base_rough

        noise_fine = nt.nodes.new("ShaderNodeTexNoise")
        noise_fine.inputs["Scale"].default_value = 40.0
        noise_fine.inputs["Detail"].default_value = 4.0
        noise_streak = nt.nodes.new("ShaderNodeTexNoise")
        noise_streak.inputs["Scale"].default_value = 6.0
        noise_streak.inputs["Detail"].default_value = 2.0
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        pointiness_ramp = nt.nodes.new("ShaderNodeValToRGB")
        pointiness_ramp.color_ramp.elements[0].position = 0.35
        pointiness_ramp.color_ramp.elements[1].position = 0.65
        mix_noise = nt.nodes.new("ShaderNodeMix")
        mix_noise.data_type = 'FLOAT'
        mix_noise.inputs["Factor"].default_value = 0.5
        rough_combine = nt.nodes.new("ShaderNodeMix")
        rough_combine.data_type = 'FLOAT'
        rough_combine.inputs["Factor"].default_value = 0.45
        rough_low = nt.nodes.new("ShaderNodeValue")
        rough_low.outputs[0].default_value = max(0.08, base_rough - 0.28)
        rough_high = nt.nodes.new("ShaderNodeValue")
        rough_high.outputs[0].default_value = min(0.95, base_rough + 0.30)

        nt.links.new(noise_fine.outputs["Fac"], mix_noise.inputs[2])
        nt.links.new(noise_streak.outputs["Fac"], mix_noise.inputs[3])
        nt.links.new(geo.outputs["Pointiness"], pointiness_ramp.inputs["Fac"])
        nt.links.new(mix_noise.outputs[0], rough_combine.inputs["Factor"])
        nt.links.new(rough_low.outputs[0], rough_combine.inputs["A"])
        nt.links.new(rough_high.outputs[0], rough_combine.inputs["B"])
        nt.links.new(rough_combine.outputs[0], bsdf.inputs["Roughness"])

        dark_col = nt.nodes.new("ShaderNodeMix")
        dark_col.data_type = 'RGBA'
        dark_col.blend_type = 'MULTIPLY'
        dark_col.inputs["Factor"].default_value = 0.35
        base_col_node = nt.nodes.new("ShaderNodeRGB")
        base_col_node.outputs[0].default_value = WOOD_BASE_COLOR if is_wood else METAL_BASE_COLOR
        nt.links.new(base_col_node.outputs[0], dark_col.inputs["A"])
        nt.links.new(pointiness_ramp.outputs["Color"], dark_col.inputs["B"])
        nt.links.new(dark_col.outputs[0], bsdf.inputs["Base Color"])

        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.15
        nt.links.new(noise_fine.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

        img_base = bpy.data.images.new(f"{mesh.name}_{mat.name}_BaseColor", BAKE_SIZE, BAKE_SIZE)
        img_rough = bpy.data.images.new(f"{mesh.name}_{mat.name}_Roughness", BAKE_SIZE, BAKE_SIZE, is_data=True)
        img_norm = bpy.data.images.new(f"{mesh.name}_{mat.name}_Normal", BAKE_SIZE, BAKE_SIZE, is_data=True)
        img_norm.colorspace_settings.name = 'Non-Color'
        img_rough.colorspace_settings.name = 'Non-Color'

        bake_node = nt.nodes.new("ShaderNodeTexImage")
        for n in nt.nodes:
            n.select = False
        bake_node.select = True
        nt.nodes.active = bake_node

        bake_targets.append((mat, nt, bake_node, img_base, img_rough, img_norm))

    if not bake_targets:
        return

    bpy.context.view_layer.objects.active = mesh
    for o in bpy.context.selected_objects:
        o.select_set(False)
    mesh.select_set(True)

    for _, _, bake_node, img_base, _, _ in bake_targets:
        bake_node.image = img_base
    bpy.context.scene.render.bake.use_pass_direct = False
    bpy.context.scene.render.bake.use_pass_indirect = False
    bpy.ops.object.bake(type='DIFFUSE')

    for _, _, bake_node, _, img_rough, _ in bake_targets:
        bake_node.image = img_rough
    bpy.ops.object.bake(type='ROUGHNESS')

    for _, _, bake_node, _, _, img_norm in bake_targets:
        bake_node.image = img_norm
    bpy.ops.object.bake(type='NORMAL')

    for mat, nt, bake_node, img_base, img_rough, img_norm in bake_targets:
        bsdf = nt.nodes.get("Principled BSDF")
        tex_base = nt.nodes.new("ShaderNodeTexImage")
        tex_base.image = img_base
        nt.links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])
        tex_rough = nt.nodes.new("ShaderNodeTexImage")
        tex_rough.image = img_rough
        nt.links.new(tex_rough.outputs["Color"], bsdf.inputs["Roughness"])
        tex_norm = nt.nodes.new("ShaderNodeTexImage")
        tex_norm.image = img_norm
        norm_map_node = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex_norm.outputs["Color"], norm_map_node.inputs["Color"])
        nt.links.new(norm_map_node.outputs["Normal"], bsdf.inputs["Normal"])
        bake_node.image = None


def setup_cycles():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.device = 'CPU'
    bpy.context.scene.cycles.samples = 32


# ---- 4 simple guns: same WEAPONS list as build-guns.py, plus glock18 ----
WEAPONS = [
    {"src": "AssaultRifle_1.fbx", "out": "rifle", "scale": 0.335, "grip": (0, -0.09, 0.1), "foregrip": (0, -0.08, -0.32)},
    {"src": "Shotgun_1.fbx", "out": "shotgun", "scale": 0.159, "grip": (0, -0.09, 0.11), "foregrip": (0, -0.01, -0.14)},
    {"src": "SniperRifle_1.fbx", "out": "awp", "scale": 0.162, "grip": (0, -0.09, 0.14), "foregrip": (0, -0.075, -0.34)},
    {"src": "Pistol_2.fbx", "out": "glock18", "scale": 0.190, "grip": (0, -0.075, 0.07)},
]

for w in WEAPONS:
    print(f"=== {w['out']} ===")
    setup_cycles()
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC_DIR, w["src"]))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")

    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    mesh.select_set(False)

    grip = bpy.data.objects.new("Grip", None)
    grip.location = w["grip"]
    bpy.context.collection.objects.link(grip)
    extra_empties = [grip]
    if "foregrip" in w:
        foregrip = bpy.data.objects.new("Foregrip", None)
        foregrip.location = w["foregrip"]
        bpy.context.collection.objects.link(foregrip)
        extra_empties.append(foregrip)

    for obj in [mesh] + extra_empties:
        obj.scale = (w["scale"], w["scale"], w["scale"])
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.select_set(False)

    try:
        add_wear_and_bake(mesh)
    except RuntimeError as e:
        print(f"BAKE FAILED for {w['out']}:", e)

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    for e in extra_empties:
        e.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    out_path = os.path.join(OUT_DIR, f"{w['out']}.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    print("Exported:", out_path)

# ---- Suppressed SMG: gun + silencer, two meshes ----
print("=== suppressedsmg ===")
setup_cycles()
SRC = os.path.join(SRC_DIR, "SubmachineGun_1.fbx")
SIL_SRC = os.path.join(SRC_DIR, "Accessories/Silencer_Short.fbx")
CORRECTION = 0.180

bpy.ops.import_scene.fbx(filepath=SRC)
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.transform.rotate(value=math.radians(90), orient_axis='Z')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
mesh.scale = (CORRECTION, CORRECTION, CORRECTION)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
mesh.select_set(False)

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

sil_bbox = [silencer.matrix_world @ Vector(c) for c in silencer.bound_box]
sil_near_y = min(v.y for v in sil_bbox)
silencer.location.y = muzzle_y - sil_near_y
silencer.select_set(False)

try:
    add_wear_and_bake(mesh)
except RuntimeError as e:
    print("BAKE FAILED for suppressedsmg gun:", e)
try:
    add_wear_and_bake(silencer)
except RuntimeError as e:
    print("BAKE FAILED for suppressedsmg silencer:", e)

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

out_path = os.path.join(OUT_DIR, "suppressedsmg.glb")
bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
print("Exported:", out_path)
print("ALL DONE")
